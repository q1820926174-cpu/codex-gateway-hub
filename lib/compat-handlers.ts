import { NextResponse } from "next/server";
import {
  extractAnthropicAssistantMessage,
  extractAnthropicThinkingText,
  extractAnthropicMessageText,
  mapAnthropicMessagesToLegacyChat,
  mapAnthropicToLegacyChat,
  mapAnthropicToResponses,
  mapLegacyChatToAnthropicMessages,
  mapResponsesRequestToAnthropicMessages,
  mapResponsesToAnthropicMessage,
  type AnthropicMessagesRequest
} from "@/lib/anthropic-compat";
import {
  collectMediaInputs,
  extractLegacyChatCompletionReasoning,
  extractLegacyChatCompletionText,
  extractResponseText,
  isStreamingRequest,
  type LegacyChatMessage,
  type LegacyChatRequest,
  mapLegacyChatCompletionToResponses,
  mapLegacyChatToResponses,
  mapLegacyCompletionToResponses,
  mapResponsesRequestToLegacyChat,
  mapResponsesToLegacyChat,
  mapResponsesToLegacyCompletion,
  type ResponsesRequest,
  replaceMediaWithCaptions
} from "@/lib/mapper";
import {
  callAnthropicMessagesApi,
  callAnthropicMessagesApiStream,
  callChatCompletionsApi,
  callChatCompletionsApiStream,
  callCompletionsApi,
  callCompletionsApiStream,
  callResponsesApi,
  callResponsesApiStream,
  resolveGatewayKey
} from "@/lib/upstream";
import { prisma } from "@/lib/prisma";
import {
  normalizeGlmCodexThinkingThresholdValue,
  normalizeUpstreamModels,
  pickModelFromPool,
  normalizeUpstreamWireApiValue,
  type GlmCodexThinkingThreshold
} from "@/lib/key-config";
import { normalizeUpstreamModelCode } from "@/lib/providers";
import {
  estimateLegacyChatTokens,
  estimateLegacyCompletionTokens,
  estimatePlainTextTokens,
  estimateResponsesRequestTokens
} from "@/lib/token-estimator";
import { pickModelByContext } from "@/lib/model-switch";
import type { ResolvedGatewayKey } from "@/lib/upstream";
import {
  extractTokenUsageFromPayload,
  recordTokenUsageEvent
} from "@/lib/usage-report";
import { getCompatPromptConfig } from "@/lib/compat-config";
import { appendAiCallLogEntry } from "@/lib/ai-call-log-store";
import { persistAiCallImage } from "@/lib/ai-call-image-store";
import { readResponseContext, writeResponseContext } from "@/lib/response-context-store";
import { OpenAiFileStoreError, resolveOpenAiFileIdToDataUrl } from "@/lib/openai-file-store";

function pickRequestedModel(modelFromBody: string | undefined, key: ResolvedGatewayKey) {
  const overrideModel = key.activeModelOverride?.trim();
  if (overrideModel) {
    return overrideModel;
  }
  return modelFromBody ?? key.defaultModel;
}

type RequestedModelMappingResolution = {
  mapping: ResolvedGatewayKey["modelMappings"][number] | null;
  mappedModel: string;
  candidateMappings: Array<ResolvedGatewayKey["modelMappings"][number] | null>;
  roundRobinKey: string;
};

function normalizeMappingCompareKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function resolveRequestedModelMapping(requestedModel: string, key: ResolvedGatewayKey) {
  const requestedKey = normalizeMappingCompareKey(requestedModel);
  const matchedMappings = key.modelMappings.filter(
    (item) => normalizeMappingCompareKey(item.clientModel) === requestedKey
  );
  if (!matchedMappings.length) {
    return {
      mapping: null,
      mappedModel: requestedModel,
      candidateMappings: [null],
      roundRobinKey: `${key.id}:${requestedKey}:direct`
    } satisfies RequestedModelMappingResolution;
  }

  const enabledMappings = matchedMappings.filter((item) => item.enabled);
  const preferredMappings = enabledMappings.length ? enabledMappings : matchedMappings;
  const mapping = preferredMappings[0] ?? null;
  const mappedModel = mapping?.targetModel ?? requestedModel;
  const mappedModelKey = normalizeMappingCompareKey(mappedModel);
  const sameModelMappings = mapping
    ? preferredMappings.filter(
        (item) => normalizeMappingCompareKey(item.targetModel) === mappedModelKey
      )
    : preferredMappings;
  const candidateMappings = sameModelMappings.length
    ? sameModelMappings
    : mapping
      ? [mapping]
      : [null];

  return {
    mapping,
    mappedModel,
    candidateMappings,
    roundRobinKey: `${key.id}:${requestedKey}:${mappedModelKey || "direct"}`
  } satisfies RequestedModelMappingResolution;
}

function collectCustomToolNamesFromResponsesRequest(body: ResponsesRequest): Set<string> {
  const names = new Set<string>();
  const addName = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = value.trim();
    if (normalized) {
      names.add(normalized);
    }
  };

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!tool || typeof tool !== "object") {
        continue;
      }
      const type = "type" in tool ? (tool as { type?: unknown }).type : undefined;
      if (type === "custom") {
        addName("name" in tool ? (tool as { name?: unknown }).name : undefined);
      }
    }
  }

  if (body.tool_choice && typeof body.tool_choice === "object") {
    const type =
      "type" in body.tool_choice
        ? (body.tool_choice as { type?: unknown }).type
        : undefined;
    if (type === "custom") {
      addName("name" in body.tool_choice ? (body.tool_choice as { name?: unknown }).name : undefined);
    }
  }

  return names;
}

function extractCustomToolInputFromChatArguments(
  rawArguments: unknown,
  allowFallback = true
): string | null {
  if (typeof rawArguments === "string") {
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed && typeof parsed === "object" && "input" in parsed) {
        const input = (parsed as { input?: unknown }).input;
        return typeof input === "string"
          ? input
          : input == null
            ? ""
            : JSON.stringify(input);
      }
      return allowFallback ? rawArguments : null;
    } catch {
      return allowFallback ? rawArguments : null;
    }
  }
  if (rawArguments && typeof rawArguments === "object" && "input" in rawArguments) {
    const input = (rawArguments as { input?: unknown }).input;
    return typeof input === "string"
      ? input
      : input == null
        ? ""
        : JSON.stringify(input);
  }
  if (!allowFallback) {
    return null;
  }
  return rawArguments == null ? "" : JSON.stringify(rawArguments);
}

type RuntimeModelResolved = {
  runtimeKey: ResolvedGatewayKey;
  upstreamModel: string;
  clientModel: string;
  profile: ResolvedGatewayKey["upstreamModels"][number] | null;
};

type RequestWireApi = "responses" | "chat_completions" | "completions" | "anthropic_messages";

type UsageTraceContext = {
  key: ResolvedGatewayKey;
  route: string;
  requestWireApi: RequestWireApi;
  requestedModel: string;
  clientModel: string;
  upstreamModel: string;
  promptTokensEstimate: number;
  stream: boolean;
  systemPrompt: string;
  userPrompt: string;
  conversationTranscript: string;
};

type PromptSnapshot = {
  systemPrompt: string;
  userPrompt: string;
  conversationTranscript: string;
};

const MAX_LOG_TEXT_CHARS = 40_000;
const MAX_LOG_TRANSCRIPT_CHARS = 120_000;
const VISION_CAPTION_CACHE_TTL_MS = parsePositiveIntEnv(
  process.env.VISION_CAPTION_CACHE_TTL_MS,
  86_400_000,
  0,
  7 * 24 * 60 * 60 * 1000
);
const VISION_CAPTION_CACHE_MAX = parsePositiveIntEnv(
  process.env.VISION_CAPTION_CACHE_MAX,
  2_048,
  0,
  20_000
);

type VisionCaptionCacheEntry = {
  caption: string;
  expiresAt: number;
};

const visionCaptionCache = new Map<string, VisionCaptionCacheEntry>();

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

function isVisionCaptionCacheEnabled() {
  return VISION_CAPTION_CACHE_TTL_MS > 0 && VISION_CAPTION_CACHE_MAX > 0;
}

function hashStringFnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildVisionCaptionCacheKey(params: {
  mediaKind: "image" | "video";
  mediaUrl: string;
  mediaDetail?: string;
  visionModel: string;
  provider: string;
  transportWireApi: string;
}) {
  const mediaUrl = params.mediaUrl.trim();
  const mediaFingerprint = `${mediaUrl.length}:${hashStringFnv1a(mediaUrl)}`;
  return [
    params.mediaKind,
    params.provider.trim().toLowerCase(),
    params.transportWireApi.trim().toLowerCase(),
    params.visionModel.trim().toLowerCase(),
    params.mediaDetail?.trim().toLowerCase() || "-",
    mediaFingerprint
  ].join("|");
}

function pruneVisionCaptionCache(now: number) {
  for (const [key, entry] of visionCaptionCache.entries()) {
    if (entry.expiresAt <= now) {
      visionCaptionCache.delete(key);
    }
  }
  while (visionCaptionCache.size > VISION_CAPTION_CACHE_MAX) {
    const oldest = visionCaptionCache.keys().next().value;
    if (!oldest) {
      break;
    }
    visionCaptionCache.delete(oldest);
  }
}

function readVisionCaptionCache(cacheKey: string) {
  if (!isVisionCaptionCacheEnabled()) {
    return null;
  }
  const now = Date.now();
  const cached = visionCaptionCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    visionCaptionCache.delete(cacheKey);
    return null;
  }
  // Refresh entry order to keep hot captions in cache.
  visionCaptionCache.delete(cacheKey);
  visionCaptionCache.set(cacheKey, cached);
  return cached.caption;
}

function writeVisionCaptionCache(cacheKey: string, caption: string) {
  if (!isVisionCaptionCacheEnabled()) {
    return;
  }
  const now = Date.now();
  pruneVisionCaptionCache(now);
  visionCaptionCache.set(cacheKey, {
    caption,
    expiresAt: now + VISION_CAPTION_CACHE_TTL_MS
  });
  pruneVisionCaptionCache(now);
}

function classifyAnthropicErrorType(status: number) {
  if (status === 401 || status === 403) {
    return "authentication_error";
  }
  if (status === 429) {
    return "rate_limit_error";
  }
  if (status >= 500) {
    return "api_error";
  }
  return "invalid_request_error";
}

function buildAnthropicErrorBody(status: number, message: string) {
  return {
    type: "error",
    error: {
      type: classifyAnthropicErrorType(status),
      message
    }
  };
}

function anthropicErrorResponse(status: number, message: string) {
  return NextResponse.json(buildAnthropicErrorBody(status, message), { status });
}

function extractAnthropicUpstreamErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const payload = body as {
    error?: unknown;
    upstreamBody?: unknown;
  };

  if (typeof payload.error === "string" && payload.error.trim()) {
    const upstreamBody = payload.upstreamBody;
    if (typeof upstreamBody === "string" && upstreamBody.trim()) {
      return `${payload.error.trim()}: ${upstreamBody.trim()}`;
    }
    if (upstreamBody && typeof upstreamBody === "object") {
      const nestedError =
        "error" in upstreamBody && upstreamBody.error && typeof upstreamBody.error === "object"
          ? (upstreamBody.error as { message?: unknown }).message
          : undefined;
      if (typeof nestedError === "string" && nestedError.trim()) {
        return nestedError.trim();
      }
    }
    return payload.error.trim();
  }

  return fallback;
}

async function anthropicErrorResponseFromStream(upstream: Response, fallbackMessage: string) {
  const contentType = upstream.headers.get("content-type") ?? "";
  const parsed = contentType.includes("application/json")
    ? await upstream.json().catch(() => ({}))
    : await upstream.text().catch(() => "");
  const message = extractAnthropicUpstreamErrorMessage(
    typeof parsed === "string" ? { error: parsed } : parsed,
    fallbackMessage
  );
  return anthropicErrorResponse(upstream.status || 500, message);
}

function clipLogText(value: string, max = MAX_LOG_TEXT_CHARS) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}\n\n...[truncated ${normalized.length - max} chars]`;
}

function stringifyUnknownForLog(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildConversationTranscriptFromLegacyMessages(messages: LegacyChatMessage[]) {
  const parts: string[] = [];
  for (const message of messages) {
    const labels: string[] = [message.role];
    if (message.name?.trim()) {
      labels.push(`name=${message.name.trim()}`);
    }
    if (message.tool_call_id?.trim()) {
      labels.push(`tool_call_id=${message.tool_call_id.trim()}`);
    }
    const blocks: string[] = [];
    const text = extractTextFromUnknownContent(message.content);
    if (text) {
      blocks.push(text);
    }
    if (message.tool_calls !== undefined) {
      const toolCallsText = stringifyUnknownForLog(message.tool_calls);
      if (toolCallsText) {
        blocks.push(`[tool_calls]\n${toolCallsText}`);
      }
    }
    if (!blocks.length) {
      continue;
    }
    parts.push(`[${labels.join(" ")}]\n${blocks.join("\n\n")}`);
  }
  return clipLogText(parts.join("\n\n"), MAX_LOG_TRANSCRIPT_CHARS);
}

function extractTextFromUnknownContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      if (item.trim()) {
        parts.push(item.trim());
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = "type" in item ? (item as { type?: unknown }).type : undefined;
    if (type === "input_image" || type === "image_url") {
      parts.push("[image]");
      continue;
    }
    if (type === "input_video" || type === "video_url") {
      parts.push("[video]");
      continue;
    }
    const text = "text" in item ? (item as { text?: unknown }).text : undefined;
    if (typeof text === "string" && text.trim()) {
      parts.push(text.trim());
      continue;
    }
    const contentValue =
      "content" in item ? (item as { content?: unknown }).content : undefined;
    if (typeof contentValue === "string" && contentValue.trim()) {
      parts.push(contentValue.trim());
    }
  }
  return parts.join("\n");
}

function extractPromptSnapshotFromLegacyMessages(messages: LegacyChatMessage[]): PromptSnapshot {
  const systemParts: string[] = [];
  const userParts: string[] = [];
  for (const message of messages) {
    const text = extractTextFromUnknownContent(message.content);
    if (!text) {
      continue;
    }
    if (message.role === "system") {
      systemParts.push(text);
      continue;
    }
    if (message.role === "user") {
      userParts.push(text);
    }
  }

  return {
    systemPrompt: clipLogText(systemParts.join("\n\n")),
    userPrompt: clipLogText(userParts.join("\n\n")),
    conversationTranscript: buildConversationTranscriptFromLegacyMessages(messages)
  };
}

function extractPromptSnapshotFromLegacyCompletionBody(
  body: { prompt?: string | string[] }
): PromptSnapshot {
  const prompt = body.prompt;
  const promptText = Array.isArray(prompt) ? prompt.join("\n") : typeof prompt === "string" ? prompt : "";
  return {
    systemPrompt: "",
    userPrompt: clipLogText(promptText),
    conversationTranscript: clipLogText(`[user]\n${promptText}`, MAX_LOG_TRANSCRIPT_CHARS)
  };
}

function normalizeModelForCompare(provider: string, model: string | null | undefined) {
  const trimmed = model?.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = normalizeUpstreamModelCode(provider, trimmed);
  return normalized.toLowerCase();
}

function isGptFamilyModel(provider: string, model: string | null | undefined) {
  const normalized = normalizeModelForCompare(provider, model);
  return normalized === "gpt" || normalized.startsWith("gpt-");
}

function resolveRuntimeModel(key: ResolvedGatewayKey, model: string): RuntimeModelResolved {
  const requestedModel = model.trim();
  const requestedNormalized = normalizeUpstreamModelCode(key.provider, requestedModel);
  const requestCandidates = new Set(
    [requestedModel, requestedNormalized]
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase())
  );
  const isProfileMatched = (item: { model: string; aliasModel: string | null }) => {
    const modelCode = normalizeModelForCompare(key.provider, item.model);
    const aliasCode = normalizeModelForCompare(key.provider, item.aliasModel);
    return requestCandidates.has(modelCode) || (aliasCode ? requestCandidates.has(aliasCode) : false);
  };

  const profile =
    key.upstreamModels.find((item) => isProfileMatched(item) && item.enabled) ??
    key.upstreamModels.find((item) => isProfileMatched(item)) ??
    null;
  if (!profile) {
    const defaultProfile =
      key.upstreamModels.find(
        (item) => item.model === key.defaultModel && item.enabled
      ) ??
      key.upstreamModels.find((item) => item.model === key.defaultModel) ??
      key.upstreamModels[0] ??
      null;

    const fallbackSupportsVision = defaultProfile?.supportsVision ?? key.supportsVision;
    const fallbackVisionChannelId = fallbackSupportsVision
      ? null
      : defaultProfile?.visionChannelId ?? key.visionChannelId ?? null;
    const fallbackVisionModel = fallbackSupportsVision
      ? null
      : defaultProfile?.visionModel ?? key.visionModel ?? null;

    return {
      runtimeKey: {
        ...key,
        upstreamWireApi: defaultProfile?.upstreamWireApi ?? key.upstreamWireApi,
        supportsVision: fallbackSupportsVision,
        visionChannelId: fallbackVisionChannelId,
        visionModel: fallbackVisionModel
      },
      upstreamModel: requestedNormalized || normalizeUpstreamModelCode(key.provider, key.defaultModel),
      clientModel: model,
      profile: defaultProfile
    };
  }

  return {
    runtimeKey: {
      ...key,
      upstreamWireApi: profile.upstreamWireApi,
      supportsVision: profile.supportsVision,
      visionChannelId: profile.supportsVision ? null : profile.visionChannelId ?? null,
      visionModel: profile.supportsVision ? null : profile.visionModel ?? null
    },
    upstreamModel: normalizeUpstreamModelCode(key.provider, profile.model),
    clientModel: model,
    profile
  };
}

async function resolveMappingRuntimeKey(
  key: ResolvedGatewayKey,
  mapping: ResolvedGatewayKey["modelMappings"][number] | null
) {
  return resolveRuntimeKeyFromChannel(
    key,
    mapping?.upstreamChannelId ?? null,
    "Mapping upstream channel not found or disabled. Check modelMappings[].upstreamChannelId configuration.",
    "Mapping upstream channel has no upstream API key configured."
  );
}

async function resolveRuntimeKeyFromChannel(
  key: ResolvedGatewayKey,
  channelId: number | null,
  missingChannelMessage: string,
  missingApiKeyMessage: string
) {
  if (!channelId) {
    return { ok: true as const, key };
  }

  const channel = await prisma.upstreamChannel.findUnique({
    where: { id: channelId }
  });
  if (!channel || !channel.enabled) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: missingChannelMessage
      }
    };
  }

  const channelApiKey = channel.upstreamApiKey?.trim() || null;
  if (!channelApiKey) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: missingApiKeyMessage
      }
    };
  }

  const channelWireApi = normalizeUpstreamWireApiValue(channel.upstreamWireApi);
  const channelModels = normalizeUpstreamModels(channel.upstreamModelsJson, {
    model: channel.defaultModel,
    upstreamWireApi: channelWireApi,
    supportsVision: channel.supportsVision,
    visionModel: channel.visionModel
  });
  const defaultProfile =
    pickModelFromPool(channelModels, channel.defaultModel) ??
    channelModels[0] ??
    null;
  const resolvedSupportsVision = defaultProfile?.supportsVision ?? channel.supportsVision;
  const resolvedVisionChannelId = resolvedSupportsVision
    ? null
    : defaultProfile?.visionChannelId ?? null;
  const resolvedVisionModel = resolvedSupportsVision
    ? null
    : defaultProfile?.visionModel ?? channel.visionModel ?? null;

  return {
    ok: true as const,
    key: {
      ...key,
      provider: channel.provider,
      upstreamWireApi: channelWireApi,
      upstreamBaseUrl: channel.upstreamBaseUrl,
      upstreamApiKey: channelApiKey,
      upstreamModels: channelModels,
      defaultModel: defaultProfile?.model ?? channel.defaultModel,
      supportsVision: resolvedSupportsVision,
      visionChannelId: resolvedVisionChannelId,
      visionModel: resolvedVisionModel,
      timeoutMs: channel.timeoutMs
    }
  };
}

type ResolvedModelCandidate = RuntimeModelResolved & {
  mapping: ResolvedGatewayKey["modelMappings"][number] | null;
};

const modelFailoverRoundRobinCursor = new Map<string, number>();

function dedupeCandidateMappings(
  mappings: Array<ResolvedGatewayKey["modelMappings"][number] | null>
) {
  const seen = new Set<string>();
  const deduped: Array<ResolvedGatewayKey["modelMappings"][number] | null> = [];
  for (const mapping of mappings) {
    const key = mapping?.id?.trim() || "__inherit_key_upstream__";
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(mapping);
  }
  return deduped;
}

function rotateCandidatesForRoundRobin<T>(items: T[], key: string) {
  if (items.length <= 1 || !key.trim()) {
    return items;
  }
  const cursor = modelFailoverRoundRobinCursor.get(key) ?? 0;
  const start = ((cursor % items.length) + items.length) % items.length;
  modelFailoverRoundRobinCursor.set(key, (start + 1) % items.length);
  if (start === 0) {
    return items;
  }
  return [...items.slice(start), ...items.slice(0, start)];
}

function isFailoverRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

function buildUpstreamNetworkErrorBody(error: unknown) {
  return {
    error: "Upstream request failed.",
    detail: extractErrorMessage(error)
  };
}

async function resolveModelCandidatesForRequest(params: {
  baseKey: ResolvedGatewayKey;
  requestedModel: string;
  mappedModel: string;
  promptTokensEstimate: number;
  mappingResolution: RequestedModelMappingResolution;
}) {
  const dynamicPick = pickModelByContext(
    params.mappedModel,
    params.promptTokensEstimate,
    params.baseKey,
    params.mappingResolution.mapping
  );
  const clientModel = dynamicPick.switched ? dynamicPick.model : params.requestedModel;
  if (dynamicPick.upstreamChannelId) {
    const explicitRuntimeKey = await resolveRuntimeKeyFromChannel(
      params.baseKey,
      dynamicPick.upstreamChannelId,
      "Overflow upstream channel not found or disabled. Check dynamicModelSwitch overflow target configuration.",
      "Overflow upstream channel has no upstream API key configured."
    );
    if (!explicitRuntimeKey.ok) {
      return explicitRuntimeKey;
    }

    const runtimeResolved = resolveRuntimeModel(explicitRuntimeKey.key, dynamicPick.model);
    return {
      ok: true as const,
      candidates: [
        {
          ...runtimeResolved,
          clientModel,
          mapping: null
        }
      ]
    };
  }

  const mappingCandidates = dedupeCandidateMappings(params.mappingResolution.candidateMappings);
  const resolvedCandidates: ResolvedModelCandidate[] = [];
  let firstFailure:
    | {
        status: number;
        body: {
          error: string;
        };
      }
    | null = null;

  for (const mappingCandidate of mappingCandidates) {
    const mappedRuntimeKey = await resolveMappingRuntimeKey(
      params.baseKey,
      mappingCandidate
    );
    if (!mappedRuntimeKey.ok) {
      if (!firstFailure) {
        firstFailure = {
          status: mappedRuntimeKey.status,
          body: mappedRuntimeKey.body
        };
      }
      continue;
    }
    const runtimeResolved = resolveRuntimeModel(
      mappedRuntimeKey.key,
      dynamicPick.model
    );
    resolvedCandidates.push({
      ...runtimeResolved,
      clientModel,
      mapping: mappingCandidate
    });
  }

  if (!resolvedCandidates.length) {
    return {
      ok: false as const,
      status: firstFailure?.status ?? 400,
      body: firstFailure?.body ?? {
        error: "No available upstream candidate for this model mapping."
      }
    };
  }

  const roundRobinCandidates = rotateCandidatesForRoundRobin(
    resolvedCandidates,
    params.mappingResolution.roundRobinKey
  );
  const preferredWireApi = roundRobinCandidates[0]?.runtimeKey.upstreamWireApi;
  const wireCompatibleCandidates = preferredWireApi
    ? roundRobinCandidates.filter(
        (item) => item.runtimeKey.upstreamWireApi === preferredWireApi
      )
    : roundRobinCandidates;

  return {
    ok: true as const,
    candidates: wireCompatibleCandidates
  };
}

type JsonLikeUpstreamResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

type JsonModelFailoverSuccess<T extends JsonLikeUpstreamResult> = {
  ok: true;
  candidate: ResolvedModelCandidate;
  result: T & { ok: true };
};

type JsonModelFailoverFailure = {
  ok: false;
  candidate: ResolvedModelCandidate | null;
  status: number;
  body: unknown;
};

async function callJsonWithModelFailover<T extends JsonLikeUpstreamResult>(
  candidates: ResolvedModelCandidate[],
  caller: (candidate: ResolvedModelCandidate) => Promise<T>
): Promise<JsonModelFailoverSuccess<T> | JsonModelFailoverFailure> {
  if (!candidates.length) {
    return {
      ok: false,
      candidate: null,
      status: 400,
      body: {
        error: "No upstream candidate available."
      }
    };
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const hasNext = index < candidates.length - 1;
    try {
      const result = await caller(candidate);
      if (result.ok) {
        return {
          ok: true,
          candidate,
          result: result as T & { ok: true }
        };
      }
      if (hasNext && isFailoverRetryableStatus(result.status)) {
        continue;
      }
      return {
        ok: false,
        candidate,
        status: result.status,
        body: result.body
      };
    } catch (error) {
      if (hasNext) {
        continue;
      }
      return {
        ok: false,
        candidate,
        status: 502,
        body: buildUpstreamNetworkErrorBody(error)
      };
    }
  }

  return {
    ok: false,
    candidate: candidates[candidates.length - 1] ?? null,
    status: 502,
    body: {
      error: "All upstream candidates failed."
    }
  };
}

type StreamModelFailoverSuccess = {
  ok: true;
  candidate: ResolvedModelCandidate;
  response: Response;
};

type StreamModelFailoverFailure = {
  ok: false;
  candidate: ResolvedModelCandidate | null;
  status: number;
  response: Response | null;
  body: unknown;
};

async function callStreamWithModelFailover(
  candidates: ResolvedModelCandidate[],
  caller: (candidate: ResolvedModelCandidate) => Promise<Response>
): Promise<StreamModelFailoverSuccess | StreamModelFailoverFailure> {
  if (!candidates.length) {
    return {
      ok: false,
      candidate: null,
      status: 400,
      response: null,
      body: {
        error: "No upstream candidate available."
      }
    };
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const hasNext = index < candidates.length - 1;
    try {
      const response = await caller(candidate);
      if (response.ok) {
        return {
          ok: true,
          candidate,
          response
        };
      }
      if (hasNext && isFailoverRetryableStatus(response.status)) {
        continue;
      }
      return {
        ok: false,
        candidate,
        status: response.status,
        response,
        body: {
          error: "Upstream stream API error.",
          status: response.status
        }
      };
    } catch (error) {
      if (hasNext) {
        continue;
      }
      return {
        ok: false,
        candidate,
        status: 502,
        response: null,
        body: buildUpstreamNetworkErrorBody(error)
      };
    }
  }

  return {
    ok: false,
    candidate: candidates[candidates.length - 1] ?? null,
    status: 502,
    response: null,
    body: {
      error: "All upstream candidates failed."
    }
  };
}

function streamFailoverFailureToResponse(failure: StreamModelFailoverFailure) {
  if (failure.response) {
    return failure.response;
  }
  return NextResponse.json(failure.body, { status: failure.status });
}

const SSE_RESPONSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache"
};

function normalizeUsageValues(
  explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null,
  promptTokensEstimate: number,
  completionTokensEstimate: number
) {
  const promptTokens = Math.max(explicitUsage?.promptTokens ?? promptTokensEstimate, 0);
  const completionTokens = Math.max(
    explicitUsage?.completionTokens ?? completionTokensEstimate,
    0
  );
  const totalTokens = Math.max(
    explicitUsage?.totalTokens ?? promptTokens + completionTokens,
    promptTokens + completionTokens
  );
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

async function persistUsageEvent(
  context: UsageTraceContext,
  explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null,
  completionText = "",
  reasoningText = ""
) {
  const combinedAssistantText = [reasoningText, completionText].filter(Boolean).join("\n\n");
  const completionTokensEstimate = combinedAssistantText
    ? estimatePlainTextTokens(combinedAssistantText, context.clientModel)
    : 0;
  const usage = normalizeUsageValues(
    explicitUsage,
    context.promptTokensEstimate,
    completionTokensEstimate
  );

  try {
    await recordTokenUsageEvent({
      keyId: context.key.id,
      keyName: context.key.name,
      route: context.route,
      requestWireApi: context.requestWireApi,
      upstreamWireApi: context.key.upstreamWireApi,
      requestedModel: context.requestedModel,
      clientModel: context.clientModel,
      upstreamModel: context.upstreamModel,
      stream: context.stream,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
    await appendAiCallLogEntry({
      id: crypto.randomUUID().slice(0, 12),
      keyId: context.key.id,
      keyName: context.key.name,
      route: context.route,
      requestWireApi: context.requestWireApi,
      upstreamWireApi: context.key.upstreamWireApi,
      requestedModel: context.requestedModel,
      clientModel: context.clientModel,
      upstreamModel: context.upstreamModel,
      callType: "main",
      stream: context.stream,
      systemPrompt: context.systemPrompt,
      userPrompt: context.userPrompt,
      conversationTranscript: context.conversationTranscript,
      assistantReasoning: clipLogText(reasoningText),
      assistantResponse: clipLogText(completionText),
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "[usage] persist failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function extractCompletionDeltaTextFromChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choice = (payload as { choices?: Array<{ text?: unknown }> }).choices?.[0];
  if (!choice) {
    return "";
  }
  const text = choice.text;
  return typeof text === "string" ? text : "";
}

function extractSseData(block: string): string | null {
  if (!block) {
    return null;
  }

  const lines = block.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    dataLines.push(line.slice("data:".length).trimStart());
  }

  if (!dataLines.length) {
    return null;
  }
  return dataLines.join("\n");
}

function extractChatDeltaTextFromChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choice = (
    payload as {
      choices?: Array<{
        delta?: { content?: unknown; reasoning_content?: unknown };
        message?: { content?: unknown; reasoning_content?: unknown };
        text?: unknown;
      }>;
    }
  ).choices?.[0];
  if (!choice) {
    return "";
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  const deltaContent = choice.delta?.content;
  if (typeof deltaContent === "string") {
    return deltaContent;
  }

  if (!Array.isArray(deltaContent)) {
    const messageContent = choice.message?.content;
    if (typeof messageContent === "string") {
      return messageContent;
    }
    if (!Array.isArray(messageContent)) {
      return "";
    }
    return messageContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  return deltaContent
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function extractChatReasoningDeltaFromChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choice = (
    payload as {
      choices?: Array<{
        delta?: { reasoning_content?: unknown };
        message?: { reasoning_content?: unknown };
      }>;
    }
  ).choices?.[0];
  if (!choice) {
    return "";
  }

  const reasoningContent = choice.delta?.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent) {
    return reasoningContent;
  }
  if (Array.isArray(reasoningContent)) {
    return reasoningContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  const messageReasoning = choice.message?.reasoning_content;
  if (typeof messageReasoning === "string" && messageReasoning) {
    return messageReasoning;
  }
  if (!Array.isArray(messageReasoning)) {
    return "";
  }
  return messageReasoning
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

function extractAnthropicThinkingDeltaFromChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const type = (payload as { type?: unknown }).type;
  if (type !== "content_block_delta") {
    return "";
  }

  const delta = (payload as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") {
    return "";
  }
  const deltaType = (delta as { type?: unknown }).type;
  if (deltaType !== "thinking_delta") {
    return "";
  }
  const thinking = (delta as { thinking?: unknown }).thinking;
  return typeof thinking === "string" ? thinking : "";
}

function extractResponsesTextDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const type = (payload as { type?: unknown }).type;
  if (type !== "response.output_text.delta") {
    return "";
  }
  const delta = (payload as { delta?: unknown }).delta;
  if (typeof delta === "string") {
    return delta;
  }
  if (delta && typeof delta === "object" && typeof (delta as { text?: unknown }).text === "string") {
    return (delta as { text: string }).text;
  }
  return "";
}

function extractResponsesReasoningDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const type = (payload as { type?: unknown }).type;
  if (
    type !== "response.reasoning_text.delta" &&
    type !== "response.reasoning_summary_text.delta"
  ) {
    return "";
  }

  const delta = (payload as { delta?: unknown }).delta;
  if (typeof delta === "string") {
    return delta;
  }
  if (delta && typeof delta === "object") {
    const text =
      ("text" in delta ? (delta as { text?: unknown }).text : undefined) ??
      ("delta" in delta ? (delta as { delta?: unknown }).delta : undefined);
    return typeof text === "string" ? text : "";
  }
  return "";
}

function extractResponsesReasoningText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const output = Array.isArray((payload as { output?: unknown }).output)
    ? ((payload as {
        output?: Array<{
          type?: unknown;
          content?: Array<{ type?: unknown; text?: unknown }>;
          summary?: Array<{ type?: unknown; text?: unknown }>;
        }>;
      }).output ?? [])
    : [];
  const parts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object" || item.type !== "reasoning") {
      continue;
    }

    const contentText = (Array.isArray(item.content) ? item.content : [])
      .map((part) =>
        part &&
        typeof part === "object" &&
        (part.type === "reasoning_text" || part.type === "summary_text") &&
        typeof part.text === "string"
          ? part.text
          : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (contentText) {
      parts.push(contentText);
      continue;
    }

    const summaryText = (Array.isArray(item.summary) ? item.summary : [])
      .map((part) =>
        part && typeof part === "object" && typeof part.text === "string" ? part.text : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (summaryText) {
      parts.push(summaryText);
    }
  }

  return parts.join("\n\n").trim();
}

type ChatToolCallDelta = {
  index: number;
  callId?: string;
  namePart?: string;
  argumentsPart?: string;
};

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractChatToolCallDeltasFromChunk(payload: unknown): ChatToolCallDelta[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const choice = (
    payload as {
      choices?: Array<{
        delta?: { tool_calls?: unknown };
        message?: { tool_calls?: unknown };
      }>;
    }
  ).choices?.[0];
  if (!choice) {
    return [];
  }

  const candidates: unknown[] = [];
  if (Array.isArray(choice.delta?.tool_calls)) {
    candidates.push(...choice.delta.tool_calls);
  }
  if (Array.isArray(choice.message?.tool_calls)) {
    candidates.push(...choice.message.tool_calls);
  }
  if (!candidates.length) {
    return [];
  }

  const deltas: ChatToolCallDelta[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rawIndex = "index" in item ? (item as { index?: unknown }).index : undefined;
    const index = typeof rawIndex === "number" && Number.isFinite(rawIndex) ? rawIndex : 0;
    const rawCallId =
      ("id" in item ? (item as { id?: unknown }).id : undefined) ??
      ("call_id" in item ? (item as { call_id?: unknown }).call_id : undefined);
    const callId =
      typeof rawCallId === "string" && rawCallId.trim() ? rawCallId.trim() : undefined;

    const fn = "function" in item ? (item as { function?: unknown }).function : undefined;
    const rawName =
      (fn && typeof fn === "object" && "name" in fn ? (fn as { name?: unknown }).name : undefined) ??
      ("name" in item ? (item as { name?: unknown }).name : undefined);
    const namePart =
      typeof rawName === "string" && rawName.trim() ? rawName : undefined;

    const rawArgs =
      (fn && typeof fn === "object" && "arguments" in fn
        ? (fn as { arguments?: unknown }).arguments
        : undefined) ??
      ("arguments" in item ? (item as { arguments?: unknown }).arguments : undefined);
    const argumentsPart =
      rawArgs === undefined || rawArgs === null ? undefined : stringifyUnknown(rawArgs);

    deltas.push({
      index,
      callId,
      namePart,
      argumentsPart
    });
  }

  return deltas;
}

type AnthropicToolUseDelta = {
  index: number;
  callId?: string;
  name?: string;
  inputJsonDelta?: string;
};

function extractAnthropicTextDeltaFromChunk(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const type = (payload as { type?: unknown }).type;
  if (type !== "content_block_delta") {
    return "";
  }
  const delta = (payload as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") {
    return "";
  }
  if ((delta as { type?: unknown }).type !== "text_delta") {
    return "";
  }
  const text = (delta as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function extractAnthropicToolUseDeltaFromChunk(payload: unknown): AnthropicToolUseDelta[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const type = (payload as { type?: unknown }).type;
  if (type === "content_block_start") {
    const index = typeof (payload as { index?: unknown }).index === "number"
      ? (payload as { index: number }).index
      : 0;
    const block = (payload as { content_block?: unknown }).content_block;
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "tool_use") {
      return [];
    }
    const callId = (block as { id?: unknown }).id;
    const name = (block as { name?: unknown }).name;
    return [{
      index,
      callId: typeof callId === "string" && callId.trim() ? callId.trim() : undefined,
      name: typeof name === "string" && name.trim() ? name.trim() : undefined
    }];
  }
  if (type === "content_block_delta") {
    const index = typeof (payload as { index?: unknown }).index === "number"
      ? (payload as { index: number }).index
      : 0;
    const delta = (payload as { delta?: unknown }).delta;
    if (!delta || typeof delta !== "object" || (delta as { type?: unknown }).type !== "input_json_delta") {
      return [];
    }
    const partial = (delta as { partial_json?: unknown }).partial_json;
    return [{
      index,
      inputJsonDelta: typeof partial === "string" ? partial : ""
    }];
  }
  return [];
}

function extractAnthropicFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const type = (payload as { type?: unknown }).type;
  if (type === "message_delta") {
    const delta = (payload as { delta?: unknown }).delta;
    if (delta && typeof delta === "object") {
      const stopReason = (delta as { stop_reason?: unknown }).stop_reason;
      return typeof stopReason === "string" && stopReason ? stopReason : null;
    }
  }
  if (type === "message") {
    const stopReason = (payload as { stop_reason?: unknown }).stop_reason;
    return typeof stopReason === "string" && stopReason ? stopReason : null;
  }
  return null;
}

function extractAnthropicUsageFromChunk(payload: unknown) {
  return extractTokenUsageFromPayload(payload);
}

function extractChatFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const finishReason = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]
    ?.finish_reason;
  return typeof finishReason === "string" && finishReason ? finishReason : null;
}

function extractLegacyCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const text = (payload as { choices?: Array<{ text?: unknown }> }).choices?.[0]?.text;
  return typeof text === "string" ? text : "";
}

function deepCloneUnknown(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function normalizeLegacyMessages(messages: LegacyChatRequest["messages"] | undefined): LegacyChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((item): item is LegacyChatMessage => Boolean(item) && typeof item === "object")
    .map((message) => ({
      role: message.role,
      content: deepCloneUnknown(message.content),
      ...(message.reasoning_content !== undefined
        ? { reasoning_content: deepCloneUnknown(message.reasoning_content) }
        : {}),
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.tool_calls ? { tool_calls: deepCloneUnknown(message.tool_calls) } : {})
    }));
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function injectChineseReplyHintBeforeAgents(text: string) {
  const compatPromptConfig = getCompatPromptConfig();
  let agentsIndex = -1;
  for (const keyword of compatPromptConfig.agentsMdKeywords) {
    const index = text.indexOf(keyword);
    if (index >= 0 && (agentsIndex < 0 || index < agentsIndex)) {
      agentsIndex = index;
    }
  }
  if (agentsIndex < 0) {
    return text;
  }
  if (text.slice(0, agentsIndex).includes(compatPromptConfig.chineseReplyHint)) {
    return text;
  }
  const prefix = agentsIndex > 0 && text[agentsIndex - 1] !== "\n" ? "\n" : "";
  return (
    text.slice(0, agentsIndex) +
    `${prefix}${compatPromptConfig.chineseReplyHint}\n` +
    text.slice(agentsIndex)
  );
}

function rewriteUserTextPartForAgentsHint(part: unknown): unknown {
  if (typeof part === "string") {
    return injectChineseReplyHintBeforeAgents(part);
  }
  if (!part || typeof part !== "object") {
    return deepCloneUnknown(part);
  }

  const cloned = deepCloneUnknown(part);
  if (!cloned || typeof cloned !== "object") {
    return cloned;
  }

  const nextPart = cloned as Record<string, unknown>;
  const type = normalizeOptionalString(nextPart.type).toLowerCase();
  if ((type === "text" || type === "input_text") && typeof nextPart.text === "string") {
    nextPart.text = injectChineseReplyHintBeforeAgents(nextPart.text);
  }
  return nextPart;
}

function rewriteLegacyContentForAgentsHint(content: unknown): unknown {
  if (typeof content === "string") {
    return injectChineseReplyHintBeforeAgents(content);
  }
  if (Array.isArray(content)) {
    return content.map((part) => rewriteUserTextPartForAgentsHint(part));
  }
  return content;
}

function rewriteLegacyBodyForAgentsHint(body: LegacyChatRequest): LegacyChatRequest {
  const messages = normalizeLegacyMessages(body.messages);
  if (!messages.length) {
    return body;
  }

  return {
    ...body,
    messages: messages.map((message) =>
      message.role === "user"
        ? {
            ...message,
            content: rewriteLegacyContentForAgentsHint(message.content)
          }
        : message
    )
  };
}

function isResponsesUserInputEntry(entry: unknown) {
  if (typeof entry === "string") {
    return true;
  }
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const explicitType = normalizeOptionalString((entry as { type?: unknown }).type).toLowerCase();
  if (
    explicitType === "function_call" ||
    explicitType === "custom_tool_call" ||
    explicitType === "function_call_output" ||
    explicitType === "custom_tool_call_output"
  ) {
    return false;
  }

  const role = normalizeOptionalString((entry as { role?: unknown }).role).toLowerCase();
  return role !== "assistant" && role !== "tool" && role !== "system" && role !== "developer";
}

function rewriteResponsesUserEntryForAgentsHint(entry: unknown): unknown {
  if (typeof entry === "string") {
    return injectChineseReplyHintBeforeAgents(entry);
  }
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  const cloned = deepCloneUnknown(entry);
  if (!cloned || typeof cloned !== "object") {
    return entry;
  }

  const nextEntry = cloned as Record<string, unknown>;
  const content = nextEntry.content;
  if (typeof content === "string") {
    nextEntry.content = injectChineseReplyHintBeforeAgents(content);
  } else if (Array.isArray(content)) {
    nextEntry.content = content.map((part) => rewriteUserTextPartForAgentsHint(part));
  }

  return nextEntry;
}

function rewriteResponsesBodyForAgentsHint(body: ResponsesRequest): ResponsesRequest {
  if (typeof body.input === "string") {
    return {
      ...body,
      input: injectChineseReplyHintBeforeAgents(body.input)
    };
  }

  if (Array.isArray(body.input)) {
    return {
      ...body,
      input: body.input.map((entry) =>
        isResponsesUserInputEntry(entry)
          ? rewriteResponsesUserEntryForAgentsHint(entry)
          : deepCloneUnknown(entry)
      )
    };
  }

  if (body.input && typeof body.input === "object") {
    return {
      ...body,
      input: isResponsesUserInputEntry(body.input)
        ? rewriteResponsesUserEntryForAgentsHint(body.input)
        : deepCloneUnknown(body.input)
    };
  }

  return body;
}

function pickImageDetailFromPart(part: Record<string, unknown>) {
  const directDetail = normalizeOptionalString(part.detail);
  if (directDetail) {
    return directDetail;
  }

  const imageUrl = part.image_url;
  if (imageUrl && typeof imageUrl === "object") {
    const nestedDetail = normalizeOptionalString((imageUrl as { detail?: unknown }).detail);
    if (nestedDetail) {
      return nestedDetail;
    }
  }

  const videoUrl = part.video_url;
  if (videoUrl && typeof videoUrl === "object") {
    const nestedDetail = normalizeOptionalString((videoUrl as { detail?: unknown }).detail);
    if (nestedDetail) {
      return nestedDetail;
    }
  }

  const imageFile = part.image_file;
  if (imageFile && typeof imageFile === "object") {
    const nestedDetail = normalizeOptionalString((imageFile as { detail?: unknown }).detail);
    if (nestedDetail) {
      return nestedDetail;
    }
  }

  const videoFile = part.video_file;
  if (videoFile && typeof videoFile === "object") {
    const nestedDetail = normalizeOptionalString((videoFile as { detail?: unknown }).detail);
    if (nestedDetail) {
      return nestedDetail;
    }
  }

  return "";
}

function pickFileIdFromPart(part: Record<string, unknown>) {
  const direct = normalizeOptionalString(part.file_id);
  if (direct) {
    return direct;
  }

  const imageFile = part.image_file;
  if (imageFile && typeof imageFile === "object") {
    const nested = normalizeOptionalString((imageFile as { file_id?: unknown }).file_id);
    if (nested) {
      return nested;
    }
  }

  const videoFile = part.video_file;
  if (videoFile && typeof videoFile === "object") {
    const nested = normalizeOptionalString((videoFile as { file_id?: unknown }).file_id);
    if (nested) {
      return nested;
    }
  }

  const imageUrl = part.image_url;
  if (imageUrl && typeof imageUrl === "object") {
    const nested = normalizeOptionalString((imageUrl as { file_id?: unknown }).file_id);
    if (nested) {
      return nested;
    }
  }

  const videoUrl = part.video_url;
  if (videoUrl && typeof videoUrl === "object") {
    const nested = normalizeOptionalString((videoUrl as { file_id?: unknown }).file_id);
    if (nested) {
      return nested;
    }
  }

  return "";
}

type ResolvedFileInput = {
  dataUrl: string;
  mimeType: string;
  mediaType: "image" | "video" | "other";
};

async function resolveFileIdWithCache(
  fileId: string,
  ownerKeyId: number,
  cache: Map<string, ResolvedFileInput>
) {
  const key = fileId.trim();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const resolved = await resolveOpenAiFileIdToDataUrl(ownerKeyId, key);
  cache.set(key, resolved);
  return resolved;
}

type RewriteResult<T> =
  | {
      ok: true;
      body: T;
    }
  | {
      ok: false;
      status: number;
      body: {
        error: string;
      };
    };

function normalizeRewriteError(error: unknown): RewriteResult<never> {
  if (error instanceof OpenAiFileStoreError) {
    return {
      ok: false,
      status: error.status,
      body: {
        error: error.message
      }
    };
  }

  return {
    ok: false,
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "Failed to resolve file_id media input."
    }
  };
}

async function rewriteLegacyChatBodyFileIds(
  body: LegacyChatRequest,
  ownerKeyId: number
): Promise<RewriteResult<LegacyChatRequest>> {
  const messages = normalizeLegacyMessages(body.messages);
  if (!messages.length) {
    return {
      ok: true,
      body
    };
  }

  const cache = new Map<string, ResolvedFileInput>();
  let changed = false;
  const rewrittenMessages: LegacyChatMessage[] = [];

  try {
    for (const message of messages) {
      if (!Array.isArray(message.content)) {
        rewrittenMessages.push(message);
        continue;
      }

      const nextParts: unknown[] = [];
      let messageChanged = false;

      for (const part of message.content) {
        if (!part || typeof part !== "object") {
          nextParts.push(deepCloneUnknown(part));
          continue;
        }

        const partObj = part as Record<string, unknown>;
        const type = normalizeOptionalString(partObj.type).toLowerCase();
        const isMediaPart =
          type === "image_file" ||
          type === "input_image" ||
          type === "image_url" ||
          type === "video_file" ||
          type === "input_video" ||
          type === "video_url";
        if (!isMediaPart) {
          nextParts.push(deepCloneUnknown(part));
          continue;
        }

        const fileId = pickFileIdFromPart(partObj);
        if (!fileId) {
          nextParts.push(deepCloneUnknown(part));
          continue;
        }

        const detail = pickImageDetailFromPart(partObj);
        const resolvedFile = await resolveFileIdWithCache(fileId, ownerKeyId, cache);
        if (resolvedFile.mediaType === "other") {
          throw new OpenAiFileStoreError(
            400,
            `Unsupported file media type for multimodal input: ${resolvedFile.mimeType}`
          );
        }

        nextParts.push(
          resolvedFile.mediaType === "video"
            ? {
                type: "video_url",
                video_url: {
                  url: resolvedFile.dataUrl,
                  ...(detail ? { detail } : {})
                }
              }
            : {
                type: "image_url",
                image_url: {
                  url: resolvedFile.dataUrl,
                  ...(detail ? { detail } : {})
                }
              }
        );
        messageChanged = true;
      }

      rewrittenMessages.push(
        messageChanged
          ? {
              ...message,
              content: nextParts
            }
          : message
      );
      changed = changed || messageChanged;
    }
  } catch (error) {
    return normalizeRewriteError(error);
  }

  if (!changed) {
    return {
      ok: true,
      body
    };
  }

  return {
    ok: true,
    body: {
      ...body,
      messages: rewrittenMessages
    }
  };
}

async function rewriteResponsesBodyFileIds(
  body: ResponsesRequest,
  ownerKeyId: number
): Promise<RewriteResult<ResponsesRequest>> {
  const input = body.input;
  if (!Array.isArray(input) && !(input && typeof input === "object")) {
    return {
      ok: true,
      body
    };
  }

  const entries = Array.isArray(input) ? input : [input];
  const cache = new Map<string, ResolvedFileInput>();
  let changed = false;
  const rewrittenEntries: unknown[] = [];

  try {
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        rewrittenEntries.push(deepCloneUnknown(entry));
        continue;
      }

      const content = "content" in entry ? (entry as { content?: unknown }).content : undefined;
      if (!Array.isArray(content)) {
        rewrittenEntries.push(deepCloneUnknown(entry));
        continue;
      }

      let entryChanged = false;
      const nextContent: unknown[] = [];

      for (const part of content) {
        if (!part || typeof part !== "object") {
          nextContent.push(deepCloneUnknown(part));
          continue;
        }

        const partObj = part as Record<string, unknown>;
        const type = normalizeOptionalString(partObj.type).toLowerCase();
        const isMediaPart =
          type === "input_image" ||
          type === "image_file" ||
          type === "image_url" ||
          type === "input_video" ||
          type === "video_file" ||
          type === "video_url";
        if (!isMediaPart) {
          nextContent.push(deepCloneUnknown(part));
          continue;
        }

        const fileId = pickFileIdFromPart(partObj);
        if (!fileId) {
          nextContent.push(deepCloneUnknown(part));
          continue;
        }

        const detail = pickImageDetailFromPart(partObj);
        const resolvedFile = await resolveFileIdWithCache(fileId, ownerKeyId, cache);
        if (resolvedFile.mediaType === "other") {
          throw new OpenAiFileStoreError(
            400,
            `Unsupported file media type for multimodal input: ${resolvedFile.mimeType}`
          );
        }

        nextContent.push(
          resolvedFile.mediaType === "video"
            ? {
                type: "input_video",
                video_url: resolvedFile.dataUrl,
                ...(detail ? { detail } : {})
              }
            : {
                type: "input_image",
                image_url: resolvedFile.dataUrl,
                ...(detail ? { detail } : {})
              }
        );
        entryChanged = true;
      }

      rewrittenEntries.push(
        entryChanged
          ? {
              ...(entry as Record<string, unknown>),
              content: nextContent
            }
          : deepCloneUnknown(entry)
      );
      changed = changed || entryChanged;
    }
  } catch (error) {
    return normalizeRewriteError(error);
  }

  if (!changed) {
    return {
      ok: true,
      body
    };
  }

  return {
    ok: true,
    body: {
      ...body,
      input: Array.isArray(input) ? rewrittenEntries : rewrittenEntries[0] ?? input
    }
  };
}

function mergeContinuationMessages(
  previousMessages: LegacyChatMessage[],
  incomingMessages: LegacyChatMessage[]
): LegacyChatMessage[] {
  if (!previousMessages.length) {
    return incomingMessages;
  }
  if (!incomingMessages.length) {
    return previousMessages;
  }

  const previousHead = previousMessages[0];
  const incomingHead = incomingMessages[0];
  const shouldDropDuplicatedSystem =
    previousHead?.role === "system" &&
    incomingHead?.role === "system" &&
    JSON.stringify(previousHead.content) === JSON.stringify(incomingHead.content);

  if (shouldDropDuplicatedSystem) {
    return [...previousMessages, ...incomingMessages.slice(1)];
  }
  return [...previousMessages, ...incomingMessages];
}

function normalizeOptionalField(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function extractAnthropicUpstreamHeaderOverrides(req: Request) {
  return {
    anthropicVersion: req.headers.get("anthropic-version"),
    anthropicBeta: req.headers.get("anthropic-beta")
  };
}

function isThinkingDisabledByEffort(effort: string) {
  const normalized = effort.trim().toLowerCase();
  return normalized === "none" || normalized === "off" || normalized === "disabled" || normalized === "minimal";
}

function normalizeThinkingType(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "adaptive") {
    return "auto";
  }
  if (normalized === "enabled" || normalized === "disabled" || normalized === "auto") {
    return normalized;
  }
  return "";
}

function normalizeThinkingBudget(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.floor(num);
}

function sanitizeLegacyContentForGenericUpstream(content: unknown, role: LegacyChatMessage["role"]) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return content;
  }

  const textParts: string[] = [];
  const contentParts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail?: string } }
    | { type: "video_url"; video_url: { url: string; detail?: string } }
  > = [];

  for (const part of content) {
    if (typeof part === "string") {
      const text = part.trim();
      if (text) {
        textParts.push(text);
      }
      continue;
    }
    if (!part || typeof part !== "object") {
      continue;
    }

    const rawType = "type" in part ? (part as { type?: unknown }).type : undefined;
    const rawText = "text" in part ? (part as { text?: unknown }).text : undefined;
    if ((rawType === "text" || typeof rawText === "string") && typeof rawText === "string" && rawText.trim()) {
      const text = rawText.trim();
      textParts.push(text);
      contentParts.push({ type: "text", text });
      continue;
    }

    if (rawType !== "image_url" && rawType !== "input_image" && rawType !== "video_url" && rawType !== "input_video") {
      continue;
    }

    const isVideo = rawType === "video_url" || rawType === "input_video";
    const mediaValue = isVideo
      ? ("video_url" in part ? (part as { video_url?: unknown }).video_url : undefined)
      : ("image_url" in part ? (part as { image_url?: unknown }).image_url : undefined);
    const detailValue = "detail" in part ? (part as { detail?: unknown }).detail : undefined;
    const mediaUrl =
      typeof mediaValue === "string"
        ? mediaValue.trim()
        : mediaValue && typeof mediaValue === "object" && typeof (mediaValue as { url?: unknown }).url === "string"
          ? (mediaValue as { url: string }).url.trim()
          : "";
    const detail =
      typeof detailValue === "string"
        ? detailValue.trim()
        : mediaValue && typeof mediaValue === "object" && typeof (mediaValue as { detail?: unknown }).detail === "string"
          ? ((mediaValue as { detail: string }).detail).trim()
          : "";
    if (!mediaUrl) {
      continue;
    }

    if (isVideo) {
      contentParts.push({
        type: "video_url",
        video_url: {
          url: mediaUrl,
          ...(detail ? { detail } : {})
        }
      });
      continue;
    }

    contentParts.push({
      type: "image_url",
      image_url: {
        url: mediaUrl,
        ...(detail ? { detail } : {})
      }
    });
  }

  if (role === "assistant" || role === "system" || role === "tool") {
    return textParts.join("\n\n").trim();
  }

  if (!contentParts.length) {
    return textParts.join("\n\n").trim();
  }
  if (contentParts.every((part) => part.type === "text")) {
    return textParts.join("\n\n").trim();
  }
  return contentParts;
}

function sanitizeLegacyMessagesForGenericUpstream(
  messages: LegacyChatRequest["messages"] | undefined,
  options?: {
    preserveReasoningContent?: boolean;
  }
) {
  if (!Array.isArray(messages)) {
    return messages;
  }
  return messages.map((message) => ({
    role: message.role,
    content: sanitizeLegacyContentForGenericUpstream(message.content, message.role),
    ...(options?.preserveReasoningContent &&
    message.role === "assistant" &&
    message.reasoning_content !== undefined
      ? { reasoning_content: deepCloneUnknown(message.reasoning_content) }
      : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: deepCloneUnknown(message.tool_calls) } : {})
  }));
}

function hasReasoningContentValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value && typeof value === "object");
}

function resolveReasoningEffortForChatPayload(payload: LegacyChatRequest) {
  const direct = normalizeOptionalField(payload.reasoning_effort);
  if (direct) {
    return direct;
  }

  const objectEffort =
    payload.reasoning &&
    typeof payload.reasoning === "object" &&
    typeof payload.reasoning.effort === "string"
      ? payload.reasoning.effort.trim()
      : "";
  if (objectEffort) {
    return objectEffort;
  }

  const thinking = payload.thinking;
  if (!thinking || typeof thinking !== "object") {
    return "";
  }
  const type = normalizeThinkingType((thinking as { type?: unknown }).type);
  if (!type) {
    return "";
  }
  if (type === "disabled") {
    return "minimal";
  }
  if (type !== "enabled") {
    return "";
  }

  const budget = normalizeThinkingBudget((thinking as { budget_tokens?: unknown }).budget_tokens);
  if (budget >= 4096) {
    return "high";
  }
  if (budget >= 1024) {
    return "medium";
  }
  return "low";
}

function resolveThinkingBudgetFromEffort(effort: string) {
  const normalized = effort.trim().toLowerCase();
  if (normalized === "high") {
    return 4096;
  }
  if (normalized === "medium") {
    return 2048;
  }
  if (normalized && !isThinkingDisabledByEffort(normalized)) {
    return 1024;
  }
  return 0;
}

function normalizeReasoningEffortLevel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized && !isThinkingDisabledByEffort(normalized)) {
    return "low";
  }
  return "";
}

function shouldEnableGlmThinkingForEffort(
  effort: string,
  threshold: GlmCodexThinkingThreshold
) {
  if (threshold === "off") {
    return false;
  }
  const level = normalizeReasoningEffortLevel(effort);
  if (!level) {
    return false;
  }
  const ranks = {
    low: 1,
    medium: 2,
    high: 3
  } as const;
  return ranks[level] >= ranks[threshold];
}

function applyCodexThinkingModeForChat<T extends LegacyChatRequest>(
  payload: T,
  provider: string,
  glmCodexThinkingThreshold?: GlmCodexThinkingThreshold | null,
  preferredThinkingType?: "enabled" | "disabled" | "auto" | null
): T {
  const reasoningEffort = resolveReasoningEffortForChatPayload(payload);
  const reasoningSummary =
    payload.reasoning &&
    typeof payload.reasoning === "object" &&
    typeof payload.reasoning.summary === "string"
      ? payload.reasoning.summary.trim()
      : "";
  const hasReasoningHistory =
    Array.isArray(payload.messages) &&
    payload.messages.some(
      (message) =>
        message.role === "assistant" && hasReasoningContentValue(message.reasoning_content)
    );

  const nextPayload: LegacyChatRequest = {
    ...payload,
    messages: sanitizeLegacyMessagesForGenericUpstream(payload.messages)
  };
  // GLM chat/completions follows documented `thinking.type` only.
  const normalizedProvider = provider.trim().toLowerCase();
  const preferredType = normalizeThinkingType(preferredThinkingType);
  if (normalizedProvider === "glm") {
    nextPayload.messages = sanitizeLegacyMessagesForGenericUpstream(payload.messages, {
      preserveReasoningContent: true
    });
    const threshold = normalizeGlmCodexThinkingThresholdValue(glmCodexThinkingThreshold);
    const existingThinking = payload.thinking && typeof payload.thinking === "object" ? payload.thinking : null;
    const incomingType = normalizeThinkingType(existingThinking ? (existingThinking as { type?: unknown }).type : undefined);
    const type = preferredType
      ? preferredType === "disabled"
        ? "disabled"
        : "enabled"
      : incomingType
      ? incomingType === "disabled"
        ? "disabled"
        : "enabled"
      : reasoningEffort
        ? isThinkingDisabledByEffort(reasoningEffort)
          ? "disabled"
          : shouldEnableGlmThinkingForEffort(reasoningEffort, threshold)
            ? "enabled"
            : ""
        : reasoningSummary || hasReasoningHistory
          ? threshold === "off"
            ? ""
            : "enabled"
          : "";
    const clearThinking =
      type === "enabled"
        ? existingThinking && typeof (existingThinking as { clear_thinking?: unknown }).clear_thinking === "boolean"
          ? Boolean((existingThinking as { clear_thinking?: unknown }).clear_thinking)
          : false
        : undefined;

    nextPayload.anthropic_output_config = undefined;
    nextPayload.reasoning_effort = undefined;
    nextPayload.verbosity = undefined;
    if (!type) {
      nextPayload.thinking = undefined;
      return nextPayload as T;
    }

    nextPayload.thinking = {
      type,
      ...(typeof clearThinking === "boolean" ? { clear_thinking: clearThinking } : {})
    };
    return nextPayload as T;
  }

  if (normalizedProvider === "doubao") {
    // Doubao chat/responses supports explicit thinking mode and reasoning_effort.
    // Preserve reasoning_content history for multi-turn/tool-call scenarios.
    nextPayload.messages = sanitizeLegacyMessagesForGenericUpstream(payload.messages, {
      preserveReasoningContent: true
    });
    const existingThinking = payload.thinking && typeof payload.thinking === "object" ? payload.thinking : null;
    const incomingType = normalizeThinkingType(
      existingThinking ? (existingThinking as { type?: unknown }).type : undefined
    );
    const type = preferredType
      ? preferredType
      : incomingType
      ? incomingType === "disabled"
        ? "disabled"
        : incomingType === "auto"
          ? "auto"
          : "enabled"
      : reasoningEffort
        ? isThinkingDisabledByEffort(reasoningEffort)
          ? "disabled"
          : "enabled"
        : reasoningSummary || hasReasoningHistory
          ? "enabled"
          : "";

    nextPayload.anthropic_output_config = undefined;
    if (reasoningEffort) {
      nextPayload.reasoning_effort = reasoningEffort;
    }
    if (!type) {
      nextPayload.thinking = undefined;
      return nextPayload as T;
    }
    nextPayload.thinking = { type };
    return nextPayload as T;
  }

  // `thinking` is Anthropic-specific. For generic chat/completions upstreams we normalize it
  // into reasoning_effort and remove unsupported fields.
  nextPayload.anthropic_output_config = undefined;
  nextPayload.thinking = undefined;
  if (reasoningEffort) {
    nextPayload.reasoning_effort = reasoningEffort;
  }
  return nextPayload as T;
}

function applyCodexThinkingModeForResponses<T extends ResponsesRequest>(
  payload: T,
  provider: string,
  preferredThinkingType?: "enabled" | "disabled" | "auto" | null
): T {
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider !== "doubao") {
    return payload;
  }

  const nextPayload: ResponsesRequest = { ...payload };
  const preferredType = normalizeThinkingType(preferredThinkingType);
  const existingThinking =
    nextPayload.thinking && typeof nextPayload.thinking === "object"
      ? nextPayload.thinking
      : null;
  const incomingType = normalizeThinkingType(
    existingThinking ? (existingThinking as { type?: unknown }).type : undefined
  );
  const reasoningEffort =
    typeof nextPayload.reasoning_effort === "string" && nextPayload.reasoning_effort.trim()
      ? nextPayload.reasoning_effort.trim()
      : nextPayload.reasoning &&
          typeof nextPayload.reasoning === "object" &&
          typeof nextPayload.reasoning.effort === "string"
        ? nextPayload.reasoning.effort.trim()
        : "";
  const type = preferredType
    ? preferredType
    : incomingType
      ? incomingType
      : reasoningEffort
        ? isThinkingDisabledByEffort(reasoningEffort)
          ? "disabled"
          : "enabled"
        : "";
  if (!type) {
    nextPayload.thinking = undefined;
    return nextPayload as T;
  }
  nextPayload.thinking = {
    ...(existingThinking ?? {}),
    type
  };
  return nextPayload as T;
}

function extractAssistantMessageFromLegacyChatPayload(payload: unknown): LegacyChatMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const message = (
    payload as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          tool_calls?: unknown;
          name?: unknown;
          tool_call_id?: unknown;
        };
      }>;
    }
  ).choices?.[0]?.message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const rawContent = "content" in message ? message.content : "";
  const content =
    typeof rawContent === "string" || Array.isArray(rawContent)
      ? deepCloneUnknown(rawContent)
      : rawContent == null
        ? ""
        : deepCloneUnknown(rawContent);
  const hasContent =
    (typeof content === "string" && content.trim().length > 0) ||
    (Array.isArray(content) && content.length > 0) ||
    (content && typeof content === "object");
  const rawReasoningContent = "reasoning_content" in message ? message.reasoning_content : undefined;
  const hasReasoningContent = hasReasoningContentValue(rawReasoningContent);

  const rawToolCalls = "tool_calls" in message ? message.tool_calls : undefined;
  const hasToolCalls =
    (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) ||
    (rawToolCalls && typeof rawToolCalls === "object");

  if (!hasContent && !hasToolCalls && !hasReasoningContent) {
    return null;
  }

  const nameValue = "name" in message ? message.name : undefined;
  const toolCallId = "tool_call_id" in message ? message.tool_call_id : undefined;
  return {
    role: "assistant",
    content: hasContent ? content : "",
    ...(hasReasoningContent ? { reasoning_content: deepCloneUnknown(rawReasoningContent) } : {}),
    ...(typeof nameValue === "string" && nameValue.trim() ? { name: nameValue.trim() } : {}),
    ...(typeof toolCallId === "string" && toolCallId.trim() ? { tool_call_id: toolCallId.trim() } : {}),
    ...(hasToolCalls ? { tool_calls: deepCloneUnknown(rawToolCalls) } : {})
  };
}

function trackUsageFromSse(
  upstream: Response,
  streamWireApi: RequestWireApi,
  context: UsageTraceContext
) {
  if (!upstream.body) {
    return upstream;
  }

  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let parseBuffer = "";
  let completionText = "";
  let reasoningText = "";
  let explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null = null;

  const absorbPayload = (payload: unknown) => {
    const usage =
      streamWireApi === "anthropic_messages"
        ? extractAnthropicUsageFromChunk(payload)
        : extractTokenUsageFromPayload(payload);
    if (usage) {
      explicitUsage = usage;
    }

    if (streamWireApi === "responses") {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const textDelta = extractResponsesTextDelta(payload);
      if (textDelta) {
        completionText += textDelta;
      }
      const responseReasoningDelta = extractResponsesReasoningDelta(payload);
      if (responseReasoningDelta) {
        reasoningText += responseReasoningDelta;
      }
      return;
    }

    if (streamWireApi === "anthropic_messages") {
      const anthropicTextDelta = extractAnthropicTextDeltaFromChunk(payload);
      if (anthropicTextDelta) {
        completionText += anthropicTextDelta;
      }
      const anthropicThinkingDelta = extractAnthropicThinkingDeltaFromChunk(payload);
      if (anthropicThinkingDelta) {
        reasoningText += anthropicThinkingDelta;
      }
      return;
    }

    if (streamWireApi === "completions") {
      const delta = extractCompletionDeltaTextFromChunk(payload);
      if (delta) {
        completionText += delta;
      }
      return;
    }

    const delta = extractChatDeltaTextFromChunk(payload);
    if (delta) {
      completionText += delta;
      return;
    }

    const reasoningDelta = extractChatReasoningDeltaFromChunk(payload);
    if (reasoningDelta) {
      reasoningText += reasoningDelta;
    }
  };

  const processSseText = (text: string) => {
    if (!text) {
      return;
    }
    parseBuffer += text.replace(/\r\n/g, "\n");
    let boundary = parseBuffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = parseBuffer.slice(0, boundary);
      parseBuffer = parseBuffer.slice(boundary + 2);
      const data = extractSseData(block);
      if (!data || data === "[DONE]") {
        boundary = parseBuffer.indexOf("\n\n");
        continue;
      }
      try {
        absorbPayload(JSON.parse(data));
      } catch {
        // ignore non-json frame
      }
      boundary = parseBuffer.indexOf("\n\n");
    }
  };

  const trackedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        processSseText(decoder.decode());
        const tail = extractSseData(parseBuffer.trim());
        if (tail && tail !== "[DONE]") {
          try {
            absorbPayload(JSON.parse(tail));
          } catch {
            // ignore non-json frame
          }
        }
        parseBuffer = "";
        void persistUsageEvent(context, explicitUsage, completionText, reasoningText);
        controller.close();
        return;
      }

      if (value) {
        processSseText(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    }
  });

  return new Response(trackedBody, {
    status: upstream.status,
    headers: upstream.headers
  });
}

function transformSseStream(
  upstream: Response,
  handlers: {
    onStart?: (emitJson: (payload: unknown) => void, emitRaw: (rawData: string) => void) => void;
    onData: (
      data: string,
      emitJson: (payload: unknown) => void,
      emitRaw: (rawData: string) => void
    ) => void;
    onDone?: (emitJson: (payload: unknown) => void, emitRaw: (rawData: string) => void) => void;
  }
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitRaw = (rawData: string) => {
        controller.enqueue(encoder.encode(`data: ${rawData}\n\n`));
      };
      const emitJson = (payload: unknown) => {
        emitRaw(JSON.stringify(payload));
      };

      let closed = false;
      const finish = () => {
        if (closed) {
          return;
        }
        closed = true;
        handlers.onDone?.(emitJson, emitRaw);
        emitRaw("[DONE]");
        controller.close();
      };

      try {
        handlers.onStart?.(emitJson, emitRaw);
        if (!upstream.body) {
          finish();
          return;
        }

        const reader = upstream.body.getReader();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = extractSseData(block);
            if (data) {
              if (data === "[DONE]") {
                finish();
                return;
              }
              handlers.onData(data, emitJson, emitRaw);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        const tail = extractSseData(buffer.trim());
        if (tail && tail !== "[DONE]") {
          handlers.onData(tail, emitJson, emitRaw);
        }
        finish();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    status: upstream.status,
    headers: SSE_RESPONSE_HEADERS
  });
}

function transformChatStreamToResponses(
  upstream: Response,
  model: string,
  options?: {
    promptTokensEstimate?: number;
    customToolNames?: Set<string>;
    onCompleted?: (payload: {
      responseId: string;
      assistantMessage: LegacyChatMessage | null;
    }) => void | Promise<void>;
  }
) {
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "")}`;
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
  const reasoningItemId = `rs_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  type ResponseOutputTextPart = {
    type: "output_text";
    text: string;
    annotations: unknown[];
  };
  type ResponseReasoningTextPart = {
    type: "reasoning_text";
    text: string;
  };
  type ResponseOutputItem =
    | {
        id: string;
        type: "message";
        role: "assistant";
        status: "in_progress" | "completed";
        content: ResponseOutputTextPart[];
      }
    | {
        id: string;
        type: "reasoning";
        status: "in_progress" | "completed";
        content: ResponseReasoningTextPart[];
        summary: Array<{
          type: "summary_text";
          text: string;
        }>;
      }
    | {
        id: string;
        type: "function_call";
        call_id: string;
        name: string;
        arguments: string;
        status: "in_progress" | "completed";
      }
    | {
        id: string;
        type: "custom_tool_call";
        call_id: string;
        name: string;
        input: string;
        status: "in_progress" | "completed";
      };

  type PendingToolCall = {
    index: number;
    callId: string;
    itemId: string;
    name: string;
    arguments: string;
    itemAdded: boolean;
    outputIndex: number;
    emittedPayloadLength: number;
  };

  let completed = false;
  let outputText = "";
  let reasoningText = "";
  let emittedReasoningDelta = false;
  let explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null = null;
  let emittedTextDelta = false;
  let reasoningItemAdded = false;
  let reasoningPartAdded = false;
  let reasoningItemDone = false;
  let messageItemAdded = false;
  let contentPartAdded = false;
  let messageItemDone = false;
  let toolCallsDone = false;
  let reasoningOutputIndex = -1;
  let messageOutputIndex = -1;
  const pendingToolCalls = new Map<number, PendingToolCall>();
  const completedOutputItems: ResponseOutputItem[] = [];
  const isCustomToolCall = (callName: string) => options?.customToolNames?.has(callName.trim()) ?? false;
  const getToolCallPayload = (call: PendingToolCall, allowFallback = true) =>
    isCustomToolCall(call.name)
      ? extractCustomToolInputFromChatArguments(call.arguments, allowFallback)
      : call.arguments;

  const ensureMessageItemAdded = (emitJson: (payload: unknown) => void) => {
    if (messageItemAdded) {
      return;
    }
    messageItemAdded = true;
    const messageItem: ResponseOutputItem = {
      id: messageId,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [
        {
          type: "output_text",
          text: "",
          annotations: []
        }
      ]
    };
    messageOutputIndex = completedOutputItems.push(messageItem) - 1;
    emitJson({
      type: "response.output_item.added",
      output_index: messageOutputIndex,
      item: messageItem
    });
    if (!contentPartAdded) {
      contentPartAdded = true;
      emitJson({
        type: "response.content_part.added",
        item_id: messageId,
        output_index: messageOutputIndex,
        content_index: 0,
        part: messageItem.content[0]
      });
    }
  };

  const getMessageItem = () => {
    if (messageOutputIndex < 0) {
      return null;
    }
    const messageItem = completedOutputItems[messageOutputIndex];
    return messageItem && messageItem.type === "message" ? messageItem : null;
  };

  const ensureReasoningItemAdded = (emitJson: (payload: unknown) => void) => {
    if (reasoningItemAdded) {
      return;
    }
    reasoningItemAdded = true;
    const reasoningItem: ResponseOutputItem = {
      id: reasoningItemId,
      type: "reasoning",
      status: "in_progress",
      content: [],
      summary: []
    };
    reasoningOutputIndex = completedOutputItems.push(reasoningItem) - 1;
    emitJson({
      type: "response.output_item.added",
      output_index: reasoningOutputIndex,
      item: reasoningItem
    });
  };

  const getReasoningItem = () => {
    if (reasoningOutputIndex < 0) {
      return null;
    }
    const reasoningItem = completedOutputItems[reasoningOutputIndex];
    return reasoningItem && reasoningItem.type === "reasoning" ? reasoningItem : null;
  };

  const ensureReasoningPartAdded = (emitJson: (payload: unknown) => void) => {
    ensureReasoningItemAdded(emitJson);
    const reasoningItem = getReasoningItem();
    if (!reasoningItem || reasoningPartAdded) {
      return;
    }
    reasoningPartAdded = true;
    const part: ResponseReasoningTextPart = {
      type: "reasoning_text",
      text: ""
    };
    reasoningItem.content.push(part);
    emitJson({
      type: "response.content_part.added",
      item_id: reasoningItemId,
      output_index: reasoningOutputIndex,
      content_index: 0,
      part
    });
  };

  const emitReasoningItemDone = (emitJson: (payload: unknown) => void) => {
    if (reasoningItemDone || !reasoningText) {
      return;
    }
    ensureReasoningPartAdded(emitJson);
    const reasoningItem = getReasoningItem();
    if (!reasoningItem || !reasoningItem.content[0]) {
      return;
    }
    reasoningItem.content[0].text = reasoningText;
    reasoningItem.summary = [
      {
        type: "summary_text",
        text: reasoningText
      }
    ];
    reasoningItem.status = "completed";
    emitJson({
      type: "response.reasoning_text.done",
      item_id: reasoningItemId,
      output_index: reasoningOutputIndex,
      content_index: 0,
      text: reasoningText
    });
    emitJson({
      type: "response.content_part.done",
      item_id: reasoningItemId,
      output_index: reasoningOutputIndex,
      content_index: 0,
      part: reasoningItem.content[0]
    });
    emitJson({
      type: "response.output_item.done",
      output_index: reasoningOutputIndex,
      item: reasoningItem
    });
    reasoningItemDone = true;
  };

  const ensureToolCallItemAdded = (
    emitJson: (payload: unknown) => void,
    call: PendingToolCall
  ) => {
    if (call.itemAdded) {
      return;
    }
    const toolName = call.name || "unknown_tool";
    const item: ResponseOutputItem = isCustomToolCall(toolName)
      ? {
          id: call.itemId,
          type: "custom_tool_call",
          call_id: call.callId,
          name: toolName,
          input: "",
          status: "in_progress"
        }
      : {
          id: call.itemId,
          type: "function_call",
          call_id: call.callId,
          name: toolName,
          arguments: "",
          status: "in_progress"
        };
    call.outputIndex = completedOutputItems.push(item) - 1;
    call.itemAdded = true;
    emitJson({
      type: "response.output_item.added",
      output_index: call.outputIndex,
      item
    });
  };

  const emitToolCallPayloadDelta = (
    emitJson: (payload: unknown) => void,
    call: PendingToolCall
  ) => {
    if (!call.itemAdded || call.outputIndex < 0) {
      return;
    }
    const item = completedOutputItems[call.outputIndex];
    if (!item || (item.type !== "function_call" && item.type !== "custom_tool_call")) {
      return;
    }
    const toolName = call.name || "unknown_tool";
    const payload = getToolCallPayload(call, item.type !== "custom_tool_call");
    if (payload == null) {
      return;
    }
    item.call_id = call.callId;
    item.name = toolName;
    if (item.type === "custom_tool_call") {
      item.input = payload;
    } else {
      item.arguments = payload;
    }
    const delta = payload.slice(call.emittedPayloadLength);
    if (!delta) {
      return;
    }
    call.emittedPayloadLength = payload.length;
    if (item.type === "custom_tool_call") {
      emitJson({
        type: "response.custom_tool_call_input.delta",
        item_id: call.itemId,
        output_index: call.outputIndex,
        delta
      });
      return;
    }
    emitJson({
      type: "response.function_call_arguments.delta",
      item_id: call.itemId,
      output_index: call.outputIndex,
      delta
    });
  };

  const emitMessageItemDone = (emitJson: (payload: unknown) => void) => {
    if (messageItemDone) {
      return;
    }
    ensureMessageItemAdded(emitJson);
    const messageItem = getMessageItem();
    if (!messageItem) {
      return;
    }
    messageItem.content[0].text = outputText;
    messageItem.status = "completed";
    emitJson({
      type: "response.output_text.done",
      item_id: messageId,
      output_index: messageOutputIndex,
      content_index: 0,
      text: outputText
    });
    emitJson({
      type: "response.content_part.done",
      item_id: messageId,
      output_index: messageOutputIndex,
      content_index: 0,
      part: messageItem.content[0]
    });
    emitJson({
      type: "response.output_item.done",
      output_index: messageOutputIndex,
      item: messageItem
    });
    messageItemDone = true;
  };

  const emitToolCalls = (emitJson: (payload: unknown) => void) => {
    if (toolCallsDone) {
      return;
    }
    const calls = Array.from(pendingToolCalls.values()).sort((a, b) => a.index - b.index);
    if (!calls.length) {
      return;
    }

    for (const call of calls) {
      ensureToolCallItemAdded(emitJson, call);
      emitToolCallPayloadDelta(emitJson, call);
      const item = completedOutputItems[call.outputIndex];
      if (!item || (item.type !== "function_call" && item.type !== "custom_tool_call")) {
        continue;
      }
      const toolName = call.name || "unknown_tool";
      const payload = getToolCallPayload(call);
      item.call_id = call.callId;
      item.name = toolName;
      if (item.type === "custom_tool_call") {
        item.input = payload ?? "";
      } else {
        item.arguments = payload ?? "";
      }
      item.status = "completed";
      if (item.type === "custom_tool_call") {
        emitToolCallPayloadDelta(emitJson, call);
        emitJson({
          type: "response.custom_tool_call_input.done",
          item_id: call.itemId,
          output_index: call.outputIndex,
          input: item.input
        });
      } else {
        emitJson({
          type: "response.function_call_arguments.done",
          item_id: call.itemId,
          output_index: call.outputIndex,
          arguments: item.arguments
        });
      }
      emitJson({
        type: "response.output_item.done",
        output_index: call.outputIndex,
        item
      });
    }
    toolCallsDone = true;
  };

  const emitCompleted = (emitJson: (payload: unknown) => void) => {
    if (completed) {
      return;
    }

    if (!emittedReasoningDelta && reasoningText) {
      ensureReasoningPartAdded(emitJson);
      const reasoningItem = getReasoningItem();
      if (reasoningItem && reasoningItem.content[0]) {
        reasoningItem.content[0].text = reasoningText;
      }
      emitJson({
        type: "response.reasoning_text.delta",
        item_id: reasoningItemId,
        output_index: reasoningOutputIndex,
        content_index: 0,
        delta: reasoningText
      });
      emittedReasoningDelta = true;
    }
    if (!emittedTextDelta && outputText) {
      ensureMessageItemAdded(emitJson);
      const messageItem = getMessageItem();
      if (messageItem) {
        messageItem.content[0].text = outputText;
      }
      emitJson({
        type: "response.output_text.delta",
        item_id: messageId,
        output_index: messageOutputIndex,
        content_index: 0,
        delta: outputText
      });
      emittedTextDelta = true;
    }
    emitReasoningItemDone(emitJson);
    if (outputText) {
      emitMessageItemDone(emitJson);
    }
    emitToolCalls(emitJson);
    completed = true;
    const completionTokensEstimate = outputText
      ? estimatePlainTextTokens(outputText, model)
      : 0;
    const usage = normalizeUsageValues(
      explicitUsage,
      Math.max(0, options?.promptTokensEstimate ?? 0),
      completionTokensEstimate
    );
    emitJson({
      type: "response.completed",
      response: {
        id: responseId,
        object: "response",
        created_at: createdAt,
        model,
        status: "completed",
        output: completedOutputItems,
        output_text: outputText,
        usage: {
          input_tokens: usage.promptTokens,
          output_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
          input_tokens_details: {
            cached_tokens: 0
          },
          output_tokens_details: {
            reasoning_tokens: 0
          }
        },
        incomplete_details: null
      }
    });
    if (options?.onCompleted) {
      const assistantToolCalls = Array.from(pendingToolCalls.values())
        .sort((a, b) => a.index - b.index)
        .map((call) => ({
          id: call.callId,
          type: "function" as const,
          function: {
            name: call.name || "unknown_tool",
            arguments: call.arguments
          }
        }));
      const assistantMessage =
        outputText || assistantToolCalls.length || reasoningText.trim()
          ? ({
              role: "assistant",
              content: outputText,
              ...(reasoningText.trim() ? { reasoning_content: reasoningText } : {}),
              ...(assistantToolCalls.length ? { tool_calls: assistantToolCalls } : {})
            } satisfies LegacyChatMessage)
          : null;

      void Promise.resolve(
        options.onCompleted({
          responseId,
          assistantMessage
        })
      ).catch((error) => {
        console.error(
          "[responses] persist continuation context failed",
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  };

  return transformSseStream(upstream, {
    onStart: (emitJson) => {
      emitJson({
        type: "response.created",
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          model,
          status: "in_progress"
        }
      });
      emitJson({
        type: "response.in_progress",
        response: {
          id: responseId,
          object: "response",
          created_at: createdAt,
          model,
          status: "in_progress"
        }
      });
    },
    onData: (data, emitJson, emitRaw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const usageFromPayload = extractTokenUsageFromPayload(payload);
      if (usageFromPayload) {
        explicitUsage = usageFromPayload;
      }

      if (
        payload &&
        typeof payload === "object" &&
        "type" in payload &&
        typeof (payload as { type?: unknown }).type === "string" &&
        (payload as { type: string }).type.startsWith("response.")
      ) {
        emitRaw(JSON.stringify(payload));
        if ((payload as { type: string }).type === "response.completed") {
          completed = true;
        }
        return;
      }

      const toolCallDeltas = extractChatToolCallDeltasFromChunk(payload);
      for (const toolCallDelta of toolCallDeltas) {
        const existing = pendingToolCalls.get(toolCallDelta.index) ?? {
          index: toolCallDelta.index,
          callId:
            toolCallDelta.callId ??
            `call_${responseId}_${Math.max(0, toolCallDelta.index)}`,
          itemId: `fc_${crypto.randomUUID().replace(/-/g, "")}`,
          name: "",
          arguments: "",
          itemAdded: false,
          outputIndex: -1,
          emittedPayloadLength: 0
        };

        if (toolCallDelta.callId) {
          existing.callId = toolCallDelta.callId;
        }
        if (toolCallDelta.namePart) {
          if (!existing.name) {
            existing.name = toolCallDelta.namePart;
          } else if (!existing.name.endsWith(toolCallDelta.namePart)) {
            existing.name += toolCallDelta.namePart;
          }
        }
        if (toolCallDelta.argumentsPart) {
          existing.arguments += toolCallDelta.argumentsPart;
        }
        pendingToolCalls.set(toolCallDelta.index, existing);
        if (existing.name && !existing.itemAdded) {
          ensureToolCallItemAdded(emitJson, existing);
        }
        emitToolCallPayloadDelta(emitJson, existing);
      }

      const delta = extractChatDeltaTextFromChunk(payload);
      if (delta) {
        ensureMessageItemAdded(emitJson);
        const messageItem = getMessageItem();
        outputText += delta;
        if (messageItem) {
          messageItem.content[0].text = outputText;
        }
        emittedTextDelta = true;
        emitJson({
          type: "response.output_text.delta",
          item_id: messageId,
          output_index: messageOutputIndex,
          content_index: 0,
          delta
        });
      }

      const reasoningDelta = extractChatReasoningDeltaFromChunk(payload);
      if (reasoningDelta) {
        ensureReasoningPartAdded(emitJson);
        const reasoningItem = getReasoningItem();
        reasoningText += reasoningDelta;
        if (reasoningItem && reasoningItem.content[0]) {
          reasoningItem.content[0].text = reasoningText;
        }
        emittedReasoningDelta = true;
        emitJson({
          type: "response.reasoning_text.delta",
          item_id: reasoningItemId,
          output_index: reasoningOutputIndex,
          content_index: 0,
          delta: reasoningDelta
        });
      }

      const finishReason = extractChatFinishReason(payload);
      if (finishReason && !completed) {
        if (!outputText.trim() && reasoningText.trim()) {
          outputText = reasoningText;
        }
        if (pendingToolCalls.size && (finishReason === "tool_calls" || !outputText.trim())) {
          emitToolCalls(emitJson);
        }
        emitCompleted(emitJson);
      }
    },
    onDone: (emitJson) => {
      if (!outputText.trim() && reasoningText.trim()) {
        outputText = reasoningText;
      }
      if (pendingToolCalls.size && !outputText.trim()) {
        emitToolCalls(emitJson);
      }
      emitCompleted(emitJson);
    }
  });
}

function transformChatStreamToAnthropic(
  upstream: Response,
  model: string,
  options?: {
    promptTokensEstimate?: number;
  }
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitEvent = (event: string, payload: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      let closed = false;
      let buffer = "";
      let messageStarted = false;
      let messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
      let resolvedModel = model;
      let nextContentIndex = 0;
      let activeThinkingBlockIndex: number | null = null;
      let thinkingBlockClosed = true;
      let activeTextBlockIndex: number | null = null;
      let textBlockClosed = true;
      let emittedThinking = false;
      let emittedText = false;
      let finalOutputTokens = 0;
      let stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" = "end_turn";

      type PendingToolCall = {
        index: number;
        callId: string;
        name: string;
        arguments: string;
        emitted: boolean;
      };

      const pendingToolCalls = new Map<number, PendingToolCall>();

      const ensureMessageStarted = (inputTokens?: number) => {
        if (messageStarted) {
          return;
        }

        emitEvent("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: resolvedModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: Math.max(0, Math.floor(inputTokens ?? options?.promptTokensEstimate ?? 0)),
              output_tokens: 0
            }
          }
        });
        messageStarted = true;
      };

      const closeThinkingBlock = () => {
        if (activeThinkingBlockIndex === null || thinkingBlockClosed) {
          return;
        }
        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index: activeThinkingBlockIndex
        });
        thinkingBlockClosed = true;
      };

      const closeTextBlock = () => {
        if (activeTextBlockIndex === null || textBlockClosed) {
          return;
        }
        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index: activeTextBlockIndex
        });
        textBlockClosed = true;
      };

      const ensureThinkingBlock = () => {
        ensureMessageStarted();
        closeTextBlock();
        if (activeThinkingBlockIndex !== null && !thinkingBlockClosed) {
          return;
        }
        activeThinkingBlockIndex = nextContentIndex;
        nextContentIndex += 1;
        thinkingBlockClosed = false;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index: activeThinkingBlockIndex,
          content_block: {
            type: "thinking",
            thinking: ""
          }
        });
      };

      const ensureTextBlock = () => {
        ensureMessageStarted();
        closeThinkingBlock();
        if (activeTextBlockIndex !== null && !textBlockClosed) {
          return;
        }
        activeTextBlockIndex = nextContentIndex;
        nextContentIndex += 1;
        textBlockClosed = false;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index: activeTextBlockIndex,
          content_block: {
            type: "text",
            text: ""
          }
        });
      };

      const emitThinkingDelta = (delta: string) => {
        if (!delta) {
          return;
        }
        ensureThinkingBlock();
        emittedThinking = true;
        emitEvent("content_block_delta", {
          type: "content_block_delta",
          index: activeThinkingBlockIndex,
          delta: {
            type: "thinking_delta",
            thinking: delta
          }
        });
      };

      const emitTextDelta = (delta: string) => {
        if (!delta) {
          return;
        }
        ensureTextBlock();
        emittedText = true;
        emitEvent("content_block_delta", {
          type: "content_block_delta",
          index: activeTextBlockIndex,
          delta: {
            type: "text_delta",
            text: delta
          }
        });
      };

      const emitToolUse = (call: PendingToolCall) => {
        if (call.emitted || !call.callId.trim()) {
          return;
        }
        ensureMessageStarted();
        closeThinkingBlock();
        closeTextBlock();

        const index = nextContentIndex;
        nextContentIndex += 1;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: call.callId.trim(),
            name: call.name || "unknown_tool",
            input: {}
          }
        });
        if (call.arguments.trim()) {
          emitEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: {
              type: "input_json_delta",
              partial_json: call.arguments
            }
          });
        }
        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index
        });
        call.emitted = true;
        stopReason = "tool_use";
      };

      const emitPendingToolCalls = () => {
        for (const call of Array.from(pendingToolCalls.values()).sort((a, b) => a.index - b.index)) {
          emitToolUse(call);
        }
      };

      const finish = () => {
        if (closed) {
          return;
        }
        closed = true;
        closeThinkingBlock();
        closeTextBlock();
        emitPendingToolCalls();
        ensureMessageStarted();
        emitEvent("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: stopReason,
            stop_sequence: null
          },
          usage: {
            output_tokens: finalOutputTokens
          }
        });
        emitEvent("message_stop", {
          type: "message_stop"
        });
        controller.close();
      };

      const processPayload = (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }

        const usage = extractTokenUsageFromPayload(payload);
        if (usage) {
          finalOutputTokens = Math.max(finalOutputTokens, usage.completionTokens ?? 0);
        }

        const reasoningDelta = extractChatReasoningDeltaFromChunk(payload);
        if (reasoningDelta) {
          emitThinkingDelta(reasoningDelta);
        }

        for (const toolCallDelta of extractChatToolCallDeltasFromChunk(payload)) {
          const existing = pendingToolCalls.get(toolCallDelta.index) ?? {
            index: toolCallDelta.index,
            callId: toolCallDelta.callId ?? `call_${messageId}_${Math.max(0, toolCallDelta.index)}`,
            name: "",
            arguments: "",
            emitted: false
          };

          if (toolCallDelta.callId) {
            existing.callId = toolCallDelta.callId;
          }
          if (toolCallDelta.namePart) {
            if (!existing.name) {
              existing.name = toolCallDelta.namePart;
            } else if (!existing.name.endsWith(toolCallDelta.namePart)) {
              existing.name += toolCallDelta.namePart;
            }
          }
          if (toolCallDelta.argumentsPart) {
            existing.arguments += toolCallDelta.argumentsPart;
          }
          pendingToolCalls.set(toolCallDelta.index, existing);
        }

        const textDelta = extractChatDeltaTextFromChunk(payload);
        if (textDelta) {
          emitTextDelta(textDelta);
        }

        const finishReason = extractChatFinishReason(payload);
        if (!finishReason) {
          return;
        }
        if (finishReason === "tool_calls") {
          stopReason = "tool_use";
        } else if (finishReason === "length") {
          stopReason = "max_tokens";
        } else {
          stopReason = "end_turn";
        }
        finish();
      };

      try {
        if (!upstream.body) {
          finish();
          return;
        }

        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = extractSseData(block);
            if (data && data !== "[DONE]") {
              try {
                processPayload(JSON.parse(data));
              } catch {
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        const tail = extractSseData(buffer.trim());
        if (tail && tail !== "[DONE]") {
          try {
            processPayload(JSON.parse(tail));
          } catch {
          }
        }
        finish();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    status: upstream.status,
    headers: SSE_RESPONSE_HEADERS
  });
}

function transformResponsesStreamToLegacyChat(upstream: Response, model: string) {
  const chatId = `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`;
  const created = Math.floor(Date.now() / 1000);
  let finished = false;
  let sentAssistantRole = false;

  const emitFinishChunk = (emitJson: (payload: unknown) => void) => {
    if (finished) {
      return;
    }
    finished = true;
    emitJson({
      id: chatId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop"
        }
      ]
    });
  };

  return transformSseStream(upstream, {
    onData: (data, emitJson, emitRaw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }

      if (
        payload &&
        typeof payload === "object" &&
        (payload as { object?: unknown }).object === "chat.completion.chunk"
      ) {
        emitRaw(JSON.stringify(payload));
        return;
      }

      const type = (payload as { type?: unknown })?.type;
      if (typeof type !== "string") {
        return;
      }

      if (type === "response.output_text.delta") {
        const delta = (payload as { delta?: unknown }).delta;
        if (typeof delta !== "string" || !delta) {
          return;
        }

        emitJson({
          id: chatId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [
            {
              index: 0,
              delta: sentAssistantRole ? { content: delta } : { role: "assistant", content: delta },
              finish_reason: null
            }
          ]
        });
        sentAssistantRole = true;
        return;
      }

      if (type === "response.completed") {
        emitFinishChunk(emitJson);
      }
    },
    onDone: (emitJson) => {
      emitFinishChunk(emitJson);
    }
  });
}

function transformResponsesStreamToLegacyCompletion(upstream: Response, model: string) {
  const completionId = `cmpl_${crypto.randomUUID().replace(/-/g, "")}`;
  const created = Math.floor(Date.now() / 1000);
  let finished = false;

  const emitFinishChunk = (emitJson: (payload: unknown) => void) => {
    if (finished) {
      return;
    }
    finished = true;
    emitJson({
      id: completionId,
      object: "text_completion",
      created,
      model,
      choices: [
        {
          text: "",
          index: 0,
          finish_reason: "stop"
        }
      ]
    });
  };

  return transformSseStream(upstream, {
    onData: (data, emitJson, emitRaw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }

      if (
        payload &&
        typeof payload === "object" &&
        (payload as { object?: unknown }).object === "text_completion"
      ) {
        emitRaw(JSON.stringify(payload));
        return;
      }

      const type = (payload as { type?: unknown })?.type;
      if (typeof type !== "string") {
        return;
      }

      if (type === "response.output_text.delta") {
        const delta = (payload as { delta?: unknown }).delta;
        if (typeof delta !== "string" || !delta) {
          return;
        }

        emitJson({
          id: completionId,
          object: "text_completion",
          created,
          model,
          choices: [
            {
              text: delta,
              index: 0,
              finish_reason: null
            }
          ]
        });
        return;
      }

      if (type === "response.completed") {
        emitFinishChunk(emitJson);
      }
    },
    onDone: (emitJson) => {
      emitFinishChunk(emitJson);
    }
  });
}

function transformResponsesStreamToAnthropic(
  upstream: Response,
  model: string,
  options?: {
    promptTokensEstimate?: number;
  }
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitEvent = (event: string, payload: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      let closed = false;
      let buffer = "";
      let messageStarted = false;
      let messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
      let resolvedModel = model;
      let nextContentIndex = 0;
      let activeThinkingBlockIndex: number | null = null;
      let thinkingBlockClosed = true;
      let activeTextBlockIndex: number | null = null;
      let textBlockClosed = true;
      let emittedThinking = false;
      let emittedText = false;
      let finalOutputTokens = 0;
      let stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" = "end_turn";
      const emittedToolIds = new Set<string>();

      const ensureMessageStarted = (params?: {
        id?: string;
        model?: string;
        inputTokens?: number;
      }) => {
        if (messageStarted) {
          return;
        }
        if (
          typeof params?.id === "string" &&
          params.id.trim() &&
          params.id.trim().startsWith("msg_")
        ) {
          messageId = params.id.trim();
        }
        if (typeof params?.model === "string" && params.model.trim()) {
          resolvedModel = params.model.trim();
        }

        emitEvent("message_start", {
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            model: resolvedModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: Math.max(
                0,
                Math.floor(params?.inputTokens ?? options?.promptTokensEstimate ?? 0)
              ),
              output_tokens: 0
            }
          }
        });
        messageStarted = true;
      };

      const closeThinkingBlock = () => {
        if (activeThinkingBlockIndex === null || thinkingBlockClosed) {
          return;
        }
        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index: activeThinkingBlockIndex
        });
        thinkingBlockClosed = true;
      };

      const ensureThinkingBlock = () => {
        ensureMessageStarted();
        closeTextBlock();
        if (activeThinkingBlockIndex !== null && !thinkingBlockClosed) {
          return;
        }
        activeThinkingBlockIndex = nextContentIndex;
        nextContentIndex += 1;
        thinkingBlockClosed = false;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index: activeThinkingBlockIndex,
          content_block: {
            type: "thinking",
            thinking: ""
          }
        });
      };

      const closeTextBlock = () => {
        if (activeTextBlockIndex === null || textBlockClosed) {
          return;
        }
        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index: activeTextBlockIndex
        });
        textBlockClosed = true;
      };

      const ensureTextBlock = () => {
        ensureMessageStarted();
        closeThinkingBlock();
        if (activeTextBlockIndex !== null && !textBlockClosed) {
          return;
        }
        activeTextBlockIndex = nextContentIndex;
        nextContentIndex += 1;
        textBlockClosed = false;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index: activeTextBlockIndex,
          content_block: {
            type: "text",
            text: ""
          }
        });
      };

      const emitThinkingDelta = (delta: string) => {
        if (!delta) {
          return;
        }
        ensureThinkingBlock();
        emittedThinking = true;
        emitEvent("content_block_delta", {
          type: "content_block_delta",
          index: activeThinkingBlockIndex,
          delta: {
            type: "thinking_delta",
            thinking: delta
          }
        });
      };

      const emitTextDelta = (delta: string) => {
        if (!delta) {
          return;
        }
        ensureTextBlock();
        emittedText = true;
        emitEvent("content_block_delta", {
          type: "content_block_delta",
          index: activeTextBlockIndex,
          delta: {
            type: "text_delta",
            text: delta
          }
        });
      };

      const emitToolUse = (toolId: string, name: string, inputJson: string) => {
        const normalizedToolId = toolId.trim();
        if (!normalizedToolId || emittedToolIds.has(normalizedToolId)) {
          return;
        }
        emittedToolIds.add(normalizedToolId);
        ensureMessageStarted();
        closeThinkingBlock();
        closeTextBlock();

        const index = nextContentIndex;
        nextContentIndex += 1;
        emitEvent("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: normalizedToolId,
            name,
            input: {}
          }
        });

        if (inputJson.trim()) {
          emitEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: {
              type: "input_json_delta",
              partial_json: inputJson
            }
          });
        }

        emitEvent("content_block_stop", {
          type: "content_block_stop",
          index
        });
        stopReason = "tool_use";
      };

      const emitFromAnthropicMessage = (
        anthropicMessage: ReturnType<typeof mapResponsesToAnthropicMessage>
      ) => {
        for (const block of anthropicMessage.content) {
          if (block.type === "thinking") {
            if (!emittedThinking && block.thinking) {
              emitThinkingDelta(block.thinking);
            }
            continue;
          }
          if (block.type === "text") {
            if (!emittedText && block.text) {
              emitTextDelta(block.text);
            }
            continue;
          }
          emitToolUse(block.id, block.name, JSON.stringify(block.input));
        }
        if (stopReason !== "tool_use") {
          stopReason = anthropicMessage.stop_reason;
        }
        finalOutputTokens = Math.max(finalOutputTokens, anthropicMessage.usage.output_tokens);
      };

      const finish = () => {
        if (closed) {
          return;
        }
        closed = true;
        closeThinkingBlock();
        closeTextBlock();
        ensureMessageStarted();
        emitEvent("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: stopReason,
            stop_sequence: null
          },
          usage: {
            output_tokens: finalOutputTokens
          }
        });
        emitEvent("message_stop", {
          type: "message_stop"
        });
        controller.close();
      };

      const processPayload = (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }

        const type = (payload as { type?: unknown }).type;
        if (type === "response.created") {
          const response = (payload as { response?: { id?: unknown; model?: unknown } }).response;
          ensureMessageStarted({
            id: typeof response?.id === "string" ? response.id : undefined,
            model: typeof response?.model === "string" ? response.model : undefined,
            inputTokens:
              extractTokenUsageFromPayload(payload)?.promptTokens ?? options?.promptTokensEstimate
          });
          return;
        }

        if (type === "response.output_text.delta") {
          const delta = (payload as { delta?: unknown }).delta;
          if (typeof delta === "string" && delta) {
            emitTextDelta(delta);
          }
          return;
        }

        const reasoningDelta = extractResponsesReasoningDelta(payload);
        if (reasoningDelta) {
          emitThinkingDelta(reasoningDelta);
          return;
        }

        if (type === "response.output_item.done") {
          const item = (payload as { item?: unknown }).item;
          if (!item || typeof item !== "object") {
            return;
          }
          const itemType = "type" in item ? (item as { type?: unknown }).type : undefined;
          if (itemType === "function_call") {
            const callId = "call_id" in item ? (item as { call_id?: unknown }).call_id : undefined;
            const name = "name" in item ? (item as { name?: unknown }).name : undefined;
            const args = "arguments" in item ? (item as { arguments?: unknown }).arguments : undefined;
            if (
              typeof callId === "string" &&
              callId.trim() &&
              typeof name === "string" &&
              name.trim()
            ) {
              emitToolUse(callId.trim(), name.trim(), typeof args === "string" ? args : "");
            }
            return;
          }

          if ((itemType === "message" || itemType === "reasoning") && (!emittedText || !emittedThinking)) {
            const anthropicMessage = mapResponsesToAnthropicMessage(
              {
                model: resolvedModel,
                output: [item]
              },
              resolvedModel
            );
            emitFromAnthropicMessage(anthropicMessage);
          }
          return;
        }

        if (type === "response.completed") {
          const response = (payload as { response?: unknown }).response;
          const anthropicMessage = mapResponsesToAnthropicMessage(response, resolvedModel);
          ensureMessageStarted({
            id: anthropicMessage.id,
            model: anthropicMessage.model,
            inputTokens:
              extractTokenUsageFromPayload(response)?.promptTokens ?? options?.promptTokensEstimate
          });
          resolvedModel = anthropicMessage.model;
          emitFromAnthropicMessage(anthropicMessage);
          finish();
        }
      };

      try {
        if (!upstream.body) {
          finish();
          return;
        }

        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = extractSseData(block);
            if (data && data !== "[DONE]") {
              try {
                processPayload(JSON.parse(data));
              } catch {
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        const tail = extractSseData(buffer.trim());
        if (tail && tail !== "[DONE]") {
          try {
            processPayload(JSON.parse(tail));
          } catch {
          }
        }
        finish();
      } catch (error) {
        controller.error(error);
      }
    }
  });

  return new Response(stream, {
    status: upstream.status,
    headers: SSE_RESPONSE_HEADERS
  });
}

function transformAnthropicStreamToResponses(
  upstream: Response,
  model: string,
  options?: {
    promptTokensEstimate?: number;
    onCompleted?: (payload: {
      responseId: string;
      assistantMessage: LegacyChatMessage | null;
    }) => void | Promise<void>;
  }
) {
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  type ResponseOutputItem =
    | {
        id: string;
        type: "message";
        role: "assistant";
        content: Array<{
          type: "output_text";
          text: string;
        }>;
      }
    | {
        type: "function_call";
        call_id: string;
        name: string;
        arguments: string;
      };

  type PendingToolCall = {
    index: number;
    callId: string;
    name: string;
    arguments: string;
    emitted: boolean;
  };

  let completed = false;
  let outputText = "";
  let explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null = null;
  let responseCreated = false;
  let messageItemDone = false;
  const pendingToolCalls = new Map<number, PendingToolCall>();
  const completedOutputItems: ResponseOutputItem[] = [];

  const ensureResponseCreated = (emitJson: (payload: unknown) => void) => {
    if (responseCreated) {
      return;
    }
    emitJson({
      type: "response.created",
      response: {
        id: responseId,
        object: "response",
        created_at: createdAt,
        model,
        status: "in_progress"
      }
    });
    responseCreated = true;
  };

  const emitMessageItemDone = (emitJson: (payload: unknown) => void) => {
    if (messageItemDone) {
      return;
    }
    const item: ResponseOutputItem = {
      id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: outputText
        }
      ]
    };
    emitJson({
      type: "response.output_item.done",
      item
    });
    completedOutputItems.push(item);
    messageItemDone = true;
  };

  const emitPendingToolCall = (emitJson: (payload: unknown) => void, call: PendingToolCall) => {
    if (call.emitted) {
      return;
    }
    const item: ResponseOutputItem = {
      type: "function_call",
      call_id: call.callId,
      name: call.name || "unknown_tool",
      arguments: call.arguments
    };
    emitJson({
      type: "response.output_item.done",
      item
    });
    completedOutputItems.push(item);
    call.emitted = true;
  };

  const emitCompleted = (emitJson: (payload: unknown) => void) => {
    if (completed) {
      return;
    }
    ensureResponseCreated(emitJson);
    if (outputText || !messageItemDone) {
      emitMessageItemDone(emitJson);
    }
    for (const call of Array.from(pendingToolCalls.values()).sort((a, b) => a.index - b.index)) {
      emitPendingToolCall(emitJson, call);
    }
    completed = true;
    const completionTokensEstimate = outputText
      ? estimatePlainTextTokens(outputText, model)
      : 0;
    const usage = normalizeUsageValues(
      explicitUsage,
      Math.max(0, options?.promptTokensEstimate ?? 0),
      completionTokensEstimate
    );
    emitJson({
      type: "response.completed",
      response: {
        id: responseId,
        object: "response",
        created_at: createdAt,
        model,
        status: "completed",
        output: completedOutputItems,
        output_text: outputText,
        usage: {
          input_tokens: usage.promptTokens,
          output_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
          input_tokens_details: {
            cached_tokens: 0
          },
          output_tokens_details: {
            reasoning_tokens: 0
          }
        },
        incomplete_details: null
      }
    });
    if (options?.onCompleted) {
      const assistantToolCalls = Array.from(pendingToolCalls.values())
        .sort((a, b) => a.index - b.index)
        .map((call) => ({
          id: call.callId,
          type: "function" as const,
          function: {
            name: call.name || "unknown_tool",
            arguments: call.arguments
          }
        }));
      const assistantMessage =
        outputText || assistantToolCalls.length
          ? ({
              role: "assistant",
              content: outputText,
              ...(assistantToolCalls.length ? { tool_calls: assistantToolCalls } : {})
            } satisfies LegacyChatMessage)
          : null;
      void Promise.resolve(
        options.onCompleted({
          responseId,
          assistantMessage
        })
      ).catch((error) => {
        console.error(
          "[responses] anthropic continuation context failed",
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  };

  return transformSseStream(upstream, {
    onStart: (emitJson) => {
      ensureResponseCreated(emitJson);
    },
    onData: (data, emitJson) => {
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const usage = extractTokenUsageFromPayload(payload);
      if (usage) {
        explicitUsage = usage;
      }
      const type = (payload as { type?: unknown }).type;
      if (type === "content_block_delta") {
        const textDelta = extractAnthropicTextDeltaFromChunk(payload);
        if (textDelta) {
          ensureResponseCreated(emitJson);
          outputText += textDelta;
          emitJson({
            type: "response.output_text.delta",
            delta: textDelta
          });
          return;
        }
        for (const toolDelta of extractAnthropicToolUseDeltaFromChunk(payload)) {
          const existing = pendingToolCalls.get(toolDelta.index) ?? {
            index: toolDelta.index,
            callId: `call_${responseId}_${toolDelta.index}`,
            name: "",
            arguments: "",
            emitted: false
          };
          if (toolDelta.callId) {
            existing.callId = toolDelta.callId;
          }
          if (toolDelta.name) {
            existing.name = toolDelta.name;
          }
          if (toolDelta.inputJsonDelta) {
            existing.arguments += toolDelta.inputJsonDelta;
          }
          pendingToolCalls.set(toolDelta.index, existing);
        }
        return;
      }
      if (type === "content_block_start") {
        for (const toolDelta of extractAnthropicToolUseDeltaFromChunk(payload)) {
          const existing = pendingToolCalls.get(toolDelta.index) ?? {
            index: toolDelta.index,
            callId: `call_${responseId}_${toolDelta.index}`,
            name: "",
            arguments: "",
            emitted: false
          };
          if (toolDelta.callId) {
            existing.callId = toolDelta.callId;
          }
          if (toolDelta.name) {
            existing.name = toolDelta.name;
          }
          pendingToolCalls.set(toolDelta.index, existing);
        }
        return;
      }
      if (type === "content_block_stop") {
        const index = typeof (payload as { index?: unknown }).index === "number"
          ? (payload as { index: number }).index
          : -1;
        const existing = pendingToolCalls.get(index);
        if (existing && !existing.emitted) {
          ensureResponseCreated(emitJson);
          emitPendingToolCall(emitJson, existing);
        }
        return;
      }
      const finishReason = extractAnthropicFinishReason(payload);
      if (finishReason) {
        emitCompleted(emitJson);
        return;
      }
      if (type === "message_stop") {
        emitCompleted(emitJson);
      }
    },
    onDone: (emitJson) => {
      emitCompleted(emitJson);
    }
  });
}

async function resolveVisionFallbackRuntimeKey(key: ResolvedGatewayKey) {
  if (!key.visionChannelId) {
    return { ok: true as const, key };
  }

  const channel = await prisma.upstreamChannel.findUnique({
    where: { id: key.visionChannelId }
  });
  if (!channel || !channel.enabled) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error:
          "Vision fallback channel not found or disabled. Check visionChannelId in upstream model config."
      }
    };
  }

  const channelApiKey = channel.upstreamApiKey?.trim() || null;
  if (!channelApiKey) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error:
          "Vision fallback channel has no upstream API key configured."
      }
    };
  }

  const channelModels = normalizeUpstreamModels(channel.upstreamModelsJson, {
    model: channel.defaultModel,
    upstreamWireApi: normalizeUpstreamWireApiValue(channel.upstreamWireApi),
    supportsVision: channel.supportsVision,
    visionModel: channel.visionModel
  });
  const selectedVisionProfile =
    channelModels.find(
      (item) =>
        (item.model === key.visionModel || item.aliasModel === key.visionModel) && item.enabled
    ) ??
    channelModels.find(
      (item) => item.model === key.visionModel || item.aliasModel === key.visionModel
    ) ??
    null;
  const visionUpstreamModel = normalizeUpstreamModelCode(
    channel.provider,
    selectedVisionProfile?.model ?? key.visionModel ?? ""
  );
  const visionWireApi =
    selectedVisionProfile?.upstreamWireApi ??
    normalizeUpstreamWireApiValue(channel.upstreamWireApi);

  return {
    ok: true as const,
    key: {
      ...key,
      provider: channel.provider,
      upstreamWireApi: visionWireApi,
      upstreamBaseUrl: channel.upstreamBaseUrl,
      upstreamApiKey: channelApiKey,
      upstreamModels: channelModels,
      defaultModel: channel.defaultModel,
      timeoutMs: channel.timeoutMs,
      supportsVision: true,
      visionChannelId: null,
      visionModel: visionUpstreamModel
    }
  };
}

function normalizeHintText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractFocusHintsFromContent(content: unknown): string[] {
  if (typeof content === "string") {
    const normalized = normalizeHintText(content);
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const hints: string[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const normalized = normalizeHintText(item);
      if (normalized) {
        hints.push(normalized);
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }

    const text = "text" in item ? (item as { text?: unknown }).text : undefined;
    if (typeof text === "string") {
      const normalized = normalizeHintText(text);
      if (normalized) {
        hints.push(normalized);
      }
    }

    const contentValue =
      "content" in item ? (item as { content?: unknown }).content : undefined;
    if (typeof contentValue === "string") {
      const normalized = normalizeHintText(contentValue);
      if (normalized) {
        hints.push(normalized);
      }
    }

    for (const key of ["label", "mark", "note", "instruction", "description", "prompt"] as const) {
      const maybe = key in item ? (item as Record<string, unknown>)[key] : undefined;
      if (typeof maybe === "string") {
        const normalized = normalizeHintText(maybe);
        if (normalized) {
          hints.push(normalized);
        }
      }
    }
  }

  return hints;
}

function collectVisionFocusHints(
  messages: LegacyChatMessage[],
  imageMessageIndex: number,
  maxItems = 4
) {
  const hints: string[] = [];
  const pushHints = (content: unknown) => {
    for (const hint of extractFocusHintsFromContent(content)) {
      if (!hints.includes(hint)) {
        hints.push(hint);
      }
      if (hints.length >= maxItems) {
        return;
      }
    }
  };

  const currentMessage = messages[imageMessageIndex];
  if (currentMessage) {
    pushHints(currentMessage.content);
  }
  if (hints.length >= maxItems) {
    return hints;
  }

  for (let i = imageMessageIndex - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") {
      continue;
    }
    pushHints(message.content);
    if (hints.length >= maxItems) {
      break;
    }
  }

  return hints;
}

function parseDataUrlParts(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 5) {
    return null;
  }
  const meta = dataUrl.slice(5, commaIndex);
  const mimeTypeRaw = meta.split(";")[0]?.trim().toLowerCase() || "";
  const mimeType = mimeTypeRaw || "application/octet-stream";
  const base64 = dataUrl.slice(commaIndex + 1);
  return {
    mimeType,
    base64
  };
}

function buildVisionCaptionPrompt(params: {
  messages: LegacyChatMessage[];
  mediaIndex: number;
  mediaTotal: number;
  mediaMessageIndex: number;
  mediaKind: "image" | "video";
  mediaDetail?: string;
}) {
  const hints = collectVisionFocusHints(params.messages, params.mediaMessageIndex);
  const mergedHintText = hints.join("；");
  const truncatedHintText =
    mergedHintText.length > 600 ? `${mergedHintText.slice(0, 600)}...` : mergedHintText;
  const mediaLabel = params.mediaKind === "video" ? "视频" : "图片";
  const detailHint = params.mediaDetail ? `${mediaLabel} detail 参数：${params.mediaDetail}` : "";
  const userHintBlock = truncatedHintText
    ? `用户重点要求/标注（务必优先覆盖）：${truncatedHintText}`
    : "用户未提供明确重点标注，请你给出完整细致描述。";

  const detailSectionTitle =
    params.mediaKind === "video" ? "【时间线与关键帧】" : "【全图详细描述】";
  const detailSectionBody =
    params.mediaKind === "video"
      ? "按时间顺序总结关键片段：主要场景、人物/物体变化、动作事件、字幕/旁白、镜头转场和显著异常。"
      : "从整体到局部描述场景、主体、位置关系、动作状态、颜色、数量、布局、异常点。";
  const ocrSectionBody =
    params.mediaKind === "video"
      ? "逐条转写可见文字（字幕/OCR/UI 文本）与关键时间点；看不清要注明“无法辨认”。"
      : "逐条转写可见文字（OCR）、UI 文本、表格/图表关键数值；看不清要注明“无法辨认”。";

  return [
    `你是${mediaLabel}理解与 OCR 助手。请严格使用中文纯文本回答。`,
    `当前处理第 ${params.mediaIndex + 1}/${params.mediaTotal} 个${mediaLabel}。`,
    detailHint,
    userHintBlock,
    "",
    "请按以下固定结构输出（必须包含 4 段）：",
    "【重点需求与标注】优先总结用户要求、标注区域、需要重点解释的部分；若无写“未提供特定重点”。",
    `${detailSectionTitle}${detailSectionBody}`,
    `【文字与数据提取】${ocrSectionBody}`,
    "【补充与不确定性】说明遮挡、模糊、歧义、推断边界，不要编造图片中不存在的信息。",
    "",
    "要求：描述必须详细，不能只给一句摘要。"
  ]
    .filter(Boolean)
    .join("\n");
}

async function describeMediaWithVisionModel(
  chatBody: LegacyChatRequest,
  key: ResolvedGatewayKey,
  traceContext?: Pick<UsageTraceContext, "route" | "requestWireApi" | "requestedModel" | "clientModel">
) {
  const mediaInputs = collectMediaInputs(chatBody.messages ?? []);
  if (!mediaInputs.length || key.supportsVision) {
    return { ok: true as const, body: chatBody };
  }

  if (!key.visionModel || !key.visionModel.trim()) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error:
          "Current key model is marked as non-vision, but visionModel is not configured."
      }
    };
  }

  const visionRuntimeResolved = await resolveVisionFallbackRuntimeKey(key);
  if (!visionRuntimeResolved.ok) {
    return visionRuntimeResolved;
  }
  const visionRuntimeKey = visionRuntimeResolved.key;
  const resolvedVisionProfile =
    visionRuntimeKey.upstreamModels.find(
      (item) =>
        (item.model === visionRuntimeKey.visionModel || item.aliasModel === visionRuntimeKey.visionModel) &&
        item.enabled
    ) ??
    visionRuntimeKey.upstreamModels.find(
      (item) => item.model === visionRuntimeKey.visionModel || item.aliasModel === visionRuntimeKey.visionModel
    ) ??
    null;
  const visionModelForCaption = normalizeUpstreamModelCode(
    visionRuntimeKey.provider,
    resolvedVisionProfile?.model ?? visionRuntimeKey.visionModel ?? ""
  );
  if (!visionModelForCaption) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "Vision fallback model is empty after normalization."
      }
    };
  }

  const captions: string[] = [];
  for (const media of mediaInputs) {
    const captionPrompt = buildVisionCaptionPrompt({
      messages: chatBody.messages ?? [],
      mediaIndex: captions.length,
      mediaTotal: mediaInputs.length,
      mediaMessageIndex: media.messageIndex,
      mediaKind: media.kind,
      mediaDetail: media.detail
    });
    const dataUrlParts = media.mediaUrl.startsWith("data:")
      ? parseDataUrlParts(media.mediaUrl)
      : null;
    const normalizedVisionProvider = visionRuntimeKey.provider.trim().toLowerCase();
    const useDoubaoVideoCompat =
      media.kind === "video" &&
      visionRuntimeKey.upstreamWireApi === "anthropic_messages" &&
      normalizedVisionProvider === "doubao";

    if (media.kind === "video" && visionRuntimeKey.upstreamWireApi === "anthropic_messages" && !useDoubaoVideoCompat) {
      return {
        ok: false as const,
        status: 400,
        body: {
          error:
            "Video fallback is not supported on anthropic_messages wire API. Configure a vision fallback channel using chat_completions or responses.",
          debug: {
            provider: visionRuntimeKey.provider,
            upstreamWireApi: visionRuntimeKey.upstreamWireApi,
            upstreamBaseUrl: visionRuntimeKey.upstreamBaseUrl,
            sourceVisionChannelId: key.visionChannelId ?? null,
            resolvedVisionModel: visionModelForCaption
          }
        }
      };
    }

    const captionTransportWireApi = useDoubaoVideoCompat
      ? "chat_completions"
      : visionRuntimeKey.upstreamWireApi;
    const captionCacheKey = buildVisionCaptionCacheKey({
      mediaKind: media.kind,
      mediaUrl: media.mediaUrl,
      mediaDetail: media.detail,
      visionModel: visionModelForCaption,
      provider: visionRuntimeKey.provider,
      transportWireApi: captionTransportWireApi
    });
    const cachedCaption = readVisionCaptionCache(captionCacheKey);
    if (cachedCaption) {
      captions.push(cachedCaption);
      continue;
    }

    const mediaSnapshot = await persistAiCallImage(media.mediaUrl);

    const captionResp =
      captionTransportWireApi === "responses"
        ? await callResponsesApi(
            {
              model: visionModelForCaption,
              input: [
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: captionPrompt
                    },
                    media.kind === "video"
                      ? {
                          type: "input_video",
                          video_url: media.mediaUrl,
                          ...(media.detail ? { detail: media.detail } : {})
                        }
                      : {
                          type: "input_image",
                          image_url: media.mediaUrl,
                          detail: media.detail
                        }
                  ]
                }
              ],
              max_output_tokens: 1200
            },
            visionRuntimeKey
          )
        : captionTransportWireApi === "anthropic_messages"
          ? await callAnthropicMessagesApi(
              {
                model: visionModelForCaption,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: captionPrompt
                      },
                      media.kind === "video"
                        ? dataUrlParts
                          ? {
                              type: "video",
                              source: {
                                type: "base64",
                                media_type: dataUrlParts.mimeType,
                                data: dataUrlParts.base64
                              }
                            }
                          : {
                              type: "video",
                              source: {
                                type: "url",
                                url: media.mediaUrl
                              }
                            }
                        : dataUrlParts
                          ? {
                              type: "image",
                              source: {
                                type: "base64",
                                media_type: dataUrlParts.mimeType,
                                data: dataUrlParts.base64
                              }
                            }
                          : {
                              type: "image",
                              source: {
                                type: "url",
                                url: media.mediaUrl
                              }
                            }
                    ]
                  }
                ],
                max_tokens: 1200
              },
              visionRuntimeKey
            )
          : await callChatCompletionsApi(
              {
                model: visionModelForCaption,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: captionPrompt
                      },
                      media.kind === "video"
                        ? {
                            type: "video_url",
                            video_url: {
                              url: media.mediaUrl,
                              ...(media.detail ? { detail: media.detail } : {})
                            }
                          }
                        : {
                            type: "image_url",
                            image_url: {
                              url: media.mediaUrl,
                              detail: media.detail
                            }
                          }
                    ]
                  }
                ],
              max_tokens: 1200
            },
            visionRuntimeKey
          );

    if (!captionResp.ok) {
      return {
        ok: false as const,
        status: captionResp.status,
        body: {
          error: "Vision fallback model failed while converting media to text.",
          detail: captionResp.body,
          debug: {
            provider: visionRuntimeKey.provider,
            upstreamWireApi: visionRuntimeKey.upstreamWireApi,
            transportWireApi: captionTransportWireApi,
            upstreamBaseUrl: visionRuntimeKey.upstreamBaseUrl,
            sourceVisionChannelId: key.visionChannelId ?? null,
            resolvedVisionModel: visionModelForCaption,
            compatMode: useDoubaoVideoCompat ? "doubao_video_via_chat_completions" : null
          }
        }
      };
    }

    const caption =
      captionTransportWireApi === "responses"
        ? extractResponseText(captionResp.body).trim()
        : captionTransportWireApi === "anthropic_messages"
          ? extractAnthropicMessageText(captionResp.body).trim()
          : extractLegacyChatCompletionText(captionResp.body).trim();
    const captionReasoning =
      captionTransportWireApi === "responses"
        ? extractResponsesReasoningText(captionResp.body).trim()
        : captionTransportWireApi === "anthropic_messages"
          ? extractAnthropicThinkingText(captionResp.body).trim()
          : extractLegacyChatCompletionReasoning(captionResp.body).trim();
    const finalCaption = caption || (media.kind === "video" ? "Video content provided." : "Image content provided.");
    writeVisionCaptionCache(captionCacheKey, finalCaption);
    captions.push(finalCaption);
    await appendAiCallLogEntry({
      id: crypto.randomUUID().slice(0, 12),
      keyId: key.id,
      keyName: key.name,
      route: traceContext?.route ?? "/vision-fallback",
      requestWireApi: traceContext?.requestWireApi ?? "responses",
      upstreamWireApi: captionTransportWireApi,
      requestedModel: traceContext?.requestedModel ?? key.defaultModel,
      clientModel: traceContext?.clientModel ?? traceContext?.requestedModel ?? key.defaultModel,
      upstreamModel: visionModelForCaption,
      callType: "vision_fallback",
      stream: false,
      systemPrompt: "",
      userPrompt: clipLogText(`${captionPrompt}\n[${media.kind}_input]`),
      conversationTranscript: clipLogText(
        `[user]\n${captionPrompt}\n[${media.kind}_input]`,
        MAX_LOG_TRANSCRIPT_CHARS
      ),
      assistantReasoning: clipLogText(captionReasoning),
      assistantResponse: clipLogText(finalCaption),
      images: [mediaSnapshot],
      createdAt: new Date().toISOString()
    });
  }

  return {
    ok: true as const,
    body: {
      ...chatBody,
      messages: replaceMediaWithCaptions(chatBody.messages ?? [], captions)
    }
  };
}

async function rewriteResponsesBodyForVisionFallback(
  body: ResponsesRequest,
  key: ResolvedGatewayKey,
  traceContext?: Pick<UsageTraceContext, "route" | "requestWireApi" | "requestedModel" | "clientModel">
) {
  if (key.supportsVision) {
    return { ok: true as const, body };
  }

  const mapped = mapResponsesRequestToLegacyChat(body, key.defaultModel);
  const legacyMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
  const rewritten = await describeMediaWithVisionModel(
    {
      messages: legacyMessages
    },
    key,
    traceContext
  );
  if (!rewritten.ok) {
    return rewritten;
  }

  const remapped = mapLegacyChatToResponses(
    {
      model: body.model ?? key.defaultModel,
      messages: rewritten.body.messages,
      temperature: mapped.temperature,
      max_tokens: mapped.max_tokens,
      top_p: mapped.top_p,
      tools: mapped.tools,
      tool_choice: mapped.tool_choice,
      parallel_tool_calls: mapped.parallel_tool_calls
    },
    key.defaultModel,
    {
      allowVisionInput: key.supportsVision
    }
  );

  return {
    ok: true as const,
    body: {
      ...body,
      instructions: remapped.instructions,
      input: remapped.input
    }
  };
}

export async function handleLegacyChatCompletions(
  req: Request,
  route = "/v1/chat/completions"
) {
  const rawBody = (await req.json().catch(() => ({}))) as Parameters<typeof mapLegacyChatToResponses>[0];

  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const rewrittenForFileIds = await rewriteLegacyChatBodyFileIds(rawBody, resolved.key.id);
  if (!rewrittenForFileIds.ok) {
    return NextResponse.json(rewrittenForFileIds.body, { status: rewrittenForFileIds.status });
  }

  const requestedModel = pickRequestedModel(rewrittenForFileIds.body.model, resolved.key);
  const modelMapping = resolveRequestedModelMapping(requestedModel, resolved.key);
  const mappedRequestedModel = modelMapping.mappedModel;
  const preliminaryPromptTokensEstimate = estimateLegacyChatTokens(
    rewrittenForFileIds.body,
    mappedRequestedModel
  );
  const resolvedCandidates = await resolveModelCandidatesForRequest({
    baseKey: resolved.key,
    requestedModel,
    mappedModel: mappedRequestedModel,
    promptTokensEstimate: preliminaryPromptTokensEstimate,
    mappingResolution: modelMapping
  });
  if (!resolvedCandidates.ok) {
    return NextResponse.json(resolvedCandidates.body, { status: resolvedCandidates.status });
  }
  const modelCandidates = resolvedCandidates.candidates;
  const modelResolved = modelCandidates[0];
  const runtimeKey = modelResolved.runtimeKey;
  const body = isGptFamilyModel(runtimeKey.provider, modelResolved.upstreamModel)
    ? rewrittenForFileIds.body
    : rewriteLegacyBodyForAgentsHint(rewrittenForFileIds.body);
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(
    normalizeLegacyMessages(body.messages as LegacyChatRequest["messages"])
  );
  const promptTokensEstimate = estimateLegacyChatTokens(body, mappedRequestedModel);

  const rewritten = await describeMediaWithVisionModel(body, runtimeKey, {
    route,
    requestWireApi: "chat_completions",
    requestedModel,
    clientModel: modelResolved.clientModel
  });
  if (!rewritten.ok) {
    return NextResponse.json(rewritten.body, { status: rewritten.status });
  }

  if (isStreamingRequest(body)) {
    if (runtimeKey.upstreamWireApi === "chat_completions") {
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) =>
          callChatCompletionsApiStream(
            applyCodexThinkingModeForChat(
              {
                ...rewritten.body,
                model: candidate.upstreamModel,
                stream: true
              },
              candidate.runtimeKey.provider,
              candidate.profile?.glmCodexThinkingThreshold,
              candidate.mapping?.thinkingType ?? null
            ),
            candidate.runtimeKey
          )
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      return trackUsageFromSse(upstream, "chat_completions", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
    }
    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) => {
          const upstreamPayload = mapLegacyChatToAnthropicMessages(
            {
              ...rewritten.body,
              model: candidate.upstreamModel,
              stream: true
            },
            candidate.runtimeKey.defaultModel
          );
          upstreamPayload.model = candidate.upstreamModel;
          return callAnthropicMessagesApiStream(upstreamPayload, candidate.runtimeKey);
        }
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
      const responsesStream = transformAnthropicStreamToResponses(tracked, activeCandidate.clientModel, {
        promptTokensEstimate
      });
      return transformResponsesStreamToLegacyChat(responsesStream, activeCandidate.clientModel);
    }
    const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
      allowVisionInput: runtimeKey.supportsVision
    });
    const upstreamResult = await callStreamWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const candidatePayload = {
          ...payload,
          model: candidate.upstreamModel
        };
        const responsesPayload = applyCodexThinkingModeForResponses(
          candidatePayload,
          candidate.runtimeKey.provider,
          candidate.mapping?.thinkingType ?? null
        );
        return callResponsesApiStream(
          {
            ...responsesPayload,
            model: candidate.upstreamModel,
            stream: true
          },
          candidate.runtimeKey
        );
      }
    );
    if (!upstreamResult.ok) {
      return streamFailoverFailureToResponse(upstreamResult);
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.response;
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "chat_completions",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    });
    return transformResponsesStreamToLegacyChat(tracked, activeCandidate.clientModel);
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) =>
        callChatCompletionsApi(
          applyCodexThinkingModeForChat(
            {
              ...rewritten.body,
              model: candidate.upstreamModel
            },
            candidate.runtimeKey.provider,
            candidate.profile?.glmCodexThinkingThreshold,
            candidate.mapping?.thinkingType ?? null
          ),
          candidate.runtimeKey
        )
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyChatCompletionText(upstream.body),
      extractLegacyChatCompletionReasoning(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const upstreamPayload = mapLegacyChatToAnthropicMessages(
          {
            ...rewritten.body,
            model: candidate.upstreamModel
          },
          candidate.runtimeKey.defaultModel
        );
        upstreamPayload.model = candidate.upstreamModel;
        return callAnthropicMessagesApi(upstreamPayload, candidate.runtimeKey);
      }
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body),
      extractAnthropicThinkingText(upstream.body)
    );
    return NextResponse.json(mapAnthropicToLegacyChat(upstream.body, activeCandidate.clientModel));
  }

  const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
    allowVisionInput: runtimeKey.supportsVision
  });
  const upstreamResult = await callJsonWithModelFailover(
    modelCandidates,
    async (candidate) => {
      const candidatePayload = {
        ...payload,
        model: candidate.upstreamModel
      };
      const responsesPayload = applyCodexThinkingModeForResponses(
        candidatePayload,
        candidate.runtimeKey.provider,
        candidate.mapping?.thinkingType ?? null
      );
      return callResponsesApi(responsesPayload, candidate.runtimeKey);
    }
  );
  if (!upstreamResult.ok) {
    return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
  }
  const activeCandidate = upstreamResult.candidate;
  const upstream = upstreamResult.result;
  void persistUsageEvent(
    {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "chat_completions",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body),
    extractResponsesReasoningText(upstream.body)
  );

  return NextResponse.json(mapResponsesToLegacyChat(upstream.body, activeCandidate.clientModel));
}

export async function handleAnthropicMessages(
  req: Request,
  route = "/v1/messages"
) {
  const body = (await req.json().catch(() => ({}))) as AnthropicMessagesRequest;
  const anthropicUpstreamHeaderOverrides = extractAnthropicUpstreamHeaderOverrides(req);

  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );
  if (!resolved.ok) {
    return anthropicErrorResponse(resolved.status, resolved.body.error);
  }

  const legacyBody = rewriteLegacyBodyForAgentsHint(
    mapAnthropicMessagesToLegacyChat(body, resolved.key.defaultModel)
  );
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(
    normalizeLegacyMessages(legacyBody.messages as LegacyChatRequest["messages"])
  );

  const requestedModel = pickRequestedModel(body.model, resolved.key);
  const modelMapping = resolveRequestedModelMapping(requestedModel, resolved.key);
  const mappedRequestedModel = modelMapping.mappedModel;
  const promptTokensEstimate = estimateLegacyChatTokens(legacyBody, mappedRequestedModel);
  const resolvedCandidates = await resolveModelCandidatesForRequest({
    baseKey: resolved.key,
    requestedModel,
    mappedModel: mappedRequestedModel,
    promptTokensEstimate,
    mappingResolution: modelMapping
  });
  if (!resolvedCandidates.ok) {
    return anthropicErrorResponse(
      resolvedCandidates.status,
      extractAnthropicUpstreamErrorMessage(
        resolvedCandidates.body,
        "No available upstream candidate for this model mapping."
      )
    );
  }
  const modelCandidates = resolvedCandidates.candidates;
  const modelResolved = modelCandidates[0];
  const runtimeKey = modelResolved.runtimeKey;

  const rewritten = await describeMediaWithVisionModel(legacyBody, runtimeKey, {
    route,
    requestWireApi: "anthropic_messages",
    requestedModel,
    clientModel: modelResolved.clientModel
  });
  if (!rewritten.ok) {
    return anthropicErrorResponse(rewritten.status, extractAnthropicUpstreamErrorMessage(rewritten.body, "Vision fallback request failed."));
  }

  if (body.stream === true) {
    if (runtimeKey.upstreamWireApi === "chat_completions") {
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) =>
          callChatCompletionsApiStream(
            applyCodexThinkingModeForChat(
              {
                ...rewritten.body,
                model: candidate.upstreamModel,
                stream: true
              },
              candidate.runtimeKey.provider,
              candidate.profile?.glmCodexThinkingThreshold,
              candidate.mapping?.thinkingType ?? null
            ),
            candidate.runtimeKey
          )
      );
      if (!upstreamResult.ok) {
        if (upstreamResult.response) {
          return anthropicErrorResponseFromStream(
            upstreamResult.response,
            "Upstream chat/completions API error"
          );
        }
        return anthropicErrorResponse(
          upstreamResult.status,
          extractAnthropicUpstreamErrorMessage(
            upstreamResult.body,
            "Upstream chat/completions API error"
          )
        );
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      const tracked = trackUsageFromSse(upstream, "chat_completions", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
      return transformChatStreamToAnthropic(tracked, activeCandidate.clientModel, {
        promptTokensEstimate
      });
    }

    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) => {
          const upstreamPayload = mapLegacyChatToAnthropicMessages(
            {
              ...rewritten.body,
              model: candidate.upstreamModel,
              stream: true
            },
            candidate.runtimeKey.defaultModel
          );
          upstreamPayload.model = candidate.upstreamModel;
          return callAnthropicMessagesApiStream(
            upstreamPayload,
            candidate.runtimeKey,
            anthropicUpstreamHeaderOverrides
          );
        }
      );

      if (!upstreamResult.ok) {
        if (upstreamResult.response) {
          return anthropicErrorResponseFromStream(
            upstreamResult.response,
            "Upstream anthropic messages API error"
          );
        }
        return anthropicErrorResponse(
          upstreamResult.status,
          extractAnthropicUpstreamErrorMessage(
            upstreamResult.body,
            "Upstream anthropic messages API error"
          )
        );
      }
      return trackUsageFromSse(upstreamResult.response, "anthropic_messages", {
        key: upstreamResult.candidate.runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: upstreamResult.candidate.clientModel,
        upstreamModel: upstreamResult.candidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
    }

    const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
      allowVisionInput: runtimeKey.supportsVision
    });
    const upstreamResult = await callStreamWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const candidatePayload = {
          ...payload,
          model: candidate.upstreamModel
        };
        const responsesPayload = applyCodexThinkingModeForResponses(
          candidatePayload,
          candidate.runtimeKey.provider,
          candidate.mapping?.thinkingType ?? null
        );
        return callResponsesApiStream(
          {
            ...responsesPayload,
            model: candidate.upstreamModel,
            stream: true
          },
          candidate.runtimeKey
        );
      }
    );
    if (!upstreamResult.ok) {
      if (upstreamResult.response) {
        return anthropicErrorResponseFromStream(
          upstreamResult.response,
          "Upstream responses API error"
        );
      }
      return anthropicErrorResponse(
        upstreamResult.status,
        extractAnthropicUpstreamErrorMessage(
          upstreamResult.body,
          "Upstream responses API error"
        )
      );
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.response;
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "anthropic_messages",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    });
    return transformResponsesStreamToAnthropic(tracked, activeCandidate.clientModel, {
      promptTokensEstimate
    });
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) =>
        callChatCompletionsApi(
          applyCodexThinkingModeForChat(
            {
              ...rewritten.body,
              model: candidate.upstreamModel
            },
            candidate.runtimeKey.provider,
            candidate.profile?.glmCodexThinkingThreshold,
            candidate.mapping?.thinkingType ?? null
          ),
          candidate.runtimeKey
        )
    );
    if (!upstreamResult.ok) {
      return anthropicErrorResponse(
        upstreamResult.status,
        extractAnthropicUpstreamErrorMessage(
          upstreamResult.body,
          "Upstream chat/completions API error"
        )
      );
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyChatCompletionText(upstream.body),
      extractLegacyChatCompletionReasoning(upstream.body)
    );
    const responsesPayload = mapLegacyChatCompletionToResponses(
      upstream.body,
      activeCandidate.clientModel
    );
    return NextResponse.json(
      mapResponsesToAnthropicMessage(responsesPayload, activeCandidate.clientModel)
    );
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const upstreamPayload = mapLegacyChatToAnthropicMessages(
          {
            ...rewritten.body,
            model: candidate.upstreamModel
          },
          candidate.runtimeKey.defaultModel
        );
        upstreamPayload.model = candidate.upstreamModel;
        return callAnthropicMessagesApi(
          upstreamPayload,
          candidate.runtimeKey,
          anthropicUpstreamHeaderOverrides
        );
      }
    );
    if (!upstreamResult.ok) {
      return anthropicErrorResponse(
        upstreamResult.status,
        extractAnthropicUpstreamErrorMessage(
          upstreamResult.body,
          "Upstream anthropic messages API error"
        )
      );
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body),
      extractAnthropicThinkingText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
    allowVisionInput: runtimeKey.supportsVision
  });
  const upstreamResult = await callJsonWithModelFailover(
    modelCandidates,
    async (candidate) => {
      const candidatePayload = {
        ...payload,
        model: candidate.upstreamModel
      };
      const responsesPayload = applyCodexThinkingModeForResponses(
        candidatePayload,
        candidate.runtimeKey.provider,
        candidate.mapping?.thinkingType ?? null
      );
      return callResponsesApi(responsesPayload, candidate.runtimeKey);
    }
  );
  if (!upstreamResult.ok) {
    return anthropicErrorResponse(
      upstreamResult.status,
      extractAnthropicUpstreamErrorMessage(
        upstreamResult.body,
        "Upstream responses API error"
      )
    );
  }
  const activeCandidate = upstreamResult.candidate;
  const upstream = upstreamResult.result;
  void persistUsageEvent(
    {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "anthropic_messages",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body)
  );

  return NextResponse.json(
    mapResponsesToAnthropicMessage(upstream.body, activeCandidate.clientModel)
  );
}

export async function handleLegacyCompletions(
  req: Request,
  route = "/v1/completions"
) {
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof mapLegacyCompletionToResponses>[0];
  const promptSnapshot = extractPromptSnapshotFromLegacyCompletionBody(body);

  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const requestedModel = pickRequestedModel(body.model, resolved.key);
  const modelMapping = resolveRequestedModelMapping(requestedModel, resolved.key);
  const mappedRequestedModel = modelMapping.mappedModel;
  const promptTokensEstimate = estimateLegacyCompletionTokens(body, mappedRequestedModel);
  const resolvedCandidates = await resolveModelCandidatesForRequest({
    baseKey: resolved.key,
    requestedModel,
    mappedModel: mappedRequestedModel,
    promptTokensEstimate,
    mappingResolution: modelMapping
  });
  if (!resolvedCandidates.ok) {
    return NextResponse.json(resolvedCandidates.body, { status: resolvedCandidates.status });
  }
  const modelCandidates = resolvedCandidates.candidates;
  const modelResolved = modelCandidates[0];
  const runtimeKey = modelResolved.runtimeKey;

  if (isStreamingRequest(body)) {
    if (runtimeKey.upstreamWireApi === "chat_completions") {
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) =>
          callCompletionsApiStream(
            {
              ...body,
              model: candidate.upstreamModel,
              stream: true
            },
            candidate.runtimeKey
          )
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      return trackUsageFromSse(upstream, "completions", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
    }
    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const responsesPayload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) => {
          const candidatePayload = {
            ...responsesPayload,
            model: candidate.upstreamModel,
            stream: true
          };
          const upstreamPayload = mapResponsesRequestToAnthropicMessages(
            candidatePayload,
            candidate.runtimeKey.defaultModel
          );
          upstreamPayload.model = candidate.upstreamModel;
          return callAnthropicMessagesApiStream(
            upstreamPayload,
            candidate.runtimeKey
          );
        }
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
      const responsesStream = transformAnthropicStreamToResponses(tracked, activeCandidate.clientModel, {
        promptTokensEstimate
      });
      return transformResponsesStreamToLegacyCompletion(
        responsesStream,
        activeCandidate.clientModel
      );
    }
    const payload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
    const upstreamResult = await callStreamWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const candidatePayload = {
          ...payload,
          model: candidate.upstreamModel
        };
        const responsesPayload = applyCodexThinkingModeForResponses(
          candidatePayload,
          candidate.runtimeKey.provider,
          candidate.mapping?.thinkingType ?? null
        );
        return callResponsesApiStream(
          {
            ...responsesPayload,
            model: candidate.upstreamModel,
            stream: true
          },
          candidate.runtimeKey
        );
      }
    );
    if (!upstreamResult.ok) {
      return streamFailoverFailureToResponse(upstreamResult);
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.response;
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "completions",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    });
    return transformResponsesStreamToLegacyCompletion(tracked, activeCandidate.clientModel);
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) =>
        callCompletionsApi(
          {
            ...body,
            model: candidate.upstreamModel
          },
          candidate.runtimeKey
        )
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyCompletionText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const responsesPayload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const candidatePayload = {
          ...responsesPayload,
          model: candidate.upstreamModel
        };
        const upstreamPayload = mapResponsesRequestToAnthropicMessages(
          candidatePayload,
          candidate.runtimeKey.defaultModel
        );
        upstreamPayload.model = candidate.upstreamModel;
        return callAnthropicMessagesApi(upstreamPayload, candidate.runtimeKey);
      }
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body),
      extractAnthropicThinkingText(upstream.body)
    );
    return NextResponse.json(
      mapResponsesToLegacyCompletion(
        mapAnthropicToResponses(upstream.body, activeCandidate.clientModel),
        activeCandidate.clientModel
      )
    );
  }

  const payload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
  const upstreamResult = await callJsonWithModelFailover(
    modelCandidates,
    async (candidate) => {
      const candidatePayload = {
        ...payload,
        model: candidate.upstreamModel
      };
      const responsesPayload = applyCodexThinkingModeForResponses(
        candidatePayload,
        candidate.runtimeKey.provider,
        candidate.mapping?.thinkingType ?? null
      );
      return callResponsesApi(responsesPayload, candidate.runtimeKey);
    }
  );
  if (!upstreamResult.ok) {
    return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
  }
  const activeCandidate = upstreamResult.candidate;
  const upstream = upstreamResult.result;
  void persistUsageEvent(
    {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "completions",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body),
    extractResponsesReasoningText(upstream.body)
  );

  return NextResponse.json(
    mapResponsesToLegacyCompletion(upstream.body, activeCandidate.clientModel)
  );
}

export async function handleResponses(req: Request, route = "/v1/responses") {
  const rawBody = (await req.json().catch(() => ({}))) as ResponsesRequest;

  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const rewrittenForFileIds = await rewriteResponsesBodyFileIds(rawBody, resolved.key.id);
  if (!rewrittenForFileIds.ok) {
    return NextResponse.json(rewrittenForFileIds.body, { status: rewrittenForFileIds.status });
  }

  const requestedModel = pickRequestedModel(rewrittenForFileIds.body.model, resolved.key);
  const modelMapping = resolveRequestedModelMapping(requestedModel, resolved.key);
  const mappedRequestedModel = modelMapping.mappedModel;
  const preliminaryPromptTokensEstimate = estimateResponsesRequestTokens(
    rewrittenForFileIds.body,
    mappedRequestedModel
  );
  const resolvedCandidates = await resolveModelCandidatesForRequest({
    baseKey: resolved.key,
    requestedModel,
    mappedModel: mappedRequestedModel,
    promptTokensEstimate: preliminaryPromptTokensEstimate,
    mappingResolution: modelMapping
  });
  if (!resolvedCandidates.ok) {
    return NextResponse.json(resolvedCandidates.body, { status: resolvedCandidates.status });
  }
  const modelCandidates = resolvedCandidates.candidates;
  const modelResolved = modelCandidates[0];
  const runtimeKey = modelResolved.runtimeKey;
  const body = isGptFamilyModel(runtimeKey.provider, modelResolved.upstreamModel)
    ? rewrittenForFileIds.body
    : rewriteResponsesBodyForAgentsHint(rewrittenForFileIds.body);
  const promptTokensEstimate = estimateResponsesRequestTokens(body, mappedRequestedModel);
  const responseContextScope = String(resolved.key.id);
  const mappedPrompt = mapResponsesRequestToLegacyChat(body, body.model?.trim() || runtimeKey.defaultModel);
  const previousPromptMessages = readResponseContext(responseContextScope, body.previous_response_id);
  const incomingPromptMessages = normalizeLegacyMessages(
    mappedPrompt.messages as LegacyChatRequest["messages"]
  );
  const mergedPromptMessages = mergeContinuationMessages(
    previousPromptMessages,
    incomingPromptMessages
  );
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(mergedPromptMessages);

  if (body.stream === true) {
    if (runtimeKey.upstreamWireApi === "responses") {
      const rewrittenResponses = await rewriteResponsesBodyForVisionFallback(body, runtimeKey, {
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel
      });
      if (!rewrittenResponses.ok) {
        return NextResponse.json(rewrittenResponses.body, { status: rewrittenResponses.status });
      }
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) =>
          callResponsesApiStream(
            {
              ...applyCodexThinkingModeForResponses(
                {
                  ...rewrittenResponses.body,
                  model: candidate.upstreamModel
                },
                candidate.runtimeKey.provider,
                candidate.mapping?.thinkingType ?? null
              ),
              model: candidate.upstreamModel,
              stream: true
            },
            candidate.runtimeKey
          )
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      return trackUsageFromSse(upstream, "responses", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
    }

    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
      const previousMessages = readResponseContext(responseContextScope, body.previous_response_id);
      const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
      const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
      const rewritten = await describeMediaWithVisionModel(
        {
          messages: mergedMessages
        },
        runtimeKey,
        {
          route,
          requestWireApi: "responses",
          requestedModel,
          clientModel: modelResolved.clientModel
        }
      );
      if (!rewritten.ok) {
        return NextResponse.json(rewritten.body, { status: rewritten.status });
      }

      let contextBaseMessages: LegacyChatMessage[] = [];
      const upstreamResult = await callStreamWithModelFailover(
        modelCandidates,
        async (candidate) => {
          const legacyPayload = {
            ...mapped,
            model: candidate.upstreamModel,
            messages: rewritten.body.messages,
            stream: true
          };
          const anthropicPayload = mapLegacyChatToAnthropicMessages(
            legacyPayload,
            candidate.runtimeKey.defaultModel
          );
          anthropicPayload.model = candidate.upstreamModel;
          contextBaseMessages = normalizeLegacyMessages(
            legacyPayload.messages as LegacyChatRequest["messages"]
          );
          return callAnthropicMessagesApiStream(
            anthropicPayload,
            candidate.runtimeKey
          );
        }
      );
      if (!upstreamResult.ok) {
        return streamFailoverFailureToResponse(upstreamResult);
      }
      const activeCandidate = upstreamResult.candidate;
      const upstream = upstreamResult.response;
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      });
      return transformAnthropicStreamToResponses(tracked, activeCandidate.clientModel, {
        promptTokensEstimate,
        onCompleted: ({ responseId, assistantMessage }) => {
          const nextMessages = assistantMessage
            ? [...contextBaseMessages, assistantMessage]
            : contextBaseMessages;
          writeResponseContext(responseContextScope, responseId, nextMessages);
        }
      });
    }

    const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
    const customToolNames = collectCustomToolNamesFromResponsesRequest(body);
    const previousMessages = readResponseContext(responseContextScope, body.previous_response_id);
    const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
    const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
    const rewritten = await describeMediaWithVisionModel(
      {
        messages: mergedMessages
      },
      runtimeKey,
      {
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel
      }
    );
    if (!rewritten.ok) {
      return NextResponse.json(rewritten.body, { status: rewritten.status });
    }

    const legacyPayload = {
      ...mapped,
      model: modelResolved.upstreamModel,
      messages: rewritten.body.messages,
      stream: true
    };
    let contextBaseMessages: LegacyChatMessage[] = [];
    const upstreamResult = await callStreamWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const candidateLegacyPayload = {
          ...legacyPayload,
          model: candidate.upstreamModel
        };
        const upstreamPayload = applyCodexThinkingModeForChat(
          candidateLegacyPayload,
          candidate.runtimeKey.provider,
          candidate.profile?.glmCodexThinkingThreshold,
          candidate.mapping?.thinkingType ?? null
        );
        contextBaseMessages = normalizeLegacyMessages(
          upstreamPayload.messages as LegacyChatRequest["messages"]
        );
        return callChatCompletionsApiStream(upstreamPayload, candidate.runtimeKey);
      }
    );
    if (!upstreamResult.ok) {
      return streamFailoverFailureToResponse(upstreamResult);
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.response;
    const tracked = trackUsageFromSse(upstream, "chat_completions", {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    });
    return transformChatStreamToResponses(tracked, activeCandidate.clientModel, {
      promptTokensEstimate,
      customToolNames,
      onCompleted: ({ responseId, assistantMessage }) => {
        const nextMessages = assistantMessage
          ? [...contextBaseMessages, assistantMessage]
          : contextBaseMessages;
        writeResponseContext(responseContextScope, responseId, nextMessages);
      }
    });
  }

  if (runtimeKey.upstreamWireApi === "responses") {
    const rewrittenResponses = await rewriteResponsesBodyForVisionFallback(body, runtimeKey, {
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: modelResolved.clientModel
    });
    if (!rewrittenResponses.ok) {
      return NextResponse.json(rewrittenResponses.body, { status: rewrittenResponses.status });
    }
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) =>
        callResponsesApi(
          {
            ...applyCodexThinkingModeForResponses(
              {
                ...rewrittenResponses.body,
                model: candidate.upstreamModel
              },
              candidate.runtimeKey.provider,
              candidate.mapping?.thinkingType ?? null
            ),
            model: candidate.upstreamModel
          },
          candidate.runtimeKey
        )
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractResponseText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
    const previousMessages = readResponseContext(responseContextScope, body.previous_response_id);
    const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
    const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
    const rewritten = await describeMediaWithVisionModel(
      {
        messages: mergedMessages
      },
      runtimeKey,
      {
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel
      }
    );
    if (!rewritten.ok) {
      return NextResponse.json(rewritten.body, { status: rewritten.status });
    }

    let baseMessages: LegacyChatMessage[] = [];
    const upstreamResult = await callJsonWithModelFailover(
      modelCandidates,
      async (candidate) => {
        const legacyPayload = {
          ...mapped,
          model: candidate.upstreamModel,
          messages: rewritten.body.messages
        };
        const anthropicPayload = mapLegacyChatToAnthropicMessages(
          legacyPayload,
          candidate.runtimeKey.defaultModel
        );
        anthropicPayload.model = candidate.upstreamModel;
        baseMessages = normalizeLegacyMessages(
          legacyPayload.messages as LegacyChatRequest["messages"]
        );
        return callAnthropicMessagesApi(
          anthropicPayload,
          candidate.runtimeKey
        );
      }
    );
    if (!upstreamResult.ok) {
      return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
    }
    const activeCandidate = upstreamResult.candidate;
    const upstream = upstreamResult.result;
    void persistUsageEvent(
      {
        key: activeCandidate.runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: activeCandidate.clientModel,
        upstreamModel: activeCandidate.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt,
        conversationTranscript: promptSnapshot.conversationTranscript
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body),
      extractAnthropicThinkingText(upstream.body)
    );
    const mappedResponse = mapAnthropicToResponses(upstream.body, activeCandidate.clientModel);
    const assistantMessage = extractAnthropicAssistantMessage(upstream.body);
    const nextMessages = assistantMessage ? [...baseMessages, assistantMessage] : baseMessages;
    writeResponseContext(responseContextScope, mappedResponse.id, nextMessages);
    return NextResponse.json(mappedResponse);
  }

  const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
  const customToolNames = collectCustomToolNamesFromResponsesRequest(body);
  const previousMessages = readResponseContext(responseContextScope, body.previous_response_id);
  const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
  const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
  const rewritten = await describeMediaWithVisionModel(
    {
      messages: mergedMessages
    },
    runtimeKey,
    {
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: modelResolved.clientModel
    }
  );
  if (!rewritten.ok) {
    return NextResponse.json(rewritten.body, { status: rewritten.status });
  }

  const legacyPayload = {
    ...mapped,
    model: modelResolved.upstreamModel,
    messages: rewritten.body.messages
  };

  let baseMessages: LegacyChatMessage[] = [];
  const upstreamResult = await callJsonWithModelFailover(
    modelCandidates,
    async (candidate) => {
      const candidateLegacyPayload = {
        ...legacyPayload,
        model: candidate.upstreamModel
      };
      const upstreamPayload = applyCodexThinkingModeForChat(
        candidateLegacyPayload,
        candidate.runtimeKey.provider,
        candidate.profile?.glmCodexThinkingThreshold,
        candidate.mapping?.thinkingType ?? null
      );
      baseMessages = normalizeLegacyMessages(
        upstreamPayload.messages as LegacyChatRequest["messages"]
      );
      return callChatCompletionsApi(upstreamPayload, candidate.runtimeKey);
    }
  );
  if (!upstreamResult.ok) {
    return NextResponse.json(upstreamResult.body, { status: upstreamResult.status });
  }
  const activeCandidate = upstreamResult.candidate;
  const upstream = upstreamResult.result;
  void persistUsageEvent(
    {
      key: activeCandidate.runtimeKey,
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: activeCandidate.clientModel,
      upstreamModel: activeCandidate.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt,
      conversationTranscript: promptSnapshot.conversationTranscript
    },
    // Preserve usage accounting plus the visible answer/reasoning extracted from the legacy payload.
    extractTokenUsageFromPayload(upstream.body),
    extractLegacyChatCompletionText(upstream.body),
    extractLegacyChatCompletionReasoning(upstream.body)
  );

  const mappedResponse = mapLegacyChatCompletionToResponses(
    upstream.body,
    activeCandidate.clientModel,
    {
      customToolNames
    }
  );
  const assistantMessage = extractAssistantMessageFromLegacyChatPayload(upstream.body);
  const nextMessages = assistantMessage ? [...baseMessages, assistantMessage] : baseMessages;
  writeResponseContext(responseContextScope, mappedResponse.id, nextMessages);
  return NextResponse.json(mappedResponse);
}
