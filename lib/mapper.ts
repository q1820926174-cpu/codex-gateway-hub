type LegacyRole = "system" | "user" | "assistant" | "tool";

export type LegacyChatMessage = {
  role: LegacyRole;
  content: unknown;
  reasoning_content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
};

export type LegacyChatRequest = {
  model?: string;
  messages?: LegacyChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  thinking?: {
    type?: string;
    clear_thinking?: boolean;
    [key: string]: unknown;
  };
  reasoning_effort?: string;
  verbosity?: string;
  reasoning?: {
    effort?: string;
    summary?: string;
    [key: string]: unknown;
  };
  anthropic_output_config?: {
    effort?: string;
    [key: string]: unknown;
  };
  text?: {
    verbosity?: string;
    [key: string]: unknown;
  };
  tools?: unknown;
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  stream?: boolean;
};

export type LegacyCompletionRequest = {
  model?: string;
  prompt?: string | string[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning_effort?: string;
  verbosity?: string;
  stream?: boolean;
};

export type ResponsesRequest = {
  model?: string;
  input?: unknown;
  previous_response_id?: string;
  instructions?: string;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  reasoning_effort?: string;
  verbosity?: string;
  reasoning?: {
    effort?: string;
    summary?: string;
    [key: string]: unknown;
  };
  text?: {
    verbosity?: string;
    [key: string]: unknown;
  };
  tools?: unknown;
  tool_choice?: unknown;
  parallel_tool_calls?: boolean;
  stream?: boolean;
};

type LegacyImagePart = {
  type: "image_url" | "input_image";
  image_url?: {
    url?: string;
    detail?: string;
  } | string;
  detail?: string;
};

type LegacyVideoPart = {
  type: "video_url" | "input_video";
  video_url?: {
    url?: string;
    detail?: string;
  } | string;
  url?: string;
  detail?: string;
};

type ResponsesInputContent =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail?: string;
    }
  | {
      type: "input_video";
      video_url: string;
      detail?: string;
    };

type ResponsesInputMessage = {
  role: "user" | "assistant";
  content: ResponsesInputContent[];
};

type LegacyChatCompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail?: string } }
        | { type: "video_url"; video_url: { url: string; detail?: string } }
      >;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
};

type ParsedPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      imageUrl: string;
      detail?: string;
    }
  | {
      type: "video";
      videoUrl: string;
      detail?: string;
    };

function parseLegacyContent(content: unknown): ParsedPart[] {
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ type: "text", text }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts: ParsedPart[] = [];
  for (const item of content) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) {
        parts.push({ type: "text", text });
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
        parts.push({ type: "text", text: text.trim() });
      }
      continue;
    }

    const maybeText = "text" in item ? (item as { text?: unknown }).text : undefined;
    if (typeof maybeText === "string" && maybeText.trim()) {
      parts.push({ type: "text", text: maybeText.trim() });
      continue;
    }

    if (rawType === "image_url" || rawType === "input_image") {
      const imagePart = item as LegacyImagePart;
      let imageUrl: string | undefined;
      let detail: string | undefined;

      if (typeof imagePart.image_url === "string") {
        imageUrl = imagePart.image_url;
      } else if (imagePart.image_url && typeof imagePart.image_url === "object") {
        imageUrl = imagePart.image_url.url;
        detail = imagePart.image_url.detail;
      }

      if (!detail && typeof imagePart.detail === "string") {
        detail = imagePart.detail;
      }

      if (typeof imageUrl === "string" && imageUrl.trim()) {
        parts.push({
          type: "image",
          imageUrl: imageUrl.trim(),
          detail: typeof detail === "string" && detail.trim() ? detail.trim() : undefined
        });
      }
      continue;
    }

    if (rawType === "video_url" || rawType === "input_video") {
      const videoPart = item as LegacyVideoPart;
      let videoUrl: string | undefined;
      let detail: string | undefined;

      if (typeof videoPart.video_url === "string") {
        videoUrl = videoPart.video_url;
      } else if (videoPart.video_url && typeof videoPart.video_url === "object") {
        videoUrl = videoPart.video_url.url;
        detail = videoPart.video_url.detail;
      }

      if (!videoUrl && typeof videoPart.url === "string") {
        videoUrl = videoPart.url;
      }

      if (!detail && typeof videoPart.detail === "string") {
        detail = videoPart.detail;
      }

      if (typeof videoUrl === "string" && videoUrl.trim()) {
        parts.push({
          type: "video",
          videoUrl: videoUrl.trim(),
          detail: typeof detail === "string" && detail.trim() ? detail.trim() : undefined
        });
      }
    }
  }

  return parts;
}

function buildInputFromMessages(messages: LegacyChatMessage[], allowVisionInput: boolean) {
  const systemMessages: string[] = [];
  const input: ResponsesInputMessage[] = [];

  for (const msg of messages) {
    const parts = parseLegacyContent(msg.content);
    if (!parts.length) {
      continue;
    }

    if (msg.role === "system") {
      const text = parts
        .filter((part): part is Extract<ParsedPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n\n")
        .trim();
      if (text) {
        systemMessages.push(text);
      }
      continue;
    }

    const mappedContent: ResponsesInputContent[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        mappedContent.push({
          type: "input_text",
          text: part.text
        });
        continue;
      }

      if (allowVisionInput) {
        if (part.type === "image") {
          mappedContent.push({
            type: "input_image",
            image_url: part.imageUrl,
            detail: part.detail
          });
        } else {
          mappedContent.push({
            type: "input_video",
            video_url: part.videoUrl,
            detail: part.detail
          });
        }
      }
    }

    if (!mappedContent.length) {
      continue;
    }

    const role = msg.role === "assistant" || msg.role === "user" ? msg.role : "user";
    input.push({
      role,
      content: mappedContent
    });
  }

  return {
    instructions: systemMessages.length ? systemMessages.join("\n\n") : undefined,
    input
  };
}

export function mapLegacyChatToResponses(
  body: LegacyChatRequest,
  defaultModel: string,
  options?: {
    allowVisionInput?: boolean;
  }
) {
  const messages = body.messages ?? [];
  const mapped = buildInputFromMessages(messages, options?.allowVisionInput !== false);
  const reasoning =
    body.reasoning && typeof body.reasoning === "object"
      ? body.reasoning
      : typeof body.reasoning_effort === "string" && body.reasoning_effort.trim()
        ? { effort: body.reasoning_effort.trim() }
        : undefined;
  const textConfig =
    body.text && typeof body.text === "object"
      ? body.text
      : typeof body.verbosity === "string" && body.verbosity.trim()
        ? { verbosity: body.verbosity.trim() }
        : undefined;

  return {
    model: body.model ?? defaultModel,
    input: mapped.input,
    instructions: mapped.instructions,
    temperature: body.temperature,
    max_output_tokens: body.max_tokens,
    top_p: body.top_p,
    ...(reasoning ? { reasoning } : {}),
    ...(textConfig ? { text: textConfig } : {})
  };
}

export function mapLegacyCompletionToResponses(body: LegacyCompletionRequest, defaultModel: string) {
  const prompt = body.prompt ?? "";
  const promptText = Array.isArray(prompt) ? prompt.join("\n") : prompt;

  return {
    model: body.model ?? defaultModel,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: promptText }]
      }
    ],
    temperature: body.temperature,
    max_output_tokens: body.max_tokens,
    top_p: body.top_p,
    ...(typeof body.reasoning_effort === "string" && body.reasoning_effort.trim()
      ? { reasoning: { effort: body.reasoning_effort.trim() } }
      : {}),
    ...(typeof body.verbosity === "string" && body.verbosity.trim()
      ? { text: { verbosity: body.verbosity.trim() } }
      : {})
  };
}

function stringifyResponsesToolOutput(output: unknown): string {
  return typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
}

function stringifyResponsesCustomToolArguments(input: unknown): string {
  return JSON.stringify({
    input:
      typeof input === "string" ? input : input == null ? "" : JSON.stringify(input)
  });
}

function extractResponsesCustomToolInput(input: unknown, allowFallback = true): string | null {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && "input" in parsed) {
        const nestedInput = (parsed as { input?: unknown }).input;
        return typeof nestedInput === "string"
          ? nestedInput
          : nestedInput == null
            ? ""
            : JSON.stringify(nestedInput);
      }
    } catch {
      if (!allowFallback) {
        return null;
      }
    }
    return input;
  }
  if (input && typeof input === "object" && "input" in input) {
    const nestedInput = (input as { input?: unknown }).input;
    return typeof nestedInput === "string"
      ? nestedInput
      : nestedInput == null
        ? ""
        : JSON.stringify(nestedInput);
  }
  if (!allowFallback) {
    return null;
  }
  return input == null ? "" : JSON.stringify(input);
}

function buildResponsesCustomToolDescription(
  description: string | undefined,
  format: unknown
): string | undefined {
  const parts: string[] = [];
  if (typeof description === "string" && description.trim()) {
    parts.push(description.trim());
  }
  if (format && typeof format === "object") {
    const type = "type" in format ? (format as { type?: unknown }).type : undefined;
    const syntax = "syntax" in format ? (format as { syntax?: unknown }).syntax : undefined;
    const definition = "definition" in format ? (format as { definition?: unknown }).definition : undefined;
    if (type === "grammar" && typeof definition === "string" && definition.trim()) {
      parts.push(
        `Return a JSON object with field "input" containing the raw tool payload that matches the${typeof syntax === "string" && syntax.trim() ? ` ${syntax.trim()}` : ""} grammar:\n${definition.trim()}`
      );
    } else if (typeof type === "string" && type.trim()) {
      parts.push(`Return a JSON object with field "input" containing the raw ${type.trim()} tool payload.`);
    }
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

function normalizeResponsesInputToLegacyMessages(input: unknown): LegacyChatCompletionMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  const entries = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? [input]
      : [];
  if (!entries.length) {
    return [];
  }

  const messages: LegacyChatCompletionMessage[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) {
        messages.push({ role: "user", content: text });
      }
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const explicitType = "type" in entry ? (entry as { type?: unknown }).type : undefined;
    if (explicitType === "function_call_output" || explicitType === "custom_tool_call_output") {
      const callId = "call_id" in entry ? (entry as { call_id?: unknown }).call_id : undefined;
      if (typeof callId !== "string" || !callId.trim()) {
        continue;
      }
      const output = "output" in entry ? (entry as { output?: unknown }).output : "";
      messages.push({
        role: "tool",
        tool_call_id: callId.trim(),
        content: stringifyResponsesToolOutput(output)
      });
      continue;
    }
    if (explicitType === "function_call" || explicitType === "custom_tool_call") {
      const rawCallId = "call_id" in entry ? (entry as { call_id?: unknown }).call_id : undefined;
      const callId =
        typeof rawCallId === "string" && rawCallId.trim()
          ? rawCallId.trim()
          : `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const rawName = "name" in entry ? (entry as { name?: unknown }).name : undefined;
      const name =
        typeof rawName === "string" && rawName.trim() ? rawName.trim() : "unknown_tool";
      const rawArguments =
        explicitType === "custom_tool_call"
          ? "input" in entry
            ? (entry as { input?: unknown }).input
            : ("arguments" in entry ? (entry as { arguments?: unknown }).arguments : "")
          : "arguments" in entry
            ? (entry as { arguments?: unknown }).arguments
            : ("input" in entry ? (entry as { input?: unknown }).input : "");
      const argumentsText =
        explicitType === "custom_tool_call"
          ? stringifyResponsesCustomToolArguments(rawArguments)
          : typeof rawArguments === "string"
            ? rawArguments
            : rawArguments == null
              ? ""
              : JSON.stringify(rawArguments);
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name,
              arguments: argumentsText
            }
          }
        ]
      });
      continue;
    }

    const roleValue = "role" in entry ? (entry as { role?: unknown }).role : "user";
    const role =
      roleValue === "assistant"
        ? "assistant"
        : roleValue === "tool"
          ? "tool"
          : roleValue === "developer"
            ? "system"
          : roleValue === "system"
            ? "system"
            : "user";
    const content = "content" in entry ? (entry as { content?: unknown }).content : "";
    const toolCallId =
      "tool_call_id" in entry ? (entry as { tool_call_id?: unknown }).tool_call_id : undefined;
    const toolCallsValue =
      "tool_calls" in entry ? (entry as { tool_calls?: unknown }).tool_calls : undefined;
    const nameValue = "name" in entry ? (entry as { name?: unknown }).name : undefined;
    const name = typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : undefined;

    if (typeof content === "string") {
      messages.push({
        role,
        content,
        ...(typeof toolCallId === "string" && toolCallId.trim()
          ? { tool_call_id: toolCallId.trim() }
          : {}),
        ...(name ? { name } : {}),
        ...(toolCallsValue ? { tool_calls: toolCallsValue } : {})
      });
      continue;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    const legacyParts: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
      | { type: "video_url"; video_url: { url: string; detail?: string } }
    > = [];

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const type = "type" in part ? (part as { type?: unknown }).type : undefined;
      if (type === "input_text" || type === "text" || type === "output_text") {
        const text = "text" in part ? (part as { text?: unknown }).text : undefined;
        if (typeof text === "string" && text.trim()) {
          legacyParts.push({ type: "text", text: text.trim() });
        }
        continue;
      }
      if (type === "input_image" || type === "image_url") {
        const imageValue = "image_url" in part ? (part as { image_url?: unknown }).image_url : undefined;
        const detailValue = "detail" in part ? (part as { detail?: unknown }).detail : undefined;
        const imageUrl =
          typeof imageValue === "string"
            ? imageValue.trim()
            : imageValue && typeof imageValue === "object" && typeof (imageValue as { url?: unknown }).url === "string"
              ? (imageValue as { url: string }).url.trim()
              : "";
        const detail =
          typeof detailValue === "string"
            ? detailValue
            : imageValue && typeof imageValue === "object" && typeof (imageValue as { detail?: unknown }).detail === "string"
              ? ((imageValue as { detail: string }).detail)
              : undefined;
        if (imageUrl) {
          legacyParts.push({
            type: "image_url",
            image_url: {
              url: imageUrl,
              detail: typeof detail === "string" ? detail : undefined
            }
          });
        }
        continue;
      }
      if (type === "input_video" || type === "video_url") {
        const videoValue = "video_url" in part ? (part as { video_url?: unknown }).video_url : undefined;
        const detailValue = "detail" in part ? (part as { detail?: unknown }).detail : undefined;
        const videoUrl =
          typeof videoValue === "string"
            ? videoValue.trim()
            : videoValue && typeof videoValue === "object" && typeof (videoValue as { url?: unknown }).url === "string"
              ? (videoValue as { url: string }).url.trim()
              : "";
        const detail =
          typeof detailValue === "string"
            ? detailValue
            : videoValue && typeof videoValue === "object" && typeof (videoValue as { detail?: unknown }).detail === "string"
              ? ((videoValue as { detail: string }).detail)
              : undefined;
        if (videoUrl) {
          legacyParts.push({
            type: "video_url",
            video_url: {
              url: videoUrl,
              detail: typeof detail === "string" ? detail : undefined
            }
          });
        }
      }
    }

    if (legacyParts.length) {
      messages.push({
        role,
        content: legacyParts,
        ...(typeof toolCallId === "string" && toolCallId.trim()
          ? { tool_call_id: toolCallId.trim() }
          : {}),
        ...(name ? { name } : {}),
        ...(toolCallsValue ? { tool_calls: toolCallsValue } : {})
      });
    }
  }

  return messages;
}

function normalizeResponsesToolsForLegacyChat(tools: unknown): unknown[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  const converted = tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") {
        return null;
      }
      const type = "type" in tool ? (tool as { type?: unknown }).type : undefined;
      const nestedFunction =
        "function" in tool ? (tool as { function?: unknown }).function : undefined;
      if (type === "function" && nestedFunction && typeof nestedFunction === "object") {
        return {
          type: "function",
          function: nestedFunction
        };
      }

      const name = "name" in tool ? (tool as { name?: unknown }).name : undefined;
      if (typeof name !== "string" || !name.trim()) {
        return null;
      }
      const description =
        "description" in tool ? (tool as { description?: unknown }).description : undefined;
      const parameters =
        "parameters" in tool ? (tool as { parameters?: unknown }).parameters : undefined;
      if (type === "custom") {
        const format = "format" in tool ? (tool as { format?: unknown }).format : undefined;
        return {
          type: "function",
          function: {
            name: name.trim(),
            ...(buildResponsesCustomToolDescription(
              typeof description === "string" ? description : undefined,
              format
            )
              ? {
                  description: buildResponsesCustomToolDescription(
                    typeof description === "string" ? description : undefined,
                    format
                  )
                }
              : {}),
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string"
                }
              },
              required: ["input"],
              additionalProperties: false
            }
          }
        };
      }
      if (type !== "function") {
        return null;
      }

      return {
        type: "function",
        function: {
          name: name.trim(),
          ...(typeof description === "string" && description.trim()
            ? { description: description.trim() }
            : {}),
          ...(parameters && typeof parameters === "object" ? { parameters } : {})
        }
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return converted.length ? converted : undefined;
}

function normalizeResponsesToolChoiceForLegacyChat(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") {
    return toolChoice;
  }

  const type = "type" in toolChoice ? (toolChoice as { type?: unknown }).type : undefined;
  if (type !== "function" && type !== "custom") {
    return toolChoice;
  }

  const nestedFunction =
    "function" in toolChoice ? (toolChoice as { function?: unknown }).function : undefined;
  if (type === "function" && nestedFunction && typeof nestedFunction === "object") {
    return {
      type: "function",
      function: nestedFunction
    };
  }

  const name = "name" in toolChoice ? (toolChoice as { name?: unknown }).name : undefined;
  if (typeof name !== "string" || !name.trim()) {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: name.trim()
    }
  };
}

export function mapResponsesRequestToLegacyChat(
  body: ResponsesRequest,
  defaultModel: string
) {
  const messages: LegacyChatCompletionMessage[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({
      role: "system",
      content: body.instructions.trim()
    });
  }

  messages.push(...normalizeResponsesInputToLegacyMessages(body.input));

  if (!messages.length) {
    messages.push({ role: "user", content: "" });
  }

  const tools = normalizeResponsesToolsForLegacyChat(body.tools);
  const toolChoice = normalizeResponsesToolChoiceForLegacyChat(body.tool_choice);
  const reasoningEffort =
    (body.reasoning && typeof body.reasoning === "object" && typeof body.reasoning.effort === "string"
      ? body.reasoning.effort.trim()
      : "") ||
    (typeof body.reasoning_effort === "string" ? body.reasoning_effort.trim() : "");
  const verbosity =
    (body.text && typeof body.text === "object" && typeof body.text.verbosity === "string"
      ? body.text.verbosity.trim()
      : "") ||
    (typeof body.verbosity === "string" ? body.verbosity.trim() : "");

  return {
    model: body.model ?? defaultModel,
    messages,
    temperature: body.temperature,
    max_tokens: body.max_output_tokens,
    top_p: body.top_p,
    ...(body.reasoning && typeof body.reasoning === "object" ? { reasoning: body.reasoning } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(verbosity ? { verbosity } : {}),
    ...(tools ? { tools } : {}),
    ...(typeof body.parallel_tool_calls === "boolean"
      ? { parallel_tool_calls: body.parallel_tool_calls }
      : {}),
    ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {})
  };
}

function getResponseText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const payload = responseJson as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const parts: string[] = [];
  for (const outputItem of payload.output ?? []) {
    for (const content of outputItem.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
}

export function extractResponseText(responseJson: unknown): string {
  return getResponseText(responseJson);
}

export type LegacyMediaInput = {
  kind: "image" | "video";
  messageIndex: number;
  mediaIndexInMessage: number;
  mediaUrl: string;
  detail?: string;
};

export function collectMediaInputs(messages: LegacyChatMessage[]) {
  const mediaInputs: LegacyMediaInput[] = [];
  messages.forEach((message, messageIndex) => {
    const parts = parseLegacyContent(message.content);
    let mediaIndexInMessage = 0;
    for (const part of parts) {
      if (part.type === "image") {
        mediaInputs.push({
          kind: "image",
          messageIndex,
          mediaIndexInMessage,
          mediaUrl: part.imageUrl,
          detail: part.detail
        });
        mediaIndexInMessage += 1;
        continue;
      }
      if (part.type === "video") {
        mediaInputs.push({
          kind: "video",
          messageIndex,
          mediaIndexInMessage,
          mediaUrl: part.videoUrl,
          detail: part.detail
        });
        mediaIndexInMessage += 1;
      }
    }
  });
  return mediaInputs;
}

export function replaceMediaWithCaptions(
  messages: LegacyChatMessage[],
  captions: string[]
): LegacyChatMessage[] {
  let captionCursor = 0;
  return messages.map((message) => {
    const parts = parseLegacyContent(message.content);
    if (!parts.length) {
      return message;
    }

    const textBlocks: string[] = [];
    for (const part of parts) {
      if (part.type === "text") {
        textBlocks.push(part.text);
        continue;
      }

      const caption =
        captions[captionCursor] ??
        (part.type === "video" ? "Video content provided." : "Image content provided.");
      captionCursor += 1;
      textBlocks.push(
        part.type === "video"
          ? `[Video description] ${caption}`
          : `[Image description] ${caption}`
      );
    }

    return {
      ...message,
      content: textBlocks.join("\n\n")
    };
  });
}

export function mapResponsesToLegacyChat(responseJson: unknown, model: string) {
  const content = getResponseText(responseJson);

  return {
    id: `chatcmpl_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: "stop"
      }
    ]
  };
}

export function mapResponsesToLegacyCompletion(responseJson: unknown, model: string) {
  const text = getResponseText(responseJson);

  return {
    id: `cmpl_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        text,
        index: 0,
        finish_reason: "stop"
      }
    ]
  };
}

export function extractLegacyChatCompletionText(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const payload = responseJson as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: unknown;
      };
      text?: unknown;
      delta?: {
        content?: unknown;
        reasoning_content?: unknown;
      };
    }>;
  };

  const choice = payload.choices?.[0];
  if (!choice) {
    return "";
  }

  if (typeof choice.text === "string") {
    return choice.text;
  }

  const messageContent = choice.message?.content;
  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
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
      .join("\n");
  }

  const reasoningContent = choice.message?.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.trim()) {
    return reasoningContent.trim();
  }

  if (Array.isArray(reasoningContent)) {
    const merged = reasoningContent
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
      .join("\n")
      .trim();
    if (merged) {
      return merged;
    }
  }

  const deltaReasoning = choice.delta?.reasoning_content;
  if (typeof deltaReasoning === "string" && deltaReasoning.trim()) {
    return deltaReasoning.trim();
  }

  return "";
}

export function extractLegacyChatCompletionReasoning(responseJson: unknown): string {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const payload = responseJson as {
    choices?: Array<{
      message?: {
        reasoning_content?: unknown;
      };
      delta?: {
        reasoning_content?: unknown;
      };
    }>;
  };

  const choice = payload.choices?.[0];
  if (!choice) {
    return "";
  }

  const reasoningContent = choice.message?.reasoning_content ?? choice.delta?.reasoning_content;
  if (typeof reasoningContent === "string") {
    return reasoningContent.trim();
  }
  if (!Array.isArray(reasoningContent)) {
    return "";
  }
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
    .join("\n")
    .trim();
}

export function mapLegacyChatCompletionToResponses(
  responseJson: unknown,
  fallbackModel: string,
  options?: {
    customToolNames?: Iterable<string>;
  }
) {
  const payload = responseJson as {
    id?: string;
    model?: string;
    created?: number;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          id?: unknown;
          call_id?: unknown;
          name?: unknown;
          arguments?: unknown;
          function?: {
            name?: unknown;
            arguments?: unknown;
          };
        }>;
      };
    }>;
  };
  const usagePromptRaw = Number(payload.usage?.prompt_tokens ?? 0);
  const usageCompletionRaw = Number(payload.usage?.completion_tokens ?? 0);
  const usageTotalRaw = Number(payload.usage?.total_tokens ?? 0);
  const promptTokens = Number.isFinite(usagePromptRaw)
    ? Math.max(0, Math.floor(usagePromptRaw))
    : 0;
  const completionTokens = Number.isFinite(usageCompletionRaw)
    ? Math.max(0, Math.floor(usageCompletionRaw))
    : 0;
  const totalTokens = Number.isFinite(usageTotalRaw)
    ? Math.max(0, Math.floor(usageTotalRaw))
    : promptTokens + completionTokens;
  const outputText = extractLegacyChatCompletionText(responseJson);
  const reasoningText = extractLegacyChatCompletionReasoning(responseJson);
  const customToolNames = new Set(
    Array.from(options?.customToolNames ?? [])
      .map((name) => (typeof name === "string" ? name.trim() : ""))
      .filter(Boolean)
  );
  const toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? [])
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const rawCallId = item.id ?? item.call_id;
      const callId =
        typeof rawCallId === "string" && rawCallId.trim()
          ? rawCallId.trim()
          : `call_${index + 1}`;
      const rawName =
        (item.function && typeof item.function === "object" ? item.function.name : undefined) ??
        item.name;
      const name =
        typeof rawName === "string" && rawName.trim() ? rawName.trim() : "unknown_tool";
      const rawArguments =
        (item.function && typeof item.function === "object"
          ? item.function.arguments
          : undefined) ?? item.arguments;
      const argumentsText =
        typeof rawArguments === "string"
          ? rawArguments
          : rawArguments == null
            ? ""
            : JSON.stringify(rawArguments);
      const customInput = customToolNames.has(name)
        ? extractResponsesCustomToolInput(rawArguments)
        : null;
      if (customInput !== null) {
        return {
          id: callId,
          type: "custom_tool_call" as const,
          call_id: callId,
          name,
          input: customInput,
          status: "completed" as const
        };
      }
      return {
        id: callId,
        type: "function_call" as const,
        call_id: callId,
        name,
        arguments: argumentsText,
        status: "completed" as const
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const outputItems: Array<unknown> = [];
  if (reasoningText) {
    outputItems.push({
      id: `rs_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "reasoning",
      status: "completed",
      content: [
        {
          type: "reasoning_text",
          text: reasoningText
        }
      ],
      summary: [
        {
          type: "summary_text",
          text: reasoningText
        }
      ]
    });
  }
  if (outputText) {
    outputItems.push({
      id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: outputText
        }
      ]
    });
  }
  if (toolCalls.length) {
    outputItems.push(...toolCalls);
  }
  if (!outputItems.length) {
    outputItems.push({
      id: `msg_${crypto.randomUUID().replace(/-/g, "")}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: ""
        }
      ]
    });
  }

  return {
    id: payload.id ?? `resp_${crypto.randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: payload.created ?? Math.floor(Date.now() / 1000),
    model: payload.model ?? fallbackModel,
    output: outputItems,
    output_text: outputText,
    ...(promptTokens > 0 || completionTokens > 0 || totalTokens > 0
      ? {
          usage: {
            input_tokens: promptTokens,
            output_tokens: completionTokens,
            total_tokens: Math.max(totalTokens, promptTokens + completionTokens),
            input_tokens_details: {
              cached_tokens: 0
            },
            output_tokens_details: {
              reasoning_tokens: 0
            }
          }
        }
      : {})
  };
}

export function isStreamingRequest(body: { stream?: boolean }): boolean {
  return body.stream === true;
}
