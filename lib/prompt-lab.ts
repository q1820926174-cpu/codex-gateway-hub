import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  PromptLabFailureCase,
  PromptLabMetricSummary,
  PromptLabModelMetrics,
  PromptLabNormalizedReport,
  PromptLabRun,
  PromptLabRunRequest,
  PromptLabRunWithReport
} from "@/lib/prompt-lab-types";

const PROMPT_LAB_ROOT_DIR = path.resolve(process.cwd(), ".tmp", "prompt-lab");
const PROMPT_LAB_RUNS_DIR = path.join(PROMPT_LAB_ROOT_DIR, "runs");
const PROMPT_LAB_MAX_MODELS = 12;
const PROMPT_LAB_DEFAULT_TIMEOUT_MS = 8 * 60_000;
const PROMPT_LAB_MAX_OUTPUT_BYTES = 1_000_000;
const PROMPT_LAB_MAX_CONCURRENT = 1;
const PROMPT_LAB_DEFAULT_BASELINE = "gpt-5.4";
const BENCHMARK_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "benchmark-codex-prompts.mjs");

const PROMPT_SUITE_PRESETS: Record<string, string> = {
  "tool-accuracy-v1":
    "请在当前目录完成三步：1) 创建 probe_codex.txt，内容为 hello；2) 将其改为 hello world；3) 删除该文件。禁止只输出 patch 文本，必须真实执行。完成后只输出 DONE。",
  "agents-hint-v1":
    "你是 Codex 代码代理。请执行：创建 hello.txt 写入 hi，再删除该文件。必须真实调用工具，不得输出伪工具调用文本。"
};

type PromptLabQueueTask = {
  runId: string;
  task: () => Promise<void>;
};

type PromptLabGlobalState = {
  __promptLabRuns?: Map<string, PromptLabRunWithReport>;
  __promptLabQueue?: PromptLabQueueTask[];
  __promptLabQueueActive?: number;
  __promptLabQueueRunning?: boolean;
};

type BenchmarkResultRow = {
  model?: unknown;
  exitCode?: unknown;
  finalMessage?: unknown;
  probeDeleted?: unknown;
  usedApplyPatch?: unknown;
  usedShellExec?: unknown;
  leakedPatchText?: unknown;
};

type BenchmarkReportPayload = {
  timestamp?: unknown;
  prompt?: unknown;
  sandbox?: unknown;
  outputDir?: unknown;
  results?: unknown;
};

const globalPromptLabState = globalThis as typeof globalThis & PromptLabGlobalState;
if (!globalPromptLabState.__promptLabRuns) {
  globalPromptLabState.__promptLabRuns = new Map<string, PromptLabRunWithReport>();
}
if (!globalPromptLabState.__promptLabQueue) {
  globalPromptLabState.__promptLabQueue = [];
}
if (typeof globalPromptLabState.__promptLabQueueActive !== "number") {
  globalPromptLabState.__promptLabQueueActive = 0;
}
if (typeof globalPromptLabState.__promptLabQueueRunning !== "boolean") {
  globalPromptLabState.__promptLabQueueRunning = false;
}

function runsStore() {
  return globalPromptLabState.__promptLabRuns!;
}

function queueStore() {
  return globalPromptLabState.__promptLabQueue!;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function toTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeRunId(value: unknown) {
  const raw = toTrimmedString(value);
  if (!raw) {
    return "";
  }
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitizeModelName(value: unknown) {
  const model = toTrimmedString(value);
  if (!model) {
    return "";
  }
  return model.slice(0, 256);
}

function sanitizeSandbox(value: unknown): PromptLabRunRequest["sandbox"] {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  return "workspace-write";
}

function sanitizeSuiteId(value: unknown) {
  const input = toTrimmedString(value);
  if (!input) {
    return "tool-accuracy-v1";
  }
  return input.slice(0, 80);
}

function normalizeCandidateModels(value: unknown, baselineModel: string) {
  const list = Array.isArray(value) ? value : [];
  const output: string[] = [];
  const seen = new Set<string>([baselineModel.toLowerCase()]);
  for (const entry of list) {
    const model = sanitizeModelName(entry);
    if (!model) {
      continue;
    }
    const key = model.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(model);
    if (output.length >= PROMPT_LAB_MAX_MODELS) {
      break;
    }
  }
  return output;
}

function runRecordPath(runId: string) {
  return path.join(PROMPT_LAB_RUNS_DIR, `${runId}.json`);
}

async function ensurePromptLabDirs() {
  await mkdir(PROMPT_LAB_RUNS_DIR, { recursive: true });
}

async function persistRun(run: PromptLabRunWithReport) {
  await ensurePromptLabDirs();
  runsStore().set(run.id, run);
  await writeFile(runRecordPath(run.id), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

async function readRunFromDisk(runId: string) {
  try {
    const raw = await readFile(runRecordPath(runId), "utf8");
    const parsed = JSON.parse(raw) as PromptLabRunWithReport;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      return null;
    }
    runsStore().set(parsed.id, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function summarizeRun(run: PromptLabRunWithReport): PromptLabRun {
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    baselineModel: run.baselineModel,
    candidateModels: [...run.candidateModels],
    suiteId: run.suiteId,
    sandbox: run.sandbox,
    phase: { ...run.phase },
    error: run.error,
    metrics: run.metrics ? { ...run.metrics } : null
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

function safeAverage(values: number[]) {
  if (!values.length) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return Number((sum / values.length).toFixed(2));
}

function countMatches(text: string, pattern: RegExp) {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

async function readMaybeText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function buildSuggestionHint(reasons: string[]) {
  const lines: string[] = [];
  if (reasons.some((item) => item.includes("schema"))) {
    lines.push("- 调用工具前必须严格对齐 schema：工具名、参数名、类型、必填项和枚举值。");
  }
  if (reasons.some((item) => item.includes("工具调用"))) {
    lines.push("- 禁止输出伪工具调用文本，必须真实调用工具并依据返回结果继续。");
  }
  if (reasons.some((item) => item.includes("patch"))) {
    lines.push("- 禁止在普通回复中输出 patch 原文，`apply_patch` 仅通过真实工具调用提交。");
  }
  if (reasons.some((item) => item.includes("任务未完成"))) {
    lines.push("- 完成前必须执行端到端校验，校验失败时继续修复而不是提前结束。");
  }
  if (reasons.some((item) => item.includes("重试"))) {
    lines.push("- 工具调用失败后先读取错误并修正参数，再重试同一步骤。");
  }
  if (!lines.length) {
    lines.push("- 保持工具调用准确、验证充分、结论可追溯。");
  }
  return lines.join("\n");
}

function buildFailureCase(model: string, reasons: string[], suggestion: string): PromptLabFailureCase {
  return {
    model,
    title: `${model} 需要修正`,
    reason: reasons.join("；"),
    impact: "会导致 Codex 工具链执行不稳定，影响任务可完成性与结果可信度。",
    suggestion,
    suggestedHint: buildSuggestionHint(reasons)
  };
}

function normalizeBenchmarkRows(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as BenchmarkResultRow[];
  }
  return value as BenchmarkResultRow[];
}

function normalizeImportPayload(input: unknown): BenchmarkReportPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const source = input as Record<string, unknown>;
  if (Array.isArray(source.results)) {
    return source as BenchmarkReportPayload;
  }
  if (source.report && typeof source.report === "object") {
    const nested = source.report as Record<string, unknown>;
    if (Array.isArray(nested.results)) {
      return nested as BenchmarkReportPayload;
    }
  }
  return null;
}

async function normalizeBenchmarkReport(params: {
  runId: string;
  mode: PromptLabRunRequest["mode"];
  baselineModel: string;
  candidateModels: string[];
  suiteId: string;
  sandbox: string;
  raw: unknown;
  outputDir?: string;
}): Promise<PromptLabNormalizedReport> {
  const parsed = normalizeImportPayload(params.raw);
  if (!parsed) {
    throw new Error("Prompt Lab 报告格式无效：缺少 results 数组。");
  }

  const rows = normalizeBenchmarkRows(parsed.results);
  if (!rows.length) {
    throw new Error("Prompt Lab 报告为空：results 没有可用数据。");
  }

  const perModel: PromptLabModelMetrics[] = [];
  const failures: PromptLabFailureCase[] = [];

  for (const row of rows) {
    const model = sanitizeModelName(row.model) || "unknown-model";
    const modelDir = params.outputDir ? path.join(params.outputDir, slugify(model) || "model") : null;
    const stdoutText = modelDir ? await readMaybeText(path.join(modelDir, "stdout.log")) : "";
    const stderrText = modelDir ? await readMaybeText(path.join(modelDir, "stderr.log")) : "";
    const finalMessage = toTrimmedString(row.finalMessage);
    const text = `${stdoutText}\n${stderrText}\n${finalMessage}`;

    const schemaErrorCount =
      countMatches(text, /invalid\s+tool|unknown\s+tool|schema|invalid\s+parameter|required\s+field/gi);
    const toolCallCount =
      (row.usedApplyPatch ? 1 : 0) +
      (row.usedShellExec ? 1 : 0) +
      countMatches(text, /apply_patch\(|write_stdin\(|\nexec\n\/bin\/bash -lc /gi);
    const retryCount = countMatches(text, /retry|重试|再次尝试|fix.*call/gi);
    const leakedPatchText = row.leakedPatchText === true;
    const probeDeleted = row.probeDeleted === true;
    const exitCode =
      typeof row.exitCode === "number" && Number.isFinite(row.exitCode) ? Math.floor(row.exitCode) : -1;

    const toolSchemaAccuracy = schemaErrorCount > 0 ? 0 : 100;
    const validToolCallRate = toolCallCount > 0 ? 100 : 0;
    const taskCompletionRate = probeDeleted && exitCode === 0 ? 100 : 0;
    const fakePatchLeakRate = leakedPatchText ? 100 : 0;
    const retryRecoveryRate = retryCount > 0 ? (exitCode === 0 ? 100 : 0) : 100;

    perModel.push({
      model,
      exitCode,
      toolSchemaAccuracy,
      validToolCallRate,
      taskCompletionRate,
      fakePatchLeakRate,
      retryRecoveryRate,
      schemaErrorCount,
      toolCallCount,
      retryCount,
      probeDeleted,
      leakedPatchText,
      finalMessage
    });

    const reasons: string[] = [];
    if (schemaErrorCount > 0) {
      reasons.push("存在 schema/参数错误");
    }
    if (toolCallCount === 0) {
      reasons.push("未检测到有效工具调用");
    }
    if (leakedPatchText) {
      reasons.push("出现伪 patch 文本泄漏");
    }
    if (!(probeDeleted && exitCode === 0)) {
      reasons.push("任务未完成或退出异常");
    }
    if (retryCount > 0 && exitCode !== 0) {
      reasons.push("重试后仍未恢复");
    }

    if (reasons.length) {
      failures.push(
        buildFailureCase(
          model,
          reasons,
          "建议将失败样例写入模型专属规则，并在保存后立即发起回归测试。"
        )
      );
    }
  }

  const aggregationRows =
    perModel.filter((item) => item.model.toLowerCase() !== params.baselineModel.toLowerCase()).length > 0
      ? perModel.filter((item) => item.model.toLowerCase() !== params.baselineModel.toLowerCase())
      : perModel;

  const metrics: PromptLabMetricSummary = {
    toolSchemaAccuracy: safeAverage(aggregationRows.map((item) => item.toolSchemaAccuracy)),
    validToolCallRate: safeAverage(aggregationRows.map((item) => item.validToolCallRate)),
    taskCompletionRate: safeAverage(aggregationRows.map((item) => item.taskCompletionRate)),
    fakePatchLeakRate: safeAverage(aggregationRows.map((item) => item.fakePatchLeakRate)),
    retryRecoveryRate: safeAverage(aggregationRows.map((item) => item.retryRecoveryRate)),
    sampleSize: aggregationRows.length,
    pass: false
  };
  metrics.pass =
    metrics.toolSchemaAccuracy >= 95 &&
    metrics.taskCompletionRate >= 85 &&
    metrics.fakePatchLeakRate <= 1;

  return {
    runId: params.runId,
    mode: params.mode,
    createdAt: new Date().toISOString(),
    baselineModel: params.baselineModel,
    candidateModels: [...params.candidateModels],
    suiteId: params.suiteId,
    sandbox: params.sandbox,
    source: params.mode === "import" ? "imported" : "codex-benchmark",
    metrics,
    perModel,
    failures,
    raw: params.raw
  };
}

function runTimeoutMs() {
  const raw = Number(process.env.PROMPT_LAB_RUN_TIMEOUT_MS ?? PROMPT_LAB_DEFAULT_TIMEOUT_MS);
  return clampInt(raw, 60_000, 20 * 60_000);
}

function buildAllowedCodexBins() {
  const allowed = new Set<string>(["codex"]);
  const envConfigured = toTrimmedString(process.env.CODEX_BIN);
  if (envConfigured && /^[\w./-]+$/.test(envConfigured)) {
    allowed.add(envConfigured);
  }
  const customAllowed = toTrimmedString(process.env.PROMPT_LAB_CODEX_BIN_ALLOWLIST);
  if (customAllowed) {
    for (const item of customAllowed.split(",")) {
      const normalized = item.trim();
      if (!normalized) {
        continue;
      }
      if (/^[\w./-]+$/.test(normalized)) {
        allowed.add(normalized);
      }
    }
  }
  return allowed;
}

function resolveCodexExecutable() {
  const desired = toTrimmedString(process.env.PROMPT_LAB_CODEX_BIN || process.env.CODEX_BIN || "codex");
  if (!desired || !/^[\w./-]+$/.test(desired)) {
    throw new Error("PROMPT_LAB_CODEX_BIN 非法，仅允许字母数字及 ./-_ 路径。");
  }
  const allowed = buildAllowedCodexBins();
  if (!allowed.has(desired)) {
    throw new Error("PROMPT_LAB_CODEX_BIN 未在白名单中。请配置 PROMPT_LAB_CODEX_BIN_ALLOWLIST。");
  }
  return desired;
}

function resolvePromptBySuite(suiteId: string) {
  return PROMPT_SUITE_PRESETS[suiteId] ?? PROMPT_SUITE_PRESETS["tool-accuracy-v1"];
}

async function executeNodeProcess(params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}) {
  return await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stopped = false;

    const appendLimited = (current: string, chunk: Buffer) => {
      const next = `${current}${chunk.toString("utf8")}`;
      if (next.length <= PROMPT_LAB_MAX_OUTPUT_BYTES) {
        return next;
      }
      return next.slice(0, PROMPT_LAB_MAX_OUTPUT_BYTES);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });

    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGTERM");
      reject(new Error(`Prompt Lab CLI 运行超时（>${params.timeoutMs}ms）。`));
    }, params.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stopped) {
        return;
      }
      resolve({
        code: typeof code === "number" ? code : -1,
        stdout,
        stderr
      });
    });
  });
}

async function updateRun(runId: string, updater: (prev: PromptLabRunWithReport) => PromptLabRunWithReport) {
  const current = runsStore().get(runId) ?? (await readRunFromDisk(runId));
  if (!current) {
    return null;
  }
  const next = updater(current);
  await persistRun(next);
  return next;
}

function queueProcessRunning() {
  return globalPromptLabState.__promptLabQueueRunning === true;
}

async function pumpQueue() {
  if (queueProcessRunning()) {
    return;
  }
  globalPromptLabState.__promptLabQueueRunning = true;
  try {
    while (queueStore().length > 0 && (globalPromptLabState.__promptLabQueueActive ?? 0) < PROMPT_LAB_MAX_CONCURRENT) {
      const task = queueStore().shift();
      if (!task) {
        break;
      }
      globalPromptLabState.__promptLabQueueActive = (globalPromptLabState.__promptLabQueueActive ?? 0) + 1;
      void task
        .task()
        .catch(async (error) => {
          await updateRun(task.runId, (prev) => ({
            ...prev,
            status: "failed",
            updatedAt: new Date().toISOString(),
            phase: {
              ...prev.phase,
              execute: prev.phase.execute === "succeeded" ? "succeeded" : "failed",
              analyze: prev.phase.analyze === "succeeded" ? "succeeded" : "failed"
            },
            error: error instanceof Error ? error.message : String(error)
          }));
        })
        .finally(() => {
          globalPromptLabState.__promptLabQueueActive = Math.max(
            0,
            (globalPromptLabState.__promptLabQueueActive ?? 1) - 1
          );
          void pumpQueue();
        });
    }
  } finally {
    globalPromptLabState.__promptLabQueueRunning = false;
  }
}

async function executeCliRun(runId: string) {
  const run = runsStore().get(runId);
  if (!run) {
    return;
  }
  await updateRun(runId, (prev) => ({
    ...prev,
    status: "running",
    updatedAt: new Date().toISOString(),
    phase: {
      prepare: "running",
      execute: "pending",
      analyze: "pending"
    },
    error: null
  }));

  const baselineModel = run.baselineModel || PROMPT_LAB_DEFAULT_BASELINE;
  const candidateModels = [...run.candidateModels];
  const modelList = [baselineModel, ...candidateModels];
  const outDir = path.join(PROMPT_LAB_ROOT_DIR, "artifacts", runId);
  const codexBin = resolveCodexExecutable();
  const suitePrompt = resolvePromptBySuite(run.suiteId);

  if (!existsSync(BENCHMARK_SCRIPT_PATH)) {
    throw new Error("缺少 benchmark 脚本：scripts/benchmark-codex-prompts.mjs");
  }

  await mkdir(outDir, { recursive: true });
  await updateRun(runId, (prev) => ({
    ...prev,
    updatedAt: new Date().toISOString(),
    phase: {
      prepare: "succeeded",
      execute: "running",
      analyze: "pending"
    }
  }));

  const execResult = await executeNodeProcess({
    command: process.execPath,
    args: [
      BENCHMARK_SCRIPT_PATH,
      "--models",
      modelList.join(","),
      "--sandbox",
      run.sandbox,
      "--out-dir",
      outDir,
      "--codex-bin",
      codexBin,
      "--prompt",
      suitePrompt
    ],
    cwd: process.cwd(),
    timeoutMs: runTimeoutMs()
  });

  if (execResult.code !== 0) {
    throw new Error(
      `Prompt Lab 基准执行失败（exit ${execResult.code}）。${execResult.stderr || execResult.stdout || ""}`.slice(
        0,
        1200
      )
    );
  }

  const reportPath = path.join(outDir, "report.json");
  if (!existsSync(reportPath)) {
    throw new Error("Prompt Lab 缺少 report.json 输出。");
  }
  const reportRawText = await readFile(reportPath, "utf8");
  let reportRaw: unknown;
  try {
    reportRaw = JSON.parse(reportRawText);
  } catch {
    throw new Error("Prompt Lab 输出 report.json 解析失败。");
  }

  await updateRun(runId, (prev) => ({
    ...prev,
    updatedAt: new Date().toISOString(),
    phase: {
      ...prev.phase,
      execute: "succeeded",
      analyze: "running"
    }
  }));

  const normalizedReport = await normalizeBenchmarkReport({
    runId,
    mode: "cli",
    baselineModel,
    candidateModels,
    suiteId: run.suiteId,
    sandbox: run.sandbox,
    raw: reportRaw,
    outputDir: outDir
  });

  await updateRun(runId, (prev) => ({
    ...prev,
    status: "succeeded",
    updatedAt: new Date().toISOString(),
    phase: {
      prepare: "succeeded",
      execute: "succeeded",
      analyze: "succeeded"
    },
    metrics: normalizedReport.metrics,
    report: normalizedReport,
    error: null
  }));
}

export function createPromptLabRun(input: PromptLabRunRequest) {
  const baselineModel = sanitizeModelName(input.baselineModel) || PROMPT_LAB_DEFAULT_BASELINE;
  const candidateModels = normalizeCandidateModels(input.candidateModels, baselineModel);
  const mode = input.mode === "import" ? "import" : "cli";
  const suiteId = sanitizeSuiteId(input.suiteId);
  const sandbox = sanitizeSandbox(input.sandbox);
  const runId = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();

  const run: PromptLabRunWithReport = {
    id: runId,
    status: mode === "import" ? "running" : "queued",
    mode,
    createdAt: now,
    updatedAt: now,
    baselineModel,
    candidateModels,
    suiteId,
    sandbox,
    phase:
      mode === "import"
        ? {
            prepare: "succeeded",
            execute: "succeeded",
            analyze: "running"
          }
        : {
            prepare: "pending",
            execute: "pending",
            analyze: "pending"
          },
    error: null,
    metrics: null,
    report: null
  };

  const initialize = async () => {
    await persistRun(run);

    if (mode === "import") {
      try {
        const normalizedReport = await normalizeBenchmarkReport({
          runId,
          mode: "import",
          baselineModel,
          candidateModels,
          suiteId,
          sandbox,
          raw: input.reportJson
        });
        await updateRun(runId, (prev) => ({
          ...prev,
          status: "succeeded",
          updatedAt: new Date().toISOString(),
          phase: {
            prepare: "succeeded",
            execute: "succeeded",
            analyze: "succeeded"
          },
          metrics: normalizedReport.metrics,
          report: normalizedReport,
          error: null
        }));
      } catch (error) {
        await updateRun(runId, (prev) => ({
          ...prev,
          status: "failed",
          updatedAt: new Date().toISOString(),
          phase: {
            prepare: "succeeded",
            execute: "succeeded",
            analyze: "failed"
          },
          error: error instanceof Error ? error.message : String(error)
        }));
      }
      return;
    }

    queueStore().push({
      runId,
      task: async () => {
        await executeCliRun(runId);
      }
    });
    void pumpQueue();
  };

  return {
    run: summarizeRun(run),
    initialize
  };
}

export async function getPromptLabRun(runIdRaw: string) {
  const runId = sanitizeRunId(runIdRaw);
  if (!runId) {
    return null;
  }
  const fromMemory = runsStore().get(runId);
  if (fromMemory) {
    return summarizeRun(fromMemory);
  }
  const fromDisk = await readRunFromDisk(runId);
  if (!fromDisk) {
    return null;
  }
  return summarizeRun(fromDisk);
}

export async function getPromptLabRunWithReport(runIdRaw: string) {
  const runId = sanitizeRunId(runIdRaw);
  if (!runId) {
    return null;
  }
  const fromMemory = runsStore().get(runId);
  if (fromMemory) {
    return fromMemory;
  }
  return await readRunFromDisk(runId);
}

export function getPromptLabQueueSnapshot() {
  return {
    queued: queueStore().length,
    running: globalPromptLabState.__promptLabQueueActive ?? 0
  };
}

export function evaluatePromptLabScoreDelta(
  baseline: PromptLabModelMetrics | null,
  candidate: PromptLabModelMetrics
) {
  if (!baseline) {
    return {
      toolSchemaAccuracyDelta: 0,
      validToolCallRateDelta: 0,
      taskCompletionRateDelta: 0,
      fakePatchLeakRateDelta: 0,
      retryRecoveryRateDelta: 0
    };
  }
  return {
    toolSchemaAccuracyDelta: Number((candidate.toolSchemaAccuracy - baseline.toolSchemaAccuracy).toFixed(2)),
    validToolCallRateDelta: Number((candidate.validToolCallRate - baseline.validToolCallRate).toFixed(2)),
    taskCompletionRateDelta: Number((candidate.taskCompletionRate - baseline.taskCompletionRate).toFixed(2)),
    fakePatchLeakRateDelta: Number((candidate.fakePatchLeakRate - baseline.fakePatchLeakRate).toFixed(2)),
    retryRecoveryRateDelta: Number((candidate.retryRecoveryRate - baseline.retryRecoveryRate).toFixed(2))
  };
}

export function summarizePromptLabFailures(failures: PromptLabFailureCase[]) {
  const byModel = new Map<string, number>();
  for (const item of failures) {
    byModel.set(item.model, (byModel.get(item.model) ?? 0) + 1);
  }
  return {
    total: failures.length,
    byModel: Array.from(byModel.entries()).map(([model, count]) => ({ model, count }))
  };
}

export function scorePromptLabThresholds(metrics: PromptLabMetricSummary) {
  return {
    toolSchemaAccuracy: {
      value: metrics.toolSchemaAccuracy,
      pass: metrics.toolSchemaAccuracy >= 95
    },
    taskCompletionRate: {
      value: metrics.taskCompletionRate,
      pass: metrics.taskCompletionRate >= 85
    },
    fakePatchLeakRate: {
      value: metrics.fakePatchLeakRate,
      pass: metrics.fakePatchLeakRate <= 1
    },
    validToolCallRate: {
      value: metrics.validToolCallRate,
      pass: metrics.validToolCallRate >= 80
    },
    retryRecoveryRate: {
      value: metrics.retryRecoveryRate,
      pass: metrics.retryRecoveryRate >= 70
    }
  };
}
