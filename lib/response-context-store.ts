import type { LegacyChatMessage } from "@/lib/mapper";

// Internal record type for storing response context
// 用于存储响应上下文的内部记录类型
type ContextRecord = {
  // Chat messages in the context
  // 上下文中的聊天消息
  messages: LegacyChatMessage[];
  // Timestamp when the record was last updated
  // 记录最后更新的时间戳
  updatedAt: number;
};

// Maximum number of context records to keep in memory
// 内存中保留的最大上下文记录数
const MAX_CONTEXT_RECORDS = 2000;
// In-memory store for response contexts
// 响应上下文的内存存储
const contextStore = new Map<string, ContextRecord>();

// Build a scoped context key from scope and response ID
// 从 scope 和 response ID 构建作用域上下文键
function buildScopedContextKey(scope: string, responseId: string | null | undefined) {
  if (typeof scope !== "string") {
    return null;
  }
  const normalizedScope = scope.trim();
  if (!normalizedScope) {
    return null;
  }
  if (!responseId || typeof responseId !== "string") {
    return null;
  }
  const normalizedResponseId = responseId.trim();
  if (!normalizedResponseId) {
    return null;
  }
  return `${normalizedScope}::${normalizedResponseId}`;
}

// Deep clone chat messages to prevent mutations
// 深度克隆聊天消息以防止变更
function cloneMessages(messages: LegacyChatMessage[]): LegacyChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content == null
          ? message.content
          : JSON.parse(JSON.stringify(message.content)),
    // Include reasoning_content if present
    // 如果存在则包含 reasoning_content
    ...(message.reasoning_content !== undefined
      ? {
          reasoning_content:
            typeof message.reasoning_content === "string"
              ? message.reasoning_content
              : message.reasoning_content == null
                ? message.reasoning_content
                : JSON.parse(JSON.stringify(message.reasoning_content))
        }
      : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls
      ? { tool_calls: JSON.parse(JSON.stringify(message.tool_calls)) }
      : {})
  }));
}

// Read response context from store
// 从存储中读取响应上下文
export function readResponseContext(
  scope: string,
  responseId: string | null | undefined
): LegacyChatMessage[] {
  const key = buildScopedContextKey(scope, responseId);
  if (!key) {
    return [];
  }

  const record = contextStore.get(key);
  if (!record) {
    return [];
  }
  // Return a clone to prevent external mutations
  // 返回克隆以防止外部变更
  return cloneMessages(record.messages);
}

// Write response context to store
// 将响应上下文写入存储
export function writeResponseContext(
  scope: string,
  responseId: string,
  messages: LegacyChatMessage[]
) {
  const key = buildScopedContextKey(scope, responseId);
  if (!key) {
    return;
  }

  // Store a clone of the messages
  // 存储消息的克隆
  contextStore.set(key, {
    messages: cloneMessages(messages),
    updatedAt: Date.now()
  });

  // If we're under the limit, don't cleanup
  // 如果在限制范围内，不进行清理
  if (contextStore.size <= MAX_CONTEXT_RECORDS) {
    return;
  }

  // Remove the oldest record when over the limit
  // 超过限制时删除最旧的记录
  let oldestKey: string | null = null;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [storedKey, record] of contextStore.entries()) {
    if (record.updatedAt < oldestTime) {
      oldestTime = record.updatedAt;
      oldestKey = storedKey;
    }
  }
  if (oldestKey) {
    contextStore.delete(oldestKey);
  }
}
