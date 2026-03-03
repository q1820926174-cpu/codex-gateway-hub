import { encodingForModel, getEncoding } from "js-tiktoken";
import type { LegacyChatRequest, LegacyCompletionRequest, ResponsesRequest } from "@/lib/mapper";

let fallbackEncoding: ReturnType<typeof getEncoding> | null = null;

function normalizeModelForTokenizer(model: string) {
  if (model.startsWith("gpt-4.1")) {
    return "gpt-4o";
  }
  return model;
}

function countTextTokens(text: string, model: string) {
  try {
    const enc = encodingForModel(
      normalizeModelForTokenizer(model) as Parameters<typeof encodingForModel>[0]
    );
    return enc.encode(text).length;
  } catch {
    fallbackEncoding ??= getEncoding("cl100k_base");
    return fallbackEncoding.encode(text).length;
  }
}

export function estimatePlainTextTokens(text: string, model: string) {
  return countTextTokens(text, model);
}

function estimateTextPartsTokenCount(
  content: unknown,
  model: string
): number {
  if (typeof content === "string") {
    return countTextTokens(content, model);
  }
  if (!Array.isArray(content)) {
    return 0;
  }

  let total = 0;
  for (const part of content) {
    if (typeof part === "string") {
      total += countTextTokens(part, model);
      continue;
    }
    if (!part || typeof part !== "object") {
      continue;
    }
    const type = "type" in part ? (part as { type?: unknown }).type : undefined;
    if (type === "image_url" || type === "input_image") {
      total += 512;
      continue;
    }

    const text = "text" in part ? (part as { text?: unknown }).text : undefined;
    if (typeof text === "string") {
      total += countTextTokens(text, model);
    }
  }

  return total;
}

export function estimateLegacyChatTokens(body: LegacyChatRequest, model: string) {
  const messages = body.messages ?? [];
  let total = 0;
  for (const msg of messages) {
    total += 4;
    total += countTextTokens(msg.role ?? "", model);
    total += estimateTextPartsTokenCount(msg.content, model);
  }
  return total + 3;
}

export function estimateLegacyCompletionTokens(body: LegacyCompletionRequest, model: string) {
  const prompt = body.prompt ?? "";
  const text = Array.isArray(prompt) ? prompt.join("\n") : prompt;
  return countTextTokens(text, model) + 8;
}

export function estimateResponsesRequestTokens(body: ResponsesRequest, model: string) {
  let total = 0;
  if (typeof body.instructions === "string") {
    total += countTextTokens(body.instructions, model);
  }

  const input = body.input;
  if (typeof input === "string") {
    total += countTextTokens(input, model);
  } else if (Array.isArray(input)) {
    for (const message of input) {
      if (!message || typeof message !== "object") {
        continue;
      }
      total += 4;
      const content = "content" in message ? (message as { content?: unknown }).content : undefined;
      total += estimateTextPartsTokenCount(content, model);
    }
  }

  return total + 3;
}
