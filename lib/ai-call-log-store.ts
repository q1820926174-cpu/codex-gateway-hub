import { mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";

export type AiCallType = "main" | "vision_fallback";

export type AiCallLogImage = {
  sourceType: "data_url" | "remote_url" | "unsupported";
  source: string;
  savedUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  error?: string;
};

export type AiCallLogEntry = {
  id: string;
  keyId: number;
  keyName: string;
  route: string;
  requestWireApi: string;
  upstreamWireApi: string;
  requestedModel: string;
  clientModel: string;
  upstreamModel: string;
  callType: AiCallType;
  stream: boolean;
  systemPrompt: string;
  userPrompt: string;
  assistantResponse: string;
  images?: AiCallLogImage[];
  createdAt: string;
};

type ReadAiCallLogQuery = {
  limit: number;
  keyId?: number | null;
  model?: string | null;
  callType?: AiCallType | null;
};

type ReadAiCallLogStats = {
  matched: number;
  main: number;
  visionFallback: number;
  visionByModel: Array<{ model: string; count: number }>;
  visionByKey: Array<{ keyId: number; keyName: string; count: number }>;
};

function resolveLogFilePath() {
  const custom = process.env.AI_CALL_LOG_FILE?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  }
  return path.resolve(process.cwd(), "logs", "ai-call.ndjson");
}

const AI_CALL_LOG_FILE_PATH = resolveLogFilePath();

let ensureDirPromise: Promise<void> | null = null;
let appendQueue: Promise<void> = Promise.resolve();

function logFilePath() {
  return AI_CALL_LOG_FILE_PATH;
}

function imageLogDirPath() {
  return path.resolve(process.cwd(), "public", "ai-call-images");
}

async function ensureLogFileDir() {
  if (!ensureDirPromise) {
    ensureDirPromise = mkdir(path.dirname(logFilePath()), { recursive: true })
      .then(() => undefined)
      .catch((error) => {
        ensureDirPromise = null;
        throw error;
      });
  }
  await ensureDirPromise;
}

function enqueueAppend(task: () => Promise<void>) {
  appendQueue = appendQueue.then(task, task);
  return appendQueue;
}

async function waitForPendingAppends() {
  await appendQueue.catch(() => {});
}

function trimForFilter(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : "";
}

function normalizeCallType(value: unknown): AiCallType {
  return value === "vision_fallback" ? "vision_fallback" : "main";
}

export async function appendAiCallLogEntry(entry: AiCallLogEntry) {
  try {
    await enqueueAppend(async () => {
      await ensureLogFileDir();
      await writeFile(logFilePath(), `${JSON.stringify(entry)}\n`, {
        encoding: "utf8",
        flag: "a"
      });
    });
  } catch {
    // ignore logging side effect failures
  }
}

export async function readAiCallLogEntries(query: ReadAiCallLogQuery) {
  try {
    await waitForPendingAppends();
    const raw = await readFile(logFilePath(), "utf8");
    if (!raw.trim()) {
      return {
        items: [],
        models: [],
        stats: {
          matched: 0,
          main: 0,
          visionFallback: 0,
          visionByModel: [],
          visionByKey: []
        } satisfies ReadAiCallLogStats
      };
    }

    const lines = raw.split("\n").filter(Boolean);
    const items: AiCallLogEntry[] = [];
    const modelSet = new Set<string>();
    const keyId = query.keyId && query.keyId > 0 ? query.keyId : null;
    const modelFilter = trimForFilter(query.model);
    const callTypeFilter = query.callType ?? null;
    const visionByModelCount = new Map<string, number>();
    const visionByKeyCount = new Map<string, { keyId: number; keyName: string; count: number }>();
    let matched = 0;
    let main = 0;
    let visionFallback = 0;

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let parsedRaw: AiCallLogEntry;
      try {
        parsedRaw = JSON.parse(lines[i]) as AiCallLogEntry;
      } catch {
        continue;
      }

      const parsed: AiCallLogEntry = {
        ...parsedRaw,
        callType: normalizeCallType(parsedRaw.callType)
      };

      if (parsed.upstreamModel?.trim()) {
        modelSet.add(parsed.upstreamModel.trim());
      }
      if (keyId !== null && parsed.keyId !== keyId) {
        continue;
      }
      if (modelFilter && trimForFilter(parsed.upstreamModel) !== modelFilter) {
        continue;
      }
      if (callTypeFilter && parsed.callType !== callTypeFilter) {
        continue;
      }

      matched += 1;
      if (parsed.callType === "vision_fallback") {
        visionFallback += 1;
        const visionModel = parsed.upstreamModel?.trim() || "-";
        visionByModelCount.set(visionModel, (visionByModelCount.get(visionModel) ?? 0) + 1);
        const key = `${parsed.keyId}:${parsed.keyName}`;
        const prev = visionByKeyCount.get(key);
        if (prev) {
          prev.count += 1;
        } else {
          visionByKeyCount.set(key, {
            keyId: parsed.keyId,
            keyName: parsed.keyName,
            count: 1
          });
        }
      } else {
        main += 1;
      }

      if (items.length < query.limit) {
        items.push(parsed);
      }
    }

    const visionByModel = Array.from(visionByModelCount.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => (b.count - a.count) || a.model.localeCompare(b.model));
    const visionByKey = Array.from(visionByKeyCount.values())
      .sort((a, b) => (b.count - a.count) || a.keyName.localeCompare(b.keyName));

    return {
      items,
      models: Array.from(modelSet).sort((a, b) => a.localeCompare(b)),
      stats: {
        matched,
        main,
        visionFallback,
        visionByModel,
        visionByKey
      } satisfies ReadAiCallLogStats
    };
  } catch {
    return {
      items: [],
      models: [],
      stats: {
        matched: 0,
        main: 0,
        visionFallback: 0,
        visionByModel: [],
        visionByKey: []
      } satisfies ReadAiCallLogStats
    };
  }
}

export async function clearAiCallLogEntries() {
  try {
    await waitForPendingAppends();
    await ensureLogFileDir();
    await truncate(logFilePath(), 0);
    await rm(imageLogDirPath(), { recursive: true, force: true });
  } catch {
    await writeFile(logFilePath(), "", "utf8").catch(() => {});
    await rm(imageLogDirPath(), { recursive: true, force: true }).catch(() => {});
  }
}
