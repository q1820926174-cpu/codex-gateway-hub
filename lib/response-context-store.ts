import type { LegacyChatMessage } from "@/lib/mapper";

type ContextRecord = {
  responseId: string;
  messages: LegacyChatMessage[];
  updatedAt: number;
};

const MAX_CONTEXT_RECORDS = 2000;
const contextStore = new Map<string, ContextRecord>();

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

export function readResponseContext(responseId: string | null | undefined): LegacyChatMessage[] {
  if (!responseId || typeof responseId !== "string") {
    return [];
  }
  const key = responseId.trim();
  if (!key) {
    return [];
  }

  const record = contextStore.get(key);
  if (!record) {
    return [];
  }
  return cloneMessages(record.messages);
}

export function writeResponseContext(responseId: string, messages: LegacyChatMessage[]) {
  const key = responseId.trim();
  if (!key) {
    return;
  }

  contextStore.set(key, {
    responseId: key,
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
