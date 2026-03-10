import { NextResponse } from "next/server";
import {
  extractAnthropicAssistantMessage,
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
import { mapModelByKeyMappings, normalizeUpstreamModels, normalizeUpstreamWireApiValue } from "@/lib/key-config";
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

function mapRequestedModelForKey(requestedModel: string, key: ResolvedGatewayKey) {
  return mapModelByKeyMappings(requestedModel, key.modelMappings);
}

type RuntimeModelResolved = {
  runtimeKey: ResolvedGatewayKey;
  upstreamModel: string;
  clientModel: string;
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
};

const MAX_LOG_TEXT_CHARS = 12_000;

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
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
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

function extractPromptSnapshotFromLegacyMessages(messages: LegacyChatMessage[]) {
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
    userPrompt: clipLogText(userParts.join("\n\n"))
  };
}

function extractPromptSnapshotFromLegacyCompletionBody(body: { prompt?: string | string[] }) {
  const prompt = body.prompt;
  const promptText = Array.isArray(prompt) ? prompt.join("\n") : typeof prompt === "string" ? prompt : "";
  return {
    systemPrompt: "",
    userPrompt: clipLogText(promptText)
  };
}

function extractPromptSnapshotFromResponsesBody(body: ResponsesRequest) {
  const mapped = mapResponsesRequestToLegacyChat(body, body.model?.trim() || "gpt-4.1-mini");
  const messages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
  return extractPromptSnapshotFromLegacyMessages(messages);
}

function normalizeModelForCompare(provider: string, model: string | null | undefined) {
  const trimmed = model?.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = normalizeUpstreamModelCode(provider, trimmed);
  return normalized.toLowerCase();
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
      clientModel: model
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
    clientModel: model
  };
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
  completionText = ""
) {
  const completionTokensEstimate = completionText
    ? estimatePlainTextTokens(completionText, context.clientModel)
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
      ...(message.name ? { name: message.name } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.tool_calls ? { tool_calls: deepCloneUnknown(message.tool_calls) } : {})
    }));
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
  if (normalized === "enabled" || normalized === "disabled" || normalized === "adaptive") {
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

function sanitizeLegacyMessagesForGenericUpstream(messages: LegacyChatRequest["messages"] | undefined) {
  if (!Array.isArray(messages)) {
    return messages;
  }
  return messages.map((message) => ({
    ...message,
    content: sanitizeLegacyContentForGenericUpstream(message.content, message.role)
  }));
}

function resolveReasoningEffortForChatPayload(payload: LegacyChatRequest) {
  const direct = normalizeOptionalField(payload.reasoning_effort);
  if (direct) {
    return direct;
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

function applyCodexThinkingModeForChat<T extends LegacyChatRequest>(payload: T, provider: string): T {
  const reasoningEffort = resolveReasoningEffortForChatPayload(payload);

  const nextPayload: LegacyChatRequest = {
    ...payload,
    messages: sanitizeLegacyMessagesForGenericUpstream(payload.messages)
  };
  // GLM chat/completions follows documented `thinking.type` only.
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === "glm") {
    const existingThinking = payload.thinking && typeof payload.thinking === "object" ? payload.thinking : null;
    const incomingType = normalizeThinkingType(existingThinking ? (existingThinking as { type?: unknown }).type : undefined);
    const type = incomingType
      ? incomingType === "disabled"
        ? "disabled"
        : "enabled"
      : reasoningEffort
        ? (isThinkingDisabledByEffort(reasoningEffort) ? "disabled" : "enabled")
        : "";

    nextPayload.anthropic_output_config = undefined;
    nextPayload.reasoning_effort = undefined;
    nextPayload.verbosity = undefined;
    if (!type) {
      nextPayload.thinking = undefined;
      return nextPayload as T;
    }

    nextPayload.thinking = {
      type
    };
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

function extractAssistantMessageFromLegacyChatPayload(payload: unknown): LegacyChatMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const message = (
    payload as {
      choices?: Array<{
        message?: {
          content?: unknown;
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

  const rawToolCalls = "tool_calls" in message ? message.tool_calls : undefined;
  const hasToolCalls =
    (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) ||
    (rawToolCalls && typeof rawToolCalls === "object");

  if (!hasContent && !hasToolCalls) {
    return null;
  }

  const nameValue = "name" in message ? message.name : undefined;
  const toolCallId = "tool_call_id" in message ? message.tool_call_id : undefined;
  return {
    role: "assistant",
    content: hasContent ? content : "",
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
      const type = (payload as { type?: unknown }).type;
      if (type === "response.output_text.delta") {
        const delta = (payload as { delta?: unknown }).delta;
        if (typeof delta === "string" && delta) {
          completionText += delta;
        }
      }
      return;
    }

    if (streamWireApi === "anthropic_messages") {
      const delta = extractAnthropicTextDeltaFromChunk(payload);
      if (delta) {
        completionText += delta;
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
      completionText += reasoningDelta;
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
        void persistUsageEvent(context, explicitUsage, completionText);
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
    onCompleted?: (payload: {
      responseId: string;
      assistantMessage: LegacyChatMessage | null;
    }) => void | Promise<void>;
  }
) {
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "")}`;
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;
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
  };

  let completed = false;
  let outputText = "";
  let reasoningText = "";
  let explicitUsage: ReturnType<typeof extractTokenUsageFromPayload> | null = null;
  let emittedTextDelta = false;
  let messageItemAdded = false;
  let messageItemDone = false;
  let toolCallsDone = false;
  const pendingToolCalls = new Map<number, PendingToolCall>();
  const completedOutputItems: ResponseOutputItem[] = [];

  const ensureMessageItemAdded = (emitJson: (payload: unknown) => void) => {
    if (messageItemAdded) {
      return;
    }
    messageItemAdded = true;
    emitJson({
      type: "response.output_item.added",
      item: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: ""
          }
        ]
      }
    });
  };

  const emitMessageItemDone = (emitJson: (payload: unknown) => void) => {
    if (messageItemDone) {
      return;
    }
    ensureMessageItemAdded(emitJson);
    const messageItem: ResponseOutputItem = {
      id: messageId,
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
      item: messageItem
    });
    messageItemDone = true;
    completedOutputItems.push(messageItem);
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
    }
    toolCallsDone = true;
  };

  const emitCompleted = (emitJson: (payload: unknown) => void) => {
    if (completed) {
      return;
    }

    if (!emittedTextDelta && outputText) {
      ensureMessageItemAdded(emitJson);
      emitJson({
        type: "response.output_text.delta",
        delta: outputText
      });
      emittedTextDelta = true;
    }
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
          name: "",
          arguments: ""
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

      const delta = extractChatDeltaTextFromChunk(payload);
      if (delta) {
        ensureMessageItemAdded(emitJson);
        outputText += delta;
        emittedTextDelta = true;
        emitJson({
          type: "response.output_text.delta",
          delta
        });
      }

      const reasoningDelta = extractChatReasoningDeltaFromChunk(payload);
      if (reasoningDelta) {
        reasoningText += reasoningDelta;
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
    const mediaSnapshot = await persistAiCallImage(media.mediaUrl);
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
    const finalCaption = caption || (media.kind === "video" ? "Video content provided." : "Image content provided.");
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

  const body = rewrittenForFileIds.body;
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(
    normalizeLegacyMessages(body.messages as LegacyChatRequest["messages"])
  );

  const requestedModel = pickRequestedModel(body.model, resolved.key);
  const mappedRequestedModel = mapRequestedModelForKey(requestedModel, resolved.key);
  const promptTokensEstimate = estimateLegacyChatTokens(body, mappedRequestedModel);
  const dynamicPick = pickModelByContext(
    mappedRequestedModel,
    promptTokensEstimate,
    resolved.key
  );
  const runtimeResolved = resolveRuntimeModel(resolved.key, dynamicPick.model);
  const modelResolved = {
    ...runtimeResolved,
    clientModel: dynamicPick.switched ? dynamicPick.model : requestedModel
  };
  const runtimeKey = modelResolved.runtimeKey;

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
      const upstreamPayload = applyCodexThinkingModeForChat(
        {
          ...rewritten.body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey.provider
      );
      const upstream = await callChatCompletionsApiStream(
        upstreamPayload,
        runtimeKey
      );
      if (!upstream.ok) {
        return upstream;
      }
      return trackUsageFromSse(upstream, "chat_completions", {
        key: runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
    }
    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const upstreamPayload = mapLegacyChatToAnthropicMessages(
        {
          ...rewritten.body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey.defaultModel
      );
      upstreamPayload.model = modelResolved.upstreamModel;
      const upstream = await callAnthropicMessagesApiStream(upstreamPayload, runtimeKey);
      if (!upstream.ok) {
        return upstream;
      }
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
      const responsesStream = transformAnthropicStreamToResponses(tracked, modelResolved.clientModel, {
        promptTokensEstimate
      });
      return transformResponsesStreamToLegacyChat(responsesStream, modelResolved.clientModel);
    }
    const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
      allowVisionInput: runtimeKey.supportsVision
    });
    payload.model = modelResolved.upstreamModel;
    const upstream = await callResponsesApiStream(
      {
        ...payload,
        model: modelResolved.upstreamModel,
        stream: true
      },
      runtimeKey
    );
    if (!upstream.ok) {
      return upstream;
    }
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: runtimeKey,
      route,
      requestWireApi: "chat_completions",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    });
    return transformResponsesStreamToLegacyChat(tracked, modelResolved.clientModel);
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstreamPayload = applyCodexThinkingModeForChat(
      {
        ...rewritten.body,
        model: modelResolved.upstreamModel
      },
      runtimeKey.provider
    );
    const upstream = await callChatCompletionsApi(
      upstreamPayload,
      runtimeKey
    );
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyChatCompletionText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const upstreamPayload = mapLegacyChatToAnthropicMessages(
      {
        ...rewritten.body,
        model: modelResolved.upstreamModel
      },
      runtimeKey.defaultModel
    );
    upstreamPayload.model = modelResolved.upstreamModel;
    const upstream = await callAnthropicMessagesApi(upstreamPayload, runtimeKey);
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "chat_completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body)
    );
    return NextResponse.json(mapAnthropicToLegacyChat(upstream.body, modelResolved.clientModel));
  }

  const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
    allowVisionInput: runtimeKey.supportsVision
  });
  payload.model = modelResolved.upstreamModel;
  const upstream = await callResponsesApi(payload, runtimeKey);
  if (!upstream.ok) {
    return NextResponse.json(upstream.body, { status: upstream.status });
  }
  void persistUsageEvent(
    {
      key: runtimeKey,
      route,
      requestWireApi: "chat_completions",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body)
  );

  return NextResponse.json(mapResponsesToLegacyChat(upstream.body, modelResolved.clientModel));
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

  const legacyBody = mapAnthropicMessagesToLegacyChat(body, resolved.key.defaultModel);
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(
    normalizeLegacyMessages(legacyBody.messages as LegacyChatRequest["messages"])
  );

  const requestedModel = pickRequestedModel(body.model, resolved.key);
  const mappedRequestedModel = mapRequestedModelForKey(requestedModel, resolved.key);
  const promptTokensEstimate = estimateLegacyChatTokens(legacyBody, mappedRequestedModel);
  const dynamicPick = pickModelByContext(
    mappedRequestedModel,
    promptTokensEstimate,
    resolved.key
  );
  const runtimeResolved = resolveRuntimeModel(resolved.key, dynamicPick.model);
  const modelResolved = {
    ...runtimeResolved,
    clientModel: dynamicPick.switched ? dynamicPick.model : requestedModel
  };
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
      const upstreamPayload = applyCodexThinkingModeForChat(
        {
          ...rewritten.body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey.provider
      );
      const upstream = await callChatCompletionsApiStream(upstreamPayload, runtimeKey);
      if (!upstream.ok) {
        return anthropicErrorResponseFromStream(upstream, "Upstream chat/completions API error");
      }
      const tracked = trackUsageFromSse(upstream, "chat_completions", {
        key: runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
      return transformChatStreamToAnthropic(tracked, modelResolved.clientModel, {
        promptTokensEstimate
      });
    }

    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const upstreamPayload = mapLegacyChatToAnthropicMessages(
        {
          ...rewritten.body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey.defaultModel
      );
      upstreamPayload.model = modelResolved.upstreamModel;
      const upstream = await callAnthropicMessagesApiStream(
        upstreamPayload,
        runtimeKey,
        anthropicUpstreamHeaderOverrides
      );

      if (!upstream.ok) {
        return anthropicErrorResponseFromStream(upstream, "Upstream anthropic messages API error");
      }
      return trackUsageFromSse(upstream, "anthropic_messages", {
        key: runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
    }

    const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
      allowVisionInput: runtimeKey.supportsVision
    });
    payload.model = modelResolved.upstreamModel;
    const upstream = await callResponsesApiStream(
      {
        ...payload,
        model: modelResolved.upstreamModel,
        stream: true
      },
      runtimeKey
    );
    if (!upstream.ok) {
      return anthropicErrorResponseFromStream(upstream, "Upstream responses API error");
    }
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: runtimeKey,
      route,
      requestWireApi: "anthropic_messages",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    });
    return transformResponsesStreamToAnthropic(tracked, modelResolved.clientModel, {
      promptTokensEstimate
    });
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstreamPayload = applyCodexThinkingModeForChat(
      {
        ...rewritten.body,
        model: modelResolved.upstreamModel
      },
      runtimeKey.provider
    );
    const upstream = await callChatCompletionsApi(upstreamPayload, runtimeKey);
    if (!upstream.ok) {
      return anthropicErrorResponse(
        upstream.status,
        extractAnthropicUpstreamErrorMessage(upstream.body, "Upstream chat/completions API error")
      );
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyChatCompletionText(upstream.body)
    );
    const responsesPayload = mapLegacyChatCompletionToResponses(
      upstream.body,
      modelResolved.clientModel
    );
    return NextResponse.json(
      mapResponsesToAnthropicMessage(responsesPayload, modelResolved.clientModel)
    );
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const upstreamPayload = mapLegacyChatToAnthropicMessages(
      {
        ...rewritten.body,
        model: modelResolved.upstreamModel
      },
      runtimeKey.defaultModel
    );
    upstreamPayload.model = modelResolved.upstreamModel;
    const upstream = await callAnthropicMessagesApi(
      upstreamPayload,
      runtimeKey,
      anthropicUpstreamHeaderOverrides
    );
    if (!upstream.ok) {
      return anthropicErrorResponse(
        upstream.status,
        extractAnthropicUpstreamErrorMessage(upstream.body, "Upstream anthropic messages API error")
      );
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "anthropic_messages",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  const payload = mapLegacyChatToResponses(rewritten.body, runtimeKey.defaultModel, {
    allowVisionInput: runtimeKey.supportsVision
  });
  payload.model = modelResolved.upstreamModel;
  const upstream = await callResponsesApi(payload, runtimeKey);
  if (!upstream.ok) {
    return anthropicErrorResponse(
      upstream.status,
      extractAnthropicUpstreamErrorMessage(upstream.body, "Upstream responses API error")
    );
  }
  void persistUsageEvent(
    {
      key: runtimeKey,
      route,
      requestWireApi: "anthropic_messages",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body)
  );

  return NextResponse.json(
    mapResponsesToAnthropicMessage(upstream.body, modelResolved.clientModel)
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
  const mappedRequestedModel = mapRequestedModelForKey(requestedModel, resolved.key);
  const promptTokensEstimate = estimateLegacyCompletionTokens(body, mappedRequestedModel);
  const dynamicPick = pickModelByContext(
    mappedRequestedModel,
    promptTokensEstimate,
    resolved.key
  );
  const runtimeResolved = resolveRuntimeModel(resolved.key, dynamicPick.model);
  const modelResolved = {
    ...runtimeResolved,
    clientModel: dynamicPick.switched ? dynamicPick.model : requestedModel
  };
  const runtimeKey = modelResolved.runtimeKey;

  if (isStreamingRequest(body)) {
    if (runtimeKey.upstreamWireApi === "chat_completions") {
      const upstream = await callCompletionsApiStream(
        {
          ...body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey
      );
      if (!upstream.ok) {
        return upstream;
      }
      return trackUsageFromSse(upstream, "completions", {
        key: runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
    }
    if (runtimeKey.upstreamWireApi === "anthropic_messages") {
      const responsesPayload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
      const upstreamPayload = mapResponsesRequestToAnthropicMessages(
        {
          ...responsesPayload,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey.defaultModel
      );
      upstreamPayload.model = modelResolved.upstreamModel;
      const upstream = await callAnthropicMessagesApiStream(upstreamPayload, runtimeKey);
      if (!upstream.ok) {
        return upstream;
      }
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
      const responsesStream = transformAnthropicStreamToResponses(tracked, modelResolved.clientModel, {
        promptTokensEstimate
      });
      return transformResponsesStreamToLegacyCompletion(responsesStream, modelResolved.clientModel);
    }
    const payload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
    payload.model = modelResolved.upstreamModel;
    const upstream = await callResponsesApiStream(
      {
        ...payload,
        model: modelResolved.upstreamModel,
        stream: true
      },
      runtimeKey
    );
    if (!upstream.ok) {
      return upstream;
    }
    const tracked = trackUsageFromSse(upstream, "responses", {
      key: runtimeKey,
      route,
      requestWireApi: "completions",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    });
    return transformResponsesStreamToLegacyCompletion(tracked, modelResolved.clientModel);
  }

  if (runtimeKey.upstreamWireApi === "chat_completions") {
    const upstream = await callCompletionsApi(
      {
        ...body,
        model: modelResolved.upstreamModel
      },
      runtimeKey
    );
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractLegacyCompletionText(upstream.body)
    );
    return NextResponse.json(upstream.body);
  }

  if (runtimeKey.upstreamWireApi === "anthropic_messages") {
    const responsesPayload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
    const upstreamPayload = mapResponsesRequestToAnthropicMessages(
      {
        ...responsesPayload,
        model: modelResolved.upstreamModel
      },
      runtimeKey.defaultModel
    );
    upstreamPayload.model = modelResolved.upstreamModel;
    const upstream = await callAnthropicMessagesApi(upstreamPayload, runtimeKey);
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "completions",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body)
    );
    return NextResponse.json(
      mapResponsesToLegacyCompletion(
        mapAnthropicToResponses(upstream.body, modelResolved.clientModel),
        modelResolved.clientModel
      )
    );
  }

  const payload = mapLegacyCompletionToResponses(body, runtimeKey.defaultModel);
  payload.model = modelResolved.upstreamModel;
  const upstream = await callResponsesApi(payload, runtimeKey);
  if (!upstream.ok) {
    return NextResponse.json(upstream.body, { status: upstream.status });
  }
  void persistUsageEvent(
    {
      key: runtimeKey,
      route,
      requestWireApi: "completions",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    },
    extractTokenUsageFromPayload(upstream.body),
    extractResponseText(upstream.body)
  );

  return NextResponse.json(
    mapResponsesToLegacyCompletion(upstream.body, modelResolved.clientModel)
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

  const body = rewrittenForFileIds.body;
  const promptSnapshot = extractPromptSnapshotFromResponsesBody(body);

  const requestedModel = pickRequestedModel(body.model, resolved.key);
  const mappedRequestedModel = mapRequestedModelForKey(requestedModel, resolved.key);
  const promptTokensEstimate = estimateResponsesRequestTokens(body, mappedRequestedModel);
  const dynamicPick = pickModelByContext(
    mappedRequestedModel,
    promptTokensEstimate,
    resolved.key
  );
  const runtimeResolved = resolveRuntimeModel(resolved.key, dynamicPick.model);
  const modelResolved = {
    ...runtimeResolved,
    clientModel: dynamicPick.switched ? dynamicPick.model : requestedModel
  };
  const runtimeKey = modelResolved.runtimeKey;
  const responseContextScope = String(resolved.key.id);

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
      const upstream = await callResponsesApiStream(
        {
          ...rewrittenResponses.body,
          model: modelResolved.upstreamModel,
          stream: true
        },
        runtimeKey
      );
      if (!upstream.ok) {
        return upstream;
      }
      return trackUsageFromSse(upstream, "responses", {
        key: runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
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

      const legacyPayload = {
        ...mapped,
        model: modelResolved.upstreamModel,
        messages: rewritten.body.messages,
        stream: true
      };
      const anthropicPayload = mapLegacyChatToAnthropicMessages(legacyPayload, runtimeKey.defaultModel);
      anthropicPayload.model = modelResolved.upstreamModel;
      const upstream = await callAnthropicMessagesApiStream(anthropicPayload, runtimeKey);
      if (!upstream.ok) {
        return upstream;
      }
      const tracked = trackUsageFromSse(upstream, "anthropic_messages", {
        key: runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: true,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      });
      const contextBaseMessages = normalizeLegacyMessages(
        legacyPayload.messages as LegacyChatRequest["messages"]
      );
      return transformAnthropicStreamToResponses(tracked, modelResolved.clientModel, {
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
    const upstreamPayload = applyCodexThinkingModeForChat(legacyPayload, runtimeKey.provider);
    const upstream = await callChatCompletionsApiStream(upstreamPayload, runtimeKey);
    if (!upstream.ok) {
      return upstream;
    }
    const tracked = trackUsageFromSse(upstream, "chat_completions", {
      key: runtimeKey,
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: true,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    });
    const contextBaseMessages = normalizeLegacyMessages(
      upstreamPayload.messages as LegacyChatRequest["messages"]
    );
    return transformChatStreamToResponses(tracked, modelResolved.clientModel, {
      promptTokensEstimate,
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
    const upstream = await callResponsesApi(
      {
        ...rewrittenResponses.body,
        model: modelResolved.upstreamModel
      },
      runtimeKey
    );
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
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

    const legacyPayload = {
      ...mapped,
      model: modelResolved.upstreamModel,
      messages: rewritten.body.messages
    };
    const anthropicPayload = mapLegacyChatToAnthropicMessages(legacyPayload, runtimeKey.defaultModel);
    anthropicPayload.model = modelResolved.upstreamModel;
    const upstream = await callAnthropicMessagesApi(anthropicPayload, runtimeKey);
    if (!upstream.ok) {
      return NextResponse.json(upstream.body, { status: upstream.status });
    }
    void persistUsageEvent(
      {
        key: runtimeKey,
        route,
        requestWireApi: "responses",
        requestedModel,
        clientModel: modelResolved.clientModel,
        upstreamModel: modelResolved.upstreamModel,
        promptTokensEstimate,
        stream: false,
        systemPrompt: promptSnapshot.systemPrompt,
        userPrompt: promptSnapshot.userPrompt
      },
      extractTokenUsageFromPayload(upstream.body),
      extractAnthropicMessageText(upstream.body)
    );
    const mappedResponse = mapAnthropicToResponses(upstream.body, modelResolved.clientModel);
    const baseMessages = normalizeLegacyMessages(legacyPayload.messages as LegacyChatRequest["messages"]);
    const assistantMessage = extractAnthropicAssistantMessage(upstream.body);
    const nextMessages = assistantMessage ? [...baseMessages, assistantMessage] : baseMessages;
    writeResponseContext(responseContextScope, mappedResponse.id, nextMessages);
    return NextResponse.json(mappedResponse);
  }

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

  const legacyPayload = {
    ...mapped,
    model: modelResolved.upstreamModel,
    messages: rewritten.body.messages
  };

  const upstreamPayload = applyCodexThinkingModeForChat(legacyPayload, runtimeKey.provider);
  const upstream = await callChatCompletionsApi(upstreamPayload, runtimeKey);
  if (!upstream.ok) {
    return NextResponse.json(upstream.body, { status: upstream.status });
  }
  void persistUsageEvent(
    {
      key: runtimeKey,
      route,
      requestWireApi: "responses",
      requestedModel,
      clientModel: modelResolved.clientModel,
      upstreamModel: modelResolved.upstreamModel,
      promptTokensEstimate,
      stream: false,
      systemPrompt: promptSnapshot.systemPrompt,
      userPrompt: promptSnapshot.userPrompt
    },
    extractTokenUsageFromPayload(upstream.body),
    extractLegacyChatCompletionText(upstream.body)
  );

  const mappedResponse = mapLegacyChatCompletionToResponses(upstream.body, modelResolved.clientModel);
  const baseMessages = normalizeLegacyMessages(upstreamPayload.messages as LegacyChatRequest["messages"]);
  const assistantMessage = extractAssistantMessageFromLegacyChatPayload(upstream.body);
  const nextMessages = assistantMessage ? [...baseMessages, assistantMessage] : baseMessages;
  writeResponseContext(responseContextScope, mappedResponse.id, nextMessages);
  return NextResponse.json(mappedResponse);
}
