import { mkdir, readFile, truncate, writeFile } from "node:fs/promises";
import path from "node:path";

export type ApiLogEntry = {
  id: string;
  route: string;
  method: string;
  path: string;
  status: number | null;
  elapsedMs: number;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  error: string | null;
  createdAt: string;
};

function resolveLogFilePath() {
  const custom = process.env.API_LOG_FILE?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  }
  return path.resolve(process.cwd(), "logs", "api-access.ndjson");
}

const API_LOG_FILE_PATH = resolveLogFilePath();

let ensureDirPromise: Promise<void> | null = null;
let appendQueue: Promise<void> = Promise.resolve();

function logFilePath() {
  return API_LOG_FILE_PATH;
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

export async function appendApiLogEntry(entry: ApiLogEntry) {
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

export async function readApiLogEntries(limit: number) {
  try {
    await waitForPendingAppends();
    const raw = await readFile(logFilePath(), "utf8");
    if (!raw.trim()) {
      return [];
    }
    const lines = raw.split("\n").filter(Boolean);
    const items: ApiLogEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && items.length < limit; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]) as ApiLogEntry;
        items.push(parsed);
      } catch {
        continue;
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function clearApiLogEntries() {
  try {
    await waitForPendingAppends();
    await ensureLogFileDir();
    await truncate(logFilePath(), 0);
  } catch {
    await writeFile(logFilePath(), "", "utf8").catch(() => {});
  }
}
