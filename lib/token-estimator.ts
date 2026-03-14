import { encodingForModel, getEncoding } from "js-tiktoken";
import type { LegacyChatRequest, LegacyCompletionRequest, ResponsesRequest } from "@/lib/mapper";

// Fallback encoding for models we don't recognize
// 无法识别的模型的回退编码
let fallbackEncoding: ReturnType<typeof getEncoding> | null = null;

// Normalize model name for tokenizer compatibility
// 标准化模型名称以兼容分词器
function normalizeModelForTokenizer(model: string) {
  // Map gpt-4.1 models to gpt-4o for encoding
  // 将 gpt-4.1 模型映射到 gpt-4o 进行编码
  if (model.startsWith("gpt-4.1")) {
    return "gpt-4o";
  }
  return model;
}

// Count tokens in a text string using model-specific encoding
// 使用模型特定的编码计算文本字符串中的 token 数
function countTextTokens(text: string, model: string) {
  try {
    const enc = encodingForModel(
      normalizeModelForTokenizer(model) as Parameters<typeof encodingForModel>[0]
    );
    return enc.encode(text).length;
  } catch {
    // Fall back to cl100k_base encoding for unknown models
    // 未知模型回退到 cl100k_base 编码
    fallbackEncoding ??= getEncoding("cl100k_base");
    return fallbackEncoding.encode(text).length;
  }
}

// Estimate tokens for plain text
// 估计纯文本的 token 数
export function estimatePlainTextTokens(text: string, model: string) {
  return countTextTokens(text, model);
}

// Estimate token count for text content parts (strings or arrays with images/videos)
// 估计文本内容部分的 token 数（字符串或包含图像/视频的数组）
function estimateTextPartsTokenCount(
  content: unknown,
  model: string
): number {
  // If content is a string, just count tokens
  // 如果内容是字符串，直接计算 token 数
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
    // Estimate fixed token cost for images
    // 估计图像的固定 token 成本
    if (type === "image_url" || type === "input_image") {
      total += 512;
      continue;
    }
    // Estimate fixed token cost for videos
    // 估计视频的固定 token 成本
    if (type === "video_url" || type === "input_video") {
      total += 1024;
      continue;
    }

    // Handle text parts in multimodal content
    // 处理多模态内容中的文本部分
    const text = "text" in part ? (part as { text?: unknown }).text : undefined;
    if (typeof text === "string") {
      total += countTextTokens(text, model);
    }
  }

  return total;
}

// Estimate tokens for legacy chat completion requests
// 估计传统聊天完成请求的 token 数
export function estimateLegacyChatTokens(body: LegacyChatRequest, model: string) {
  const messages = body.messages ?? [];
  let total = 0;
  for (const msg of messages) {
    // Add base message overhead
    // 添加基础消息开销
    total += 4;
    total += countTextTokens(msg.role ?? "", model);
    total += estimateTextPartsTokenCount(msg.content, model);
  }
  // Add final completion overhead
  // 添加最终完成开销
  return total + 3;
}

// Estimate tokens for legacy completion requests
// 估计传统完成请求的 token 数
export function estimateLegacyCompletionTokens(body: LegacyCompletionRequest, model: string) {
  const prompt = body.prompt ?? "";
  const text = Array.isArray(prompt) ? prompt.join("\n") : prompt;
  return countTextTokens(text, model) + 8;
}

// Estimate tokens for Responses API requests
// 估计 Responses API 请求的 token 数
export function estimateResponsesRequestTokens(body: ResponsesRequest, model: string) {
  let total = 0;
  // Count tokens in system instructions
  // 计算系统指令中的 token 数
  if (typeof body.instructions === "string") {
    total += countTextTokens(body.instructions, model);
  }

  const input = body.input;
  // Handle string input
  // 处理字符串输入
  if (typeof input === "string") {
    total += countTextTokens(input, model);
  // Handle array of messages input
  // 处理消息数组输入
  } else if (Array.isArray(input)) {
    for (const message of input) {
      if (!message || typeof message !== "object") {
        continue;
      }
      // Add base message overhead
      // 添加基础消息开销
      total += 4;
      const content = "content" in message ? (message as { content?: unknown }).content : undefined;
      total += estimateTextPartsTokenCount(content, model);
    }
  }

  // Add final overhead
  // 添加最终开销
  return total + 3;
}
