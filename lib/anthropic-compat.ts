import { mapResponsesRequestToLegacyChat, type LegacyChatMessage, type LegacyChatRequest, type ResponsesRequest } from "@/lib/mapper";

type AnthropicTextBlock = {
  type: "text";
  text: string;
};

type AnthropicThinkingBlock = {
  type: "thinking";
  thinking: string;
  signature?: string;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type AnthropicMessagesRequest = {
  model?: string;
  messages?: unknown;
  system?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: unknown;
  tool_choice?: unknown;
  output_config?: {
    effort?: string;
    [key: string]: unknown;
  };
  thinking?: {
    type?: string;
    budget_tokens?: number;
    [key: string]: unknown;
  };
};

type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
};

type AnthropicMessageResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock>;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  stop_sequence: string | null;
  usage: AnthropicUsage;
};

function joinTextParts(parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function toSafeInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.floor(n);
}

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

function parseJsonLikeInput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { raw: trimmed };
  }
}

function normalizeAnthropicText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.trim()) {
        parts.push(item.trim());
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }

    const rawType = "type" in item ? (item as { type?: unknown }).type : undefined;
    if (rawType === "text") {
      const text = "text" in item ? (item as { text?: unknown }).text : undefined;
      if (typeof text === "string" && text.trim()) {
        parts.push(text.trim());
      }
      continue;
    }

    const text = "text" in item ? (item as { text?: unknown }).text : undefined;
    if (typeof text === "string" && text.trim()) {
      parts.push(text.trim());
      continue;
    }

    const content = "content" in item ? (item as { content?: unknown }).content : undefined;
    if (typeof content === "string" && content.trim()) {
      parts.push(content.trim());
    }
  }

  return joinTextParts(parts);
}

function normalizeAnthropicSystemMessage(system: unknown): LegacyChatMessage[] {
  const text = normalizeAnthropicText(system);
  if (!text) {
    return [];
  }
  return [{ role: "system", content: text }];
}

function blockTextContent(block: unknown): string {
  if (!block || typeof block !== "object") {
    return "";
  }
  if ("text" in block) {
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") {
      return text.trim();
    }
  }
  if ("content" in block) {
    return normalizeAnthropicText((block as { content?: unknown }).content);
  }
  return "";
}

function normalizeAnthropicThinkingBlock(block: unknown): AnthropicThinkingBlock | null {
  if (!block || typeof block !== "object") {
    return null;
  }
  const type = "type" in block ? (block as { type?: unknown }).type : undefined;
  if (type !== "thinking") {
    return null;
  }
  const thinking = "thinking" in block ? (block as { thinking?: unknown }).thinking : undefined;
  if (typeof thinking !== "string" || !thinking.trim()) {
    return null;
  }
  const signature = "signature" in block ? (block as { signature?: unknown }).signature : undefined;
  return {
    type: "thinking",
    thinking: thinking.trim(),
    ...(typeof signature === "string" && signature.trim() ? { signature: signature.trim() } : {})
  };
}

function normalizeAnthropicImageBlock(block: unknown) {
  if (!block || typeof block !== "object") {
    return null;
  }
  const source = "source" in block ? (block as { source?: unknown }).source : undefined;
  if (!source || typeof source !== "object") {
    return null;
  }

  const sourceType = "type" in source ? (source as { type?: unknown }).type : undefined;
  if (sourceType === "base64") {
    const mediaType = "media_type" in source ? (source as { media_type?: unknown }).media_type : undefined;
    const data = "data" in source ? (source as { data?: unknown }).data : undefined;
    if (typeof mediaType === "string" && mediaType.trim() && typeof data === "string" && data.trim()) {
      return {
        type: "image_url" as const,
        image_url: {
          url: `data:${mediaType.trim()};base64,${data.trim()}`
        }
      };
    }
    return null;
  }

  const url =
    ("url" in source ? (source as { url?: unknown }).url : undefined) ??
    ("data" in source ? (source as { data?: unknown }).data : undefined);
  if (typeof url === "string" && url.trim()) {
    return {
      type: "image_url" as const,
      image_url: {
        url: url.trim()
      }
    };
  }

  return null;
}

function normalizeAnthropicToolsForLegacyChat(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  const mapped = tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }
      const name = "name" in tool ? (tool as { name?: unknown }).name : undefined;
      if (typeof name !== "string" || !name.trim()) {
        return null;
      }
      const description =
        "description" in tool ? (tool as { description?: unknown }).description : undefined;
      const inputSchema =
        "input_schema" in tool ? (tool as { input_schema?: unknown }).input_schema : undefined;

      return {
        type: "function",
        function: {
          name: name.trim(),
          ...(typeof description === "string" && description.trim()
            ? { description: description.trim() }
            : {}),
          ...(inputSchema && typeof inputSchema === "object" ? { parameters: inputSchema } : {})
        }
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return mapped.length ? mapped : undefined;
}

function normalizeAnthropicToolChoiceForLegacyChat(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") {
    return undefined;
  }

  const type = "type" in toolChoice ? (toolChoice as { type?: unknown }).type : undefined;
  if (type === "auto") {
    return "auto";
  }
  if (type === "any") {
    return "required";
  }
  if (type === "tool") {
    const name = "name" in toolChoice ? (toolChoice as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name.trim()) {
      return {
        type: "function",
        function: {
          name: name.trim()
        }
      };
    }
  }

  return undefined;
}

function normalizeAnthropicThinkingEffort(thinking: AnthropicMessagesRequest["thinking"]) {
  const type = thinking?.type?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }
  if (type === "disabled") {
    return "minimal";
  }
  if (type !== "enabled") {
    return undefined;
  }

  const budget = toSafeInt(thinking?.budget_tokens);
  if (budget >= 4096) {
    return "high";
  }
  if (budget >= 1024) {
    return "medium";
  }
  return "low";
}

function normalizeAnthropicOutputConfigEffort(outputConfig: AnthropicMessagesRequest["output_config"]) {
  if (!outputConfig || typeof outputConfig !== "object") {
    return undefined;
  }
  const effort = typeof outputConfig.effort === "string" ? outputConfig.effort.trim().toLowerCase() : "";
  if (effort === "low" || effort === "medium" || effort === "high") {
    return effort;
  }
  return undefined;
}

function normalizeAnthropicOutputConfig(outputConfig: AnthropicMessagesRequest["output_config"]) {
  if (!outputConfig || typeof outputConfig !== "object") {
    return undefined;
  }

  const normalized: NonNullable<AnthropicMessagesRequest["output_config"]> = {
    ...outputConfig
  };
  const effort = normalizeAnthropicOutputConfigEffort(outputConfig);
  if (effort) {
    normalized.effort = effort;
  } else {
    delete normalized.effort;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeAnthropicThinking(thinking: AnthropicMessagesRequest["thinking"]) {
  if (!thinking || typeof thinking !== "object") {
    return undefined;
  }
  const type = thinking.type?.trim().toLowerCase();
  if (type !== "enabled" && type !== "disabled" && type !== "adaptive") {
    return undefined;
  }

  const normalized: NonNullable<AnthropicMessagesRequest["thinking"]> = {
    type
  };
  const budget = toSafeInt(thinking.budget_tokens);
  if (budget > 0) {
    normalized.budget_tokens = budget;
  }
  return normalized;
}

function pushUserMessage(buffer: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>, messages: LegacyChatMessage[]) {
  if (!buffer.length) {
    return;
  }
  messages.push({
    role: "user",
    content: buffer.map((item) => ({ ...item }))
  });
  buffer.length = 0;
}

function normalizeAnthropicInputMessages(messages: unknown): LegacyChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const normalized: LegacyChatMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const role = "role" in message ? (message as { role?: unknown }).role : undefined;
    const content = "content" in message ? (message as { content?: unknown }).content : undefined;
    const blocks = Array.isArray(content)
      ? content
      : typeof content === "string"
        ? [{ type: "text", text: content }]
        : [];

    if (role === "assistant") {
      const assistantContentParts: Array<
        { type: "text"; text: string } |
        { type: "thinking"; thinking: string; signature?: string }
      > = [];
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }> = [];

      for (const block of blocks) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const type = "type" in block ? (block as { type?: unknown }).type : undefined;
        if (type === "tool_use") {
          const id = "id" in block ? (block as { id?: unknown }).id : undefined;
          const name = "name" in block ? (block as { name?: unknown }).name : undefined;
          const input = "input" in block ? (block as { input?: unknown }).input : {};
          if (typeof id === "string" && id.trim() && typeof name === "string" && name.trim()) {
            toolCalls.push({
              id: id.trim(),
              type: "function",
              function: {
                name: name.trim(),
                arguments: stringifyUnknown(input)
              }
            });
          }
          continue;
        }

        const thinkingBlock = normalizeAnthropicThinkingBlock(block);
        if (thinkingBlock) {
          assistantContentParts.push(thinkingBlock);
          continue;
        }

        const text = blockTextContent(block);
        if (text) {
          assistantContentParts.push({ type: "text", text });
        }
      }

      if (assistantContentParts.length || toolCalls.length) {
        const assistantText = joinTextParts(
          assistantContentParts
            .map((part) => (part.type === "text" ? part.text : ""))
            .filter(Boolean)
        );
        const hasThinking = assistantContentParts.some((part) => part.type === "thinking");
        normalized.push({
          role: "assistant",
          content: hasThinking ? assistantContentParts : assistantText,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        });
      }
      continue;
    }

    const userBuffer: Array<
      { type: "text"; text: string } |
      { type: "image_url"; image_url: { url: string } }
    > = [];

    for (const block of blocks) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const type = "type" in block ? (block as { type?: unknown }).type : undefined;
      if (type === "tool_result") {
        pushUserMessage(userBuffer, normalized);
        const toolUseId =
          "tool_use_id" in block ? (block as { tool_use_id?: unknown }).tool_use_id : undefined;
        if (typeof toolUseId !== "string" || !toolUseId.trim()) {
          continue;
        }
        const contentText = normalizeAnthropicText(
          "content" in block ? (block as { content?: unknown }).content : undefined
        );
        const isError =
          "is_error" in block ? (block as { is_error?: unknown }).is_error === true : false;
        normalized.push({
          role: "tool",
          tool_call_id: toolUseId.trim(),
          content: isError && contentText ? `Tool error: ${contentText}` : contentText
        });
        continue;
      }

      if (type === "image") {
        const image = normalizeAnthropicImageBlock(block);
        if (image) {
          userBuffer.push(image);
        }
        continue;
      }

      const text = blockTextContent(block);
      if (text) {
        userBuffer.push({ type: "text", text });
      }
    }

    pushUserMessage(userBuffer, normalized);
  }

  return normalized;
}

function normalizeResponseTextContent(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const content = "content" in item ? (item as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const type = "type" in part ? (part as { type?: unknown }).type : undefined;
      if (type !== "output_text") {
        return "";
      }
      const text = "text" in part ? (part as { text?: unknown }).text : undefined;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("");
}

function normalizeResponseReasoningContent(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const itemType = "type" in item ? (item as { type?: unknown }).type : undefined;
  if (itemType !== "reasoning") {
    return "";
  }

  const summary =
    (Array.isArray((item as { summary?: unknown }).summary)
      ? (item as { summary?: unknown[] }).summary
      : undefined) ??
    (Array.isArray((item as { content?: unknown }).content)
      ? (item as { content?: unknown[] }).content
      : undefined) ??
    [];

  const text = summary
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!part || typeof part !== "object") {
        return "";
      }
      const value = "text" in part ? (part as { text?: unknown }).text : undefined;
      return typeof value === "string" ? value : "";
    })
    .filter(Boolean)
    .join("")
    .trim();

  if (text) {
    return text;
  }

  const directText = "text" in item ? (item as { text?: unknown }).text : undefined;
  return typeof directText === "string" ? directText.trim() : "";
}

function normalizeResponsesUsage(payload: Record<string, unknown>) {
  const usage = payload.usage && typeof payload.usage === "object"
    ? (payload.usage as Record<string, unknown>)
    : {};
  return {
    input_tokens: toSafeInt(usage.input_tokens ?? usage.prompt_tokens),
    output_tokens: toSafeInt(usage.output_tokens ?? usage.completion_tokens)
  } satisfies AnthropicUsage;
}

export function mapAnthropicMessagesToLegacyChat(
  body: AnthropicMessagesRequest,
  defaultModel: string
): LegacyChatRequest {
  const messages = [
    ...normalizeAnthropicSystemMessage(body.system),
    ...normalizeAnthropicInputMessages(body.messages)
  ];

  const thinking = normalizeAnthropicThinking(body.thinking);
  const outputConfig = normalizeAnthropicOutputConfig(body.output_config);
  const reasoningEffort =
    normalizeAnthropicOutputConfigEffort(outputConfig ?? body.output_config) ??
    normalizeAnthropicThinkingEffort(thinking ?? body.thinking);
  const tools = normalizeAnthropicToolsForLegacyChat(body.tools);
  const toolChoice = normalizeAnthropicToolChoiceForLegacyChat(body.tool_choice);

  return {
    model: body.model ?? defaultModel,
    messages: messages.length ? messages : [{ role: "user", content: "" }],
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    top_p: body.top_p,
    stream: body.stream,
    ...(outputConfig ? { anthropic_output_config: outputConfig } : {}),
    ...(thinking ? { thinking } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {})
  };
}

export function mapResponsesToAnthropicMessage(
  responseJson: unknown,
  fallbackModel: string
): AnthropicMessageResponse {
  const payload = responseJson && typeof responseJson === "object"
    ? (responseJson as Record<string, unknown>)
    : {};
  const output = Array.isArray(payload.output) ? payload.output : [];

  const content: Array<AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock> = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const type = "type" in item ? (item as { type?: unknown }).type : undefined;
    if (type === "message") {
      const text = normalizeResponseTextContent(item);
      if (text) {
        content.push({ type: "text", text });
      }
      continue;
    }
    if (type === "reasoning") {
      const thinking = normalizeResponseReasoningContent(item);
      if (thinking) {
        content.push({ type: "thinking", thinking });
      }
      continue;
    }
    if (type === "function_call") {
      const callId = "call_id" in item ? (item as { call_id?: unknown }).call_id : undefined;
      const name = "name" in item ? (item as { name?: unknown }).name : undefined;
      const argumentsText =
        "arguments" in item ? (item as { arguments?: unknown }).arguments : undefined;
      if (typeof callId === "string" && callId.trim() && typeof name === "string" && name.trim()) {
        content.push({
          type: "tool_use",
          id: callId.trim(),
          name: name.trim(),
          input: parseJsonLikeInput(stringifyUnknown(argumentsText))
        });
      }
    }
  }

  if (!content.length) {
    const outputText = typeof payload.output_text === "string" ? payload.output_text : "";
    content.push({ type: "text", text: outputText });
  }

  const usage = normalizeResponsesUsage(payload);
  const responseId =
    typeof payload.id === "string" && payload.id.trim().startsWith("msg_")
      ? payload.id.trim()
      : `msg_${crypto.randomUUID().replace(/-/g, "")}`;

  return {
    id: responseId,
    type: "message",
    role: "assistant",
    model:
      typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : fallbackModel,
    content,
    stop_reason: content.some((item) => item.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage
  };
}



type AnthropicImageBlock = {
  type: "image";
  source:
    | {
        type: "base64";
        media_type: string;
        data: string;
      }
    | {
        type: "url";
        url: string;
      };
};

type AnthropicToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

type AnthropicInputBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

type AnthropicInputMessage = {
  role: "user" | "assistant";
  content: string | AnthropicInputBlock[];
};

function normalizeLegacyTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part.trim();
      }
      if (!part || typeof part !== "object") {
        return "";
      }
      const rawType = "type" in part ? (part as { type?: unknown }).type : undefined;
      if (rawType === "text") {
        const text = "text" in part ? (part as { text?: unknown }).text : undefined;
        return typeof text === "string" ? text.trim() : "";
      }
      const text = "text" in part ? (part as { text?: unknown }).text : undefined;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeLegacyAssistantContentBlocks(content: unknown): Array<AnthropicTextBlock | AnthropicThinkingBlock> {
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ type: "text", text }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: Array<AnthropicTextBlock | AnthropicThinkingBlock> = [];
  for (const part of content) {
    if (typeof part === "string") {
      const text = part.trim();
      if (text) {
        blocks.push({ type: "text", text });
      }
      continue;
    }
    if (!part || typeof part !== "object") {
      continue;
    }
    const rawType = "type" in part ? (part as { type?: unknown }).type : undefined;
    if (rawType === "thinking") {
      const thinking = "thinking" in part ? (part as { thinking?: unknown }).thinking : undefined;
      const signature = "signature" in part ? (part as { signature?: unknown }).signature : undefined;
      if (typeof thinking === "string" && thinking.trim()) {
        blocks.push({
          type: "thinking",
          thinking: thinking.trim(),
          ...(typeof signature === "string" && signature.trim() ? { signature: signature.trim() } : {})
        });
      }
      continue;
    }
    const text = "text" in part ? (part as { text?: unknown }).text : undefined;
    if (typeof text === "string" && text.trim()) {
      blocks.push({ type: "text", text: text.trim() });
    }
  }
  return blocks;
}

function normalizeLegacyImageBlocks(content: unknown): AnthropicImageBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: AnthropicImageBlock[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const rawType = "type" in part ? (part as { type?: unknown }).type : undefined;
    if (rawType !== "image_url") {
      continue;
    }
    const imageUrl = "image_url" in part ? (part as { image_url?: unknown }).image_url : undefined;
    const url = typeof imageUrl === "string"
      ? imageUrl.trim()
      : imageUrl && typeof imageUrl === "object" && typeof (imageUrl as { url?: unknown }).url === "string"
        ? ((imageUrl as { url: string }).url).trim()
        : "";
    if (!url) {
      continue;
    }
    const match = url.match(/^data:(.+?);base64,(.+)$/i);
    if (match) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1],
          data: match[2]
        }
      });
      continue;
    }
    blocks.push({
      type: "image",
      source: {
        type: "url",
        url
      }
    });
  }
  return blocks;
}

function normalizeLegacyToolsForAnthropic(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return undefined;
  }
  const mapped = tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }
      const nestedFunction = "function" in tool ? (tool as { function?: unknown }).function : undefined;
      const fn = nestedFunction && typeof nestedFunction === "object" ? nestedFunction : tool;
      const name = "name" in fn ? (fn as { name?: unknown }).name : undefined;
      if (typeof name !== "string" || !name.trim()) {
        return null;
      }
      const description = "description" in fn ? (fn as { description?: unknown }).description : undefined;
      const parameters =
        ("parameters" in fn ? (fn as { parameters?: unknown }).parameters : undefined) ??
        ("input_schema" in fn ? (fn as { input_schema?: unknown }).input_schema : undefined);
      return {
        name: name.trim(),
        ...(typeof description === "string" && description.trim() ? { description: description.trim() } : {}),
        input_schema: parameters && typeof parameters === "object" ? parameters : { type: "object", properties: {} }
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return mapped.length ? mapped : undefined;
}

function normalizeLegacyToolChoiceForAnthropic(toolChoice: unknown): unknown {
  if (toolChoice === "auto") {
    return { type: "auto" };
  }
  if (toolChoice === "required") {
    return { type: "any" };
  }
  if (!toolChoice || typeof toolChoice !== "object") {
    return undefined;
  }
  const type = "type" in toolChoice ? (toolChoice as { type?: unknown }).type : undefined;
  if (type === "function") {
    const nestedFunction = "function" in toolChoice ? (toolChoice as { function?: unknown }).function : undefined;
    const fn = nestedFunction && typeof nestedFunction === "object" ? nestedFunction : toolChoice;
    const name = "name" in fn ? (fn as { name?: unknown }).name : undefined;
    if (typeof name === "string" && name.trim()) {
      return {
        type: "tool",
        name: name.trim()
      };
    }
  }
  return undefined;
}

function normalizeLegacyThinkingForAnthropic(body: {
  thinking?: LegacyChatRequest["thinking"];
  reasoning_effort?: string;
  reasoning?: { effort?: string } | undefined;
}) {
  if (body.thinking && typeof body.thinking === "object") {
    const rawType = typeof body.thinking.type === "string" ? body.thinking.type.trim().toLowerCase() : "";
    if (rawType === "enabled" || rawType === "disabled" || rawType === "adaptive") {
      const normalized: NonNullable<AnthropicMessagesRequest["thinking"]> = {
        type: rawType
      };
      const budget = toSafeInt((body.thinking as { budget_tokens?: unknown }).budget_tokens);
      if (budget > 0) {
        normalized.budget_tokens = budget;
      }
      return normalized;
    }
  }

  const effort =
    body.reasoning?.effort?.trim() ||
    body.reasoning_effort?.trim() ||
    "";
  if (!effort) {
    return undefined;
  }
  const normalized = effort.toLowerCase();
  if (["none", "off", "disabled", "minimal"].includes(normalized)) {
    return { type: "disabled" as const };
  }
  const budget_tokens = normalized === "high" ? 4096 : normalized === "medium" ? 2048 : 1024;
  return {
    type: "enabled" as const,
    budget_tokens
  };
}

function normalizeLegacyAnthropicOutputConfig(body: {
  anthropic_output_config?: LegacyChatRequest["anthropic_output_config"];
}) {
  return normalizeAnthropicOutputConfig(body.anthropic_output_config);
}

export function mapLegacyChatToAnthropicMessages(
  body: LegacyChatRequest,
  defaultModel: string
): AnthropicMessagesRequest {
  const systemParts: string[] = [];
  const messages: AnthropicInputMessage[] = [];

  for (const message of body.messages ?? []) {
    if (message.role === "system") {
      const systemText = normalizeLegacyTextContent(message.content);
      if (systemText) {
        systemParts.push(systemText);
      }
      continue;
    }

    if (message.role === "tool") {
      if (!message.tool_call_id?.trim()) {
        continue;
      }
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id.trim(),
            content: normalizeLegacyTextContent(message.content)
          }
        ]
      });
      continue;
    }

    const blocks: AnthropicInputBlock[] = message.role === "assistant"
      ? [...normalizeLegacyAssistantContentBlocks(message.content)]
      : [];

    if (message.role !== "assistant") {
      const text = normalizeLegacyTextContent(message.content);
      if (text) {
        blocks.push({ type: "text", text });
      }
      blocks.push(...normalizeLegacyImageBlocks(message.content));
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!toolCall || typeof toolCall !== "object") {
          continue;
        }
        const rawId = "id" in toolCall ? (toolCall as { id?: unknown }).id : undefined;
        const nestedFunction = "function" in toolCall ? (toolCall as { function?: unknown }).function : undefined;
        const fn = nestedFunction && typeof nestedFunction === "object" ? nestedFunction : toolCall;
        const name = "name" in fn ? (fn as { name?: unknown }).name : undefined;
        const rawArguments = "arguments" in fn ? (fn as { arguments?: unknown }).arguments : undefined;
        if (typeof rawId !== "string" || !rawId.trim() || typeof name !== "string" || !name.trim()) {
          continue;
        }
        blocks.push({
          type: "tool_use",
          id: rawId.trim(),
          name: name.trim(),
          input: parseJsonLikeInput(stringifyUnknown(rawArguments))
        });
      }
    }

    if (!blocks.length) {
      continue;
    }

    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: blocks
    });
  }

  const thinking = normalizeLegacyThinkingForAnthropic(body);
  const outputConfig = normalizeLegacyAnthropicOutputConfig(body);

  return {
    model: body.model ?? defaultModel,
    messages,
    ...(systemParts.length ? { system: joinTextParts(systemParts) } : {}),
    temperature: body.temperature,
    max_tokens: body.max_tokens ?? 4096,
    top_p: body.top_p,
    stream: body.stream,
    ...(normalizeLegacyToolsForAnthropic(body.tools) ? { tools: normalizeLegacyToolsForAnthropic(body.tools) } : {}),
    ...(normalizeLegacyToolChoiceForAnthropic(body.tool_choice) ? { tool_choice: normalizeLegacyToolChoiceForAnthropic(body.tool_choice) } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    ...(thinking ? { thinking } : {})
  };
}

export function mapResponsesRequestToAnthropicMessages(
  body: ResponsesRequest,
  defaultModel: string
): AnthropicMessagesRequest {
  const legacy = mapResponsesRequestToLegacyChat(body, defaultModel);
  return mapLegacyChatToAnthropicMessages(
    {
      ...legacy,
      stream: body.stream
    },
    defaultModel
  );
}

export function extractAnthropicMessageText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }
  const content = Array.isArray((responseJson as { content?: unknown }).content)
    ? ((responseJson as { content?: AnthropicInputBlock[] }).content ?? [])
    : [];
  return content
    .map((block) => (block && typeof block === "object" && block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("");
}

export function extractAnthropicThinkingText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }
  const content = Array.isArray((responseJson as { content?: unknown }).content)
    ? ((responseJson as { content?: AnthropicInputBlock[] }).content ?? [])
    : [];
  return content
    .map((block) =>
      block && typeof block === "object" && block.type === "thinking" && typeof block.thinking === "string"
        ? block.thinking
        : ""
    )
    .filter(Boolean)
    .join("");
}

export function mapAnthropicToLegacyChat(
  responseJson: unknown,
  fallbackModel: string
) {
  const payload = responseJson && typeof responseJson === "object"
    ? (responseJson as Record<string, unknown>)
    : {};
  const text = extractAnthropicMessageText(payload);
  const reasoningText = extractAnthropicThinkingText(payload);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const toolCalls = content
    .map((block, index) => {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "tool_use") {
        return null;
      }
      const id = (block as { id?: unknown }).id;
      const name = (block as { name?: unknown }).name;
      const input = (block as { input?: unknown }).input;
      if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim()) {
        return null;
      }
      return {
        id: id.trim(),
        type: "function",
        function: {
          name: name.trim(),
          arguments: stringifyUnknown(input)
        },
        index
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map(({ index: _index, ...rest }) => rest);

  return {
    id:
      typeof payload.id === "string" && payload.id.trim()
        ? payload.id.trim().replace(/^msg_/, "chatcmpl_")
        : `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model:
      typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : fallbackModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          ...(reasoningText ? { reasoning_content: reasoningText } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: toSafeInt((payload.usage as { input_tokens?: unknown } | undefined)?.input_tokens),
      completion_tokens: toSafeInt((payload.usage as { output_tokens?: unknown } | undefined)?.output_tokens),
      total_tokens:
        toSafeInt((payload.usage as { input_tokens?: unknown } | undefined)?.input_tokens) +
        toSafeInt((payload.usage as { output_tokens?: unknown } | undefined)?.output_tokens)
    }
  };
}

export function mapAnthropicToResponses(
  responseJson: unknown,
  fallbackModel: string
) {
  const payload = responseJson && typeof responseJson === "object"
    ? (responseJson as Record<string, unknown>)
    : {};
  const text = extractAnthropicMessageText(payload);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const output = [];
  if (text) {
    output.push({
      id: typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }]
    });
  }
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "tool_use") {
      continue;
    }
    const id = (block as { id?: unknown }).id;
    const name = (block as { name?: unknown }).name;
    const input = (block as { input?: unknown }).input;
    if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim()) {
      continue;
    }
    output.push({
      type: "function_call",
      call_id: id.trim(),
      name: name.trim(),
      arguments: stringifyUnknown(input)
    });
  }
  if (!output.length) {
    output.push({
      id: typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "" }]
    });
  }
  return {
    id: `resp_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model:
      typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : fallbackModel,
    output,
    output_text: text,
    usage: {
      input_tokens: toSafeInt((payload.usage as { input_tokens?: unknown } | undefined)?.input_tokens),
      output_tokens: toSafeInt((payload.usage as { output_tokens?: unknown } | undefined)?.output_tokens),
      total_tokens:
        toSafeInt((payload.usage as { input_tokens?: unknown } | undefined)?.input_tokens) +
        toSafeInt((payload.usage as { output_tokens?: unknown } | undefined)?.output_tokens),
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 }
    }
  };
}

export function extractAnthropicAssistantMessage(responseJson: unknown): LegacyChatMessage | null {
  const mapped = mapAnthropicToLegacyChat(responseJson, "");
  const message = mapped.choices?.[0]?.message;
  if (!message) {
    return null;
  }
  return {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : "",
    ...(Array.isArray(message.tool_calls) && message.tool_calls.length ? { tool_calls: message.tool_calls } : {})
  };
}
