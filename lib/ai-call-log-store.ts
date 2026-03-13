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
  conversationTranscript?: string;
  assistantResponse: string;
  images?: AiCallLogImage[];
  createdAt: string;
};

type ReadAiCallLogQuery = {
  limit: number;
  keyId?: number | null;
  model?: string | null;
  requestedModel?: string | null;
  clientModel?: string | null;
  route?: string | null;
  requestWireApi?: string | null;
  upstreamWireApi?: string | null;
  stream?: boolean | null;
  keyword?: string | null;
  from?: string | null;
  to?: string | null;
  callType?: AiCallType | null;
};

type ReadAiCallLogStats = {
  matched: number;
  main: number;
  visionFallback: number;
  visionByModel: Array<{ model: string; count: number }>;
  visionByKey: Array<{ keyId: number; keyName: string; count: number }>;
};

type ReadAiCallLogFilterOptions = {
  upstreamModels: string[];
  requestedModels: string[];
  clientModels: string[];
  routes: string[];
  requestWireApis: string[];
  upstreamWireApis: string[];
};

const EMPTY_FILTER_OPTIONS: ReadAiCallLogFilterOptions = {
  upstreamModels: [],
  requestedModels: [],
  clientModels: [],
  routes: [],
  requestWireApis: [],
  upstreamWireApis: []
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

function parseTimestampFilter(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return null;
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
        filterOptions: EMPTY_FILTER_OPTIONS,
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
    const requestedModelSet = new Set<string>();
    const clientModelSet = new Set<string>();
    const routeSet = new Set<string>();
    const requestWireApiSet = new Set<string>();
    const upstreamWireApiSet = new Set<string>();
    const keyId = query.keyId && query.keyId > 0 ? query.keyId : null;
    const modelFilter = trimForFilter(query.model);
    const requestedModelFilter = trimForFilter(query.requestedModel);
    const clientModelFilter = trimForFilter(query.clientModel);
    const routeFilter = trimForFilter(query.route);
    const requestWireApiFilter = trimForFilter(query.requestWireApi);
    const upstreamWireApiFilter = trimForFilter(query.upstreamWireApi);
    const keywordFilter = trimForFilter(query.keyword);
    const streamFilter = typeof query.stream === "boolean" ? query.stream : null;
    const fromTs = parseTimestampFilter(query.from);
    const toTs = parseTimestampFilter(query.to);
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
        conversationTranscript:
          typeof parsedRaw.conversationTranscript === "string" &&
          parsedRaw.conversationTranscript.trim()
            ? parsedRaw.conversationTranscript
            : [parsedRaw.systemPrompt, parsedRaw.userPrompt].filter(Boolean).join("\n\n"),
        callType: normalizeCallType(parsedRaw.callType)
      };

      if (parsed.upstreamModel?.trim()) {
        modelSet.add(parsed.upstreamModel.trim());
      }
      if (parsed.requestedModel?.trim()) {
        requestedModelSet.add(parsed.requestedModel.trim());
      }
      if (parsed.clientModel?.trim()) {
        clientModelSet.add(parsed.clientModel.trim());
      }
      if (parsed.route?.trim()) {
        routeSet.add(parsed.route.trim());
      }
      if (parsed.requestWireApi?.trim()) {
        requestWireApiSet.add(parsed.requestWireApi.trim());
      }
      if (parsed.upstreamWireApi?.trim()) {
        upstreamWireApiSet.add(parsed.upstreamWireApi.trim());
      }

      if (keyId !== null && parsed.keyId !== keyId) {
        continue;
      }
      if (modelFilter && trimForFilter(parsed.upstreamModel) !== modelFilter) {
        continue;
      }
      if (requestedModelFilter && trimForFilter(parsed.requestedModel) !== requestedModelFilter) {
        continue;
      }
      if (clientModelFilter && trimForFilter(parsed.clientModel) !== clientModelFilter) {
        continue;
      }
      if (routeFilter && trimForFilter(parsed.route) !== routeFilter) {
        continue;
      }
      if (requestWireApiFilter && trimForFilter(parsed.requestWireApi) !== requestWireApiFilter) {
        continue;
      }
      if (upstreamWireApiFilter && trimForFilter(parsed.upstreamWireApi) !== upstreamWireApiFilter) {
        continue;
      }
      if (streamFilter !== null && parsed.stream !== streamFilter) {
        continue;
      }
      if (fromTs !== null || toTs !== null) {
        const createdTs = parseTimestampFilter(parsed.createdAt);
        if (createdTs === null) {
          continue;
        }
        if (fromTs !== null && createdTs < fromTs) {
          continue;
        }
        if (toTs !== null && createdTs > toTs) {
          continue;
        }
      }
      if (keywordFilter) {
        const haystack = [
          parsed.id,
          parsed.keyName,
          parsed.route,
          parsed.requestWireApi,
          parsed.upstreamWireApi,
          parsed.requestedModel,
          parsed.clientModel,
          parsed.upstreamModel,
          parsed.systemPrompt,
          parsed.userPrompt,
          parsed.conversationTranscript,
          parsed.assistantResponse
        ]
          .filter(Boolean)
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(keywordFilter)) {
          continue;
        }
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
      filterOptions: {
        upstreamModels: Array.from(modelSet).sort((a, b) => a.localeCompare(b)),
        requestedModels: Array.from(requestedModelSet).sort((a, b) => a.localeCompare(b)),
        clientModels: Array.from(clientModelSet).sort((a, b) => a.localeCompare(b)),
        routes: Array.from(routeSet).sort((a, b) => a.localeCompare(b)),
        requestWireApis: Array.from(requestWireApiSet).sort((a, b) => a.localeCompare(b)),
        upstreamWireApis: Array.from(upstreamWireApiSet).sort((a, b) => a.localeCompare(b))
      } satisfies ReadAiCallLogFilterOptions,
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
      filterOptions: EMPTY_FILTER_OPTIONS,
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
