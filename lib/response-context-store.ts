import type { LegacyChatMessage } from "@/lib/mapper";

type ContextRecord = {
  messages: LegacyChatMessage[];
  updatedAt: number;
};

const MAX_CONTEXT_RECORDS = 2000;
const contextStore = new Map<string, ContextRecord>();

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

function cloneMessages(messages: LegacyChatMessage[]): LegacyChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content == null
          ? message.content
          : JSON.parse(JSON.stringify(message.content)),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls
      ? { tool_calls: JSON.parse(JSON.stringify(message.tool_calls)) }
      : {})
  }));
}

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
  return cloneMessages(record.messages);
}

export function writeResponseContext(
  scope: string,
  responseId: string,
  messages: LegacyChatMessage[]
) {
  const key = buildScopedContextKey(scope, responseId);
  if (!key) {
    return;
  }

  contextStore.set(key, {
    messages: cloneMessages(messages),
    updatedAt: Date.now()
  });

  if (contextStore.size <= MAX_CONTEXT_RECORDS) {
    return;
  }

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
