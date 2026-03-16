function collectTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
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

export function extractCompletionDeltaTextFromChunk(payload: unknown): string {
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

export function extractSseData(block: string): string | null {
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

export function extractChatDeltaTextFromChunk(payload: unknown): string {
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
  if (Array.isArray(deltaContent)) {
    return collectTextParts(deltaContent);
  }

  const messageContent = choice.message?.content;
  if (typeof messageContent === "string") {
    return messageContent;
  }
  return collectTextParts(messageContent);
}

export function extractChatReasoningDeltaFromChunk(payload: unknown): string {
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
    return collectTextParts(reasoningContent);
  }
  const messageReasoning = choice.message?.reasoning_content;
  if (typeof messageReasoning === "string" && messageReasoning) {
    return messageReasoning;
  }
  return collectTextParts(messageReasoning);
}

export function extractAnthropicThinkingDeltaFromChunk(payload: unknown): string {
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

export function extractResponsesTextDelta(payload: unknown): string {
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

export function extractResponsesReasoningDelta(payload: unknown): string {
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

export function extractResponsesReasoningText(payload: unknown): string {
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

export type ChatToolCallDelta = {
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

export function extractChatToolCallDeltasFromChunk(payload: unknown): ChatToolCallDelta[] {
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

export type AnthropicToolUseDelta = {
  index: number;
  callId?: string;
  name?: string;
  inputJsonDelta?: string;
};

export function extractAnthropicTextDeltaFromChunk(payload: unknown): string {
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

export function extractAnthropicToolUseDeltaFromChunk(payload: unknown): AnthropicToolUseDelta[] {
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

export function extractAnthropicFinishReason(payload: unknown): string | null {
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

export function extractChatFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const finishReason = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]
    ?.finish_reason;
  return typeof finishReason === "string" && finishReason ? finishReason : null;
}

export function extractLegacyCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const text = (payload as { choices?: Array<{ text?: unknown }> }).choices?.[0]?.text;
  return typeof text === "string" ? text : "";
}
