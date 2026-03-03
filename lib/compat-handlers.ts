import { NextResponse } from "next/server";
import {
  collectImageInputs,
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
  replaceImagesWithCaptions
} from "@/lib/mapper";
import {
  callChatCompletionsApi,
  callChatCompletionsApiStream,
  callCompletionsApi,
  callCompletionsApiStream,
  callResponsesApi,
  callResponsesApiStream,
  resolveGatewayKey
} from "@/lib/upstream";
import { prisma } from "@/lib/prisma";
import { mapModelByKeyMappings, normalizeUpstreamModels } from "@/lib/key-config";
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

type RequestWireApi = "responses" | "chat_completions" | "completions";

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

function isThinkingDisabledByEffort(effort: string) {
  const normalized = effort.trim().toLowerCase();
  return normalized === "none" || normalized === "off" || normalized === "disabled" || normalized === "minimal";
}

function applyCodexThinkingModeForChat<T extends LegacyChatRequest>(payload: T, provider: string): T {
  const reasoningEffort = normalizeOptionalField(payload.reasoning_effort);
  if (!reasoningEffort) {
    return payload;
  }

  const nextPayload: LegacyChatRequest = {
    ...payload
  };
  // GLM chat/completions uses thinking.{type, clear_thinking} for reasoning mode.
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === "glm") {
    nextPayload.reasoning_effort = undefined;
    nextPayload.verbosity = undefined;
    nextPayload.thinking = {
      type: isThinkingDisabledByEffort(reasoningEffort) ? "disabled" : "enabled",
      clear_thinking: true
    };
    return nextPayload as T;
  }
  // For other providers keep upstream-native reasoning fields and do not inject system hints.
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
    const usage = extractTokenUsageFromPayload(payload);
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
    upstreamWireApi: channel.upstreamWireApi === "chat_completions" ? "chat_completions" : "responses",
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
    (channel.upstreamWireApi === "chat_completions" ? "chat_completions" : "responses");

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

function buildVisionCaptionPrompt(params: {
  messages: LegacyChatMessage[];
  imageIndex: number;
  imageTotal: number;
  imageMessageIndex: number;
  imageDetail?: string;
}) {
  const hints = collectVisionFocusHints(params.messages, params.imageMessageIndex);
  const mergedHintText = hints.join("；");
  const truncatedHintText =
    mergedHintText.length > 600 ? `${mergedHintText.slice(0, 600)}...` : mergedHintText;
  const detailHint = params.imageDetail ? `图片 detail 参数：${params.imageDetail}` : "";
  const userHintBlock = truncatedHintText
    ? `用户重点要求/标注（务必优先覆盖）：${truncatedHintText}`
    : "用户未提供明确重点标注，请你给出完整细致描述。";

  return [
    "你是图片理解与 OCR 助手。请严格使用中文纯文本回答。",
    `当前处理第 ${params.imageIndex + 1}/${params.imageTotal} 张图片。`,
    detailHint,
    userHintBlock,
    "",
    "请按以下固定结构输出（必须包含 4 段）：",
    "【重点需求与标注】优先总结用户要求、标注区域、需要重点解释的部分；若无写“未提供特定重点”。",
    "【全图详细描述】从整体到局部描述场景、主体、位置关系、动作状态、颜色、数量、布局、异常点。",
    "【文字与数据提取】逐条转写可见文字（OCR）、UI 文本、表格/图表关键数值；看不清要注明“无法辨认”。",
    "【补充与不确定性】说明遮挡、模糊、歧义、推断边界，不要编造图片中不存在的信息。",
    "",
    "要求：描述必须详细，不能只给一句摘要。"
  ]
    .filter(Boolean)
    .join("\n");
}

async function describeImagesWithVisionModel(
  chatBody: LegacyChatRequest,
  key: ResolvedGatewayKey,
  traceContext?: Pick<UsageTraceContext, "route" | "requestWireApi" | "requestedModel" | "clientModel">
) {
  const images = collectImageInputs(chatBody.messages ?? []);
  if (!images.length || key.supportsVision) {
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
  for (const image of images) {
    const captionPrompt = buildVisionCaptionPrompt({
      messages: chatBody.messages ?? [],
      imageIndex: captions.length,
      imageTotal: images.length,
      imageMessageIndex: image.messageIndex,
      imageDetail: image.detail
    });
    const imageSnapshot = await persistAiCallImage(image.imageUrl);

    const captionResp =
      visionRuntimeKey.upstreamWireApi === "responses"
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
                    {
                      type: "input_image",
                      image_url: image.imageUrl,
                      detail: image.detail
                    }
                  ]
                }
              ],
              max_output_tokens: 1200
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
                    {
                      type: "image_url",
                      image_url: {
                        url: image.imageUrl,
                        detail: image.detail
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
          error: "Vision fallback model failed while converting image to text.",
          detail: captionResp.body,
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

    const caption =
      visionRuntimeKey.upstreamWireApi === "responses"
        ? extractResponseText(captionResp.body).trim()
        : extractLegacyChatCompletionText(captionResp.body).trim();
    const finalCaption = caption || "Image content provided.";
    captions.push(finalCaption);
    await appendAiCallLogEntry({
      id: crypto.randomUUID().slice(0, 12),
      keyId: key.id,
      keyName: key.name,
      route: traceContext?.route ?? "/vision-fallback",
      requestWireApi: traceContext?.requestWireApi ?? "responses",
      upstreamWireApi: visionRuntimeKey.upstreamWireApi,
      requestedModel: traceContext?.requestedModel ?? key.defaultModel,
      clientModel: traceContext?.clientModel ?? traceContext?.requestedModel ?? key.defaultModel,
      upstreamModel: visionModelForCaption,
      callType: "vision_fallback",
      stream: false,
      systemPrompt: "",
      userPrompt: clipLogText(`${captionPrompt}\n[image_input]`),
      assistantResponse: clipLogText(finalCaption),
      images: [imageSnapshot],
      createdAt: new Date().toISOString()
    });
  }

  return {
    ok: true as const,
    body: {
      ...chatBody,
      messages: replaceImagesWithCaptions(chatBody.messages ?? [], captions)
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
  const rewritten = await describeImagesWithVisionModel(
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
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof mapLegacyChatToResponses>[0];
  const promptSnapshot = extractPromptSnapshotFromLegacyMessages(
    normalizeLegacyMessages(body.messages as LegacyChatRequest["messages"])
  );

  const resolved = await resolveGatewayKey(req.headers.get("authorization"));
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

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

  const rewritten = await describeImagesWithVisionModel(body, runtimeKey, {
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

export async function handleLegacyCompletions(
  req: Request,
  route = "/v1/completions"
) {
  const body = (await req.json().catch(() => ({}))) as Parameters<typeof mapLegacyCompletionToResponses>[0];
  const promptSnapshot = extractPromptSnapshotFromLegacyCompletionBody(body);

  const resolved = await resolveGatewayKey(req.headers.get("authorization"));
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
  const body = (await req.json().catch(() => ({}))) as ResponsesRequest;
  const promptSnapshot = extractPromptSnapshotFromResponsesBody(body);

  const resolved = await resolveGatewayKey(req.headers.get("authorization"));
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

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

    const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
    const previousMessages = readResponseContext(body.previous_response_id);
    const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
    const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
    const rewritten = await describeImagesWithVisionModel(
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
        writeResponseContext(responseId, nextMessages);
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

  const mapped = mapResponsesRequestToLegacyChat(body, modelResolved.upstreamModel);
  const previousMessages = readResponseContext(body.previous_response_id);
  const incomingMessages = normalizeLegacyMessages(mapped.messages as LegacyChatRequest["messages"]);
  const mergedMessages = mergeContinuationMessages(previousMessages, incomingMessages);
  const rewritten = await describeImagesWithVisionModel(
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
  writeResponseContext(mappedResponse.id, nextMessages);
  return NextResponse.json(mappedResponse);
}
