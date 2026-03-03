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

function logFilePath() {
  const custom = process.env.API_LOG_FILE?.trim();
  if (custom) {
    return path.isAbsolute(custom) ? custom : path.resolve(process.cwd(), custom);
  }
  return path.resolve(process.cwd(), "logs", "api-access.ndjson");
}

async function ensureLogFileDir() {
  await mkdir(path.dirname(logFilePath()), { recursive: true });
}

export async function appendApiLogEntry(entry: ApiLogEntry) {
  try {
    await ensureLogFileDir();
    await writeFile(logFilePath(), `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      flag: "a"
    });
  } catch {
    // ignore logging side effect failures
  }
}

export async function readApiLogEntries(limit: number) {
  try {
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
    await ensureLogFileDir();
    await truncate(logFilePath(), 0);
  } catch {
    await writeFile(logFilePath(), "", "utf8").catch(() => {});
  }
}
