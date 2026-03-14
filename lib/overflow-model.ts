// Type for overflow model selection configuration
// 溢出模型选择配置的类型
export type OverflowModelSelection = {
  // Raw input value
  // 原始输入值
  raw: string;
  // Model name to use for overflow
  // 用于溢出的模型名称
  model: string;
  // Optional upstream channel ID
  // 可选的上游渠道 ID
  upstreamChannelId: number | null;
};

// Normalize channel ID to positive integer or null
// 将渠道 ID 标准化为正整数或 null
function normalizePositiveChannelId(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

// Parse overflow model selection from string (JSON or plain string)
// 从字符串解析溢出模型选择（JSON 或纯字符串）
export function parseOverflowModelSelection(
  value: string | null | undefined
): OverflowModelSelection | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  try {
    // Try JSON format first
    // 首先尝试 JSON 格式
    const parsed = JSON.parse(raw) as {
      model?: unknown;
      upstreamChannelId?: unknown;
    };
    const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
    if (model) {
      return {
        raw,
        model,
        upstreamChannelId: normalizePositiveChannelId(parsed.upstreamChannelId)
      };
    }
  } catch {
    // Fall back to legacy plain-string format
    // 回退到传统的纯字符串格式
  }

  // Legacy format: just the model name as plain string
  // 传统格式：仅模型名称作为纯字符串
  return {
    raw,
    model: raw,
    upstreamChannelId: null
  };
}

// Serialize overflow model selection to string
// 将溢出模型选择序列化为字符串
export function serializeOverflowModelSelection(
  model: string,
  upstreamChannelId?: number | null
) {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    return "";
  }

  const normalizedChannelId = normalizePositiveChannelId(upstreamChannelId);
  // Use plain string format if no channel ID
  // 如果没有渠道 ID，使用纯字符串格式
  if (!normalizedChannelId) {
    return normalizedModel;
  }

  // Use JSON format when channel ID is provided
  // 当提供渠道 ID 时使用 JSON 格式
  return JSON.stringify({
    model: normalizedModel,
    upstreamChannelId: normalizedChannelId
  });
}
