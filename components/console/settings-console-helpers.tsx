import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supportsGlmThinkingType } from "@/lib/key-config";
import {
  EMPTY_AI_CALL_FILTER_OPTIONS,
  PROVIDER_DEFAULT_BASE_URL
} from "@/components/console/types";
import type {
  AiCallLogFilterOptions,
  ChannelFormState,
  GatewayKey,
  GlmCodexThinkingThreshold,
  KeyFormState,
  ProviderName,
  UpstreamChannel,
  UpstreamModelConfig,
  UsageBucketMode,
  UsageMetricKey,
  UsageTimelineRow
} from "@/components/console/types";
import type {
  PromptLabFailureCase,
  PromptLabNormalizedReport,
  PromptLabRun
} from "@/lib/prompt-lab-types";
import { generateMappingId, generateModelId } from "@/lib/console-utils";

export type CompatPromptConfig = {
  agentsMdKeywords: string[];
  chineseReplyHint: string;
  modelPromptRules: CompatPromptRule[];
};

export type CompatPromptRule = {
  id: string;
  enabled: boolean;
  provider: string;
  upstreamModelPattern: string;
  hint: string;
};

export type CompatPromptRuleCheckItem = {
  level: "warn" | "error";
  message: string;
  relatedIndexes: number[];
};

export type PromptLabRunSummaryResponse = PromptLabRun & {
  queue?: {
    queued: number;
    running: number;
  };
  failureSummary?: {
    total: number;
    byModel: Array<{ model: string; count: number }>;
  };
};

export type PromptLabReportResponse = {
  runId: string;
  status: PromptLabRun["status"];
  report: PromptLabNormalizedReport;
  thresholds?: Record<
    string,
    {
      value: number;
      pass: boolean;
    }
  >;
};

export type ConfigSummaryResponse = {
  wireApi: string;
  totalKeys: number;
  enabledKeys: number;
  totalChannels: number;
  enabledChannels: number;
  manageKeysApi: string;
  manageUpstreamsApi: string;
  usageReportApi: string;
  aiCallLogApi: string;
  compatPromptConfig: CompatPromptConfig;
  compatPromptDefaults: CompatPromptConfig;
};

const CN_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai"
});

const NUMBER_FORMATTER = new Intl.NumberFormat("zh-CN");
const CN_MINUTE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai"
});

function generateCompatPromptRuleId() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `rule_${suffix}`;
}

export function createCompatPromptRuleDraft(
  overrides: Partial<CompatPromptRule> = {}
): CompatPromptRule {
  return {
    id: overrides.id?.trim() || generateCompatPromptRuleId(),
    enabled: overrides.enabled ?? true,
    provider: overrides.provider?.trim() || "",
    upstreamModelPattern: overrides.upstreamModelPattern?.trim() || "",
    hint: overrides.hint ?? ""
  };
}

export function createUpstreamModelDraft(
  overrides: Partial<UpstreamModelConfig> = {}
): UpstreamModelConfig {
  return {
    id: overrides.id ?? generateModelId(),
    name: overrides.name ?? "默认模型",
    aliasModel: overrides.aliasModel ?? null,
    model: overrides.model ?? "gpt-4.1-mini",
    contextWindow: typeof overrides.contextWindow === "number" ? overrides.contextWindow : null,
    upstreamWireApi: overrides.upstreamWireApi ?? "responses",
    glmCodexThinkingThreshold:
      overrides.glmCodexThinkingThreshold === "off" ||
      overrides.glmCodexThinkingThreshold === "medium" ||
      overrides.glmCodexThinkingThreshold === "high"
        ? overrides.glmCodexThinkingThreshold
        : "low",
    supportsVision: overrides.supportsVision ?? true,
    visionChannelId: overrides.visionChannelId ?? null,
    visionModel: overrides.visionModel ?? null,
    enabled: overrides.enabled ?? true
  };
}

export function normalizeGlmCodexThinkingThreshold(
  value: string | null | undefined
): GlmCodexThinkingThreshold {
  if (value === "off") {
    return "off";
  }
  if (value === "medium") {
    return "medium";
  }
  if (value === "high") {
    return "high";
  }
  return "low";
}

export function shouldShowGlmThinkingThreshold(provider: ProviderName, model: string) {
  return supportsGlmThinkingType(provider, model);
}

export function shouldShowDoubaoThinkingType(provider: ProviderName, model: string) {
  const normalized = model.trim().toLowerCase();
  return (
    provider === "doubao" ||
    normalized.startsWith("doubao-") ||
    normalized.startsWith("deepseek-")
  );
}

export function createEmptyKeyFormState(localKey = ""): KeyFormState {
  return {
    name: "new-local-key",
    localKey,
    upstreamChannelId: null,
    modelMappings: [],
    dynamicModelSwitch: false,
    contextSwitchThreshold: 128000,
    contextOverflowModel: "",
    enabled: true
  };
}

export function createEmptyChannelFormState(): ChannelFormState {
  return {
    name: "new-upstream-channel",
    provider: "openai",
    upstreamBaseUrl: PROVIDER_DEFAULT_BASE_URL.openai,
    upstreamApiKey: "",
    clearUpstreamApiKey: false,
    timeoutMs: 60000,
    enabled: true,
    defaultModel: "gpt-4.1-mini",
    upstreamModels: [
      createUpstreamModelDraft({
        name: "默认模型",
        model: "gpt-4.1-mini",
        upstreamWireApi: "responses",
        supportsVision: true
      })
    ]
  };
}

export function syncChannelFormWithModelPool(form: ChannelFormState): ChannelFormState {
  const upstreamModels = form.upstreamModels.length
    ? form.upstreamModels
    : [createUpstreamModelDraft({ model: form.defaultModel || "gpt-4.1-mini" })];

  const hasDefault = upstreamModels.some((item) => item.model === form.defaultModel);
  const defaultModel = hasDefault ? form.defaultModel : upstreamModels[0]?.model ?? "gpt-4.1-mini";

  return {
    ...form,
    upstreamModels,
    defaultModel
  };
}

export function toKeyForm(key: GatewayKey): KeyFormState {
  return {
    name: key.name,
    localKey: key.localKey,
    upstreamChannelId: key.upstreamChannelId,
    modelMappings:
      key.modelMappings?.map((item) => ({
        id: item.id || generateMappingId(),
        clientModel: item.clientModel,
        targetModel: item.targetModel,
        upstreamChannelId:
          typeof item.upstreamChannelId === "number" ? item.upstreamChannelId : null,
        thinkingType:
          item.thinkingType === "enabled" ||
          item.thinkingType === "disabled" ||
          item.thinkingType === "auto"
            ? item.thinkingType
            : null,
        enabled: item.enabled,
        dynamicModelSwitch: item.dynamicModelSwitch ?? false,
        contextSwitchThreshold: item.contextSwitchThreshold ?? 128000,
        contextOverflowModel: item.contextOverflowModel ?? null
      })) ?? [],
    dynamicModelSwitch: key.dynamicModelSwitch,
    contextSwitchThreshold: key.contextSwitchThreshold,
    contextOverflowModel: key.contextOverflowModel ?? "",
    enabled: key.enabled
  };
}

export function toChannelForm(channel: UpstreamChannel): ChannelFormState {
  return syncChannelFormWithModelPool({
    name: channel.name,
    provider: channel.provider,
    upstreamBaseUrl: channel.upstreamBaseUrl,
    upstreamApiKey: "",
    clearUpstreamApiKey: false,
    timeoutMs: channel.timeoutMs,
    enabled: channel.enabled,
    defaultModel: channel.defaultModel,
    upstreamModels:
      channel.upstreamModels.length > 0
        ? channel.upstreamModels.map((item) => ({
            ...item,
            aliasModel: item.aliasModel ?? null,
            contextWindow: typeof item.contextWindow === "number" ? item.contextWindow : null,
            glmCodexThinkingThreshold: normalizeGlmCodexThinkingThreshold(
              item.glmCodexThinkingThreshold
            ),
            visionChannelId: item.visionChannelId ?? null
          }))
        : [
            createUpstreamModelDraft({
              aliasModel: null,
              model: channel.defaultModel,
              contextWindow: null,
              upstreamWireApi: channel.upstreamWireApi,
              glmCodexThinkingThreshold: "low",
              supportsVision: channel.supportsVision,
              visionChannelId: null,
              visionModel: channel.visionModel
            })
          ]
  });
}

export function formatCnDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return CN_DATE_FORMATTER.format(date);
}

export function formatNumber(value: number) {
  return NUMBER_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

export function formatSignedNumber(value: number) {
  const safe = Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  const prefix = safe > 0 ? "+" : "";
  return `${prefix}${safe}`;
}

export function formatMinuteLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return CN_MINUTE_FORMATTER.format(date);
}

export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(1)}万`;
  }
  return formatNumber(value);
}

export function pickUsageMetricValue(
  row: Pick<UsageTimelineRow, UsageMetricKey>,
  metric: UsageMetricKey
) {
  return Number(row[metric] ?? 0);
}

export function resolveUsageBucketMinutes(minutes: number, mode: UsageBucketMode) {
  if (mode !== "auto") {
    return Number(mode);
  }
  if (minutes <= 120) {
    return 1;
  }
  if (minutes <= 720) {
    return 5;
  }
  if (minutes <= 1440) {
    return 15;
  }
  return 60;
}

export function maskLocalKey(localKey: string) {
  if (localKey.length <= 16) {
    return localKey;
  }
  return `${localKey.slice(0, 10)}...${localKey.slice(-4)}`;
}

export function normalizeSelectValue(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function normalizeAiCallFilterOptions(value: unknown): AiCallLogFilterOptions {
  if (!value || typeof value !== "object") {
    return EMPTY_AI_CALL_FILTER_OPTIONS;
  }
  const source = value as Partial<AiCallLogFilterOptions>;
  return {
    upstreamModels: normalizeStringArray(source.upstreamModels),
    requestedModels: normalizeStringArray(source.requestedModels),
    clientModels: normalizeStringArray(source.clientModels),
    routes: normalizeStringArray(source.routes),
    requestWireApis: normalizeStringArray(source.requestWireApis),
    upstreamWireApis: normalizeStringArray(source.upstreamWireApis)
  };
}

function formatDateTimeInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function buildRecentDateRange(minutes: number): [string, string] {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, minutes) * 60_000);
  return [formatDateTimeInput(start), formatDateTimeInput(end)];
}

export function formatCompatPromptKeywordsInput(keywords: string[]) {
  return keywords.join("\n");
}

export function parseCompatPromptKeywordsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeCompatPromptRule(
  rule: Partial<CompatPromptRule>,
  index: number
): CompatPromptRule {
  return {
    id: rule.id?.trim() || `rule-${index + 1}`,
    enabled: rule.enabled !== false,
    provider: rule.provider?.trim() || "",
    upstreamModelPattern: rule.upstreamModelPattern?.trim() || "",
    hint: rule.hint?.trim() || ""
  };
}

export function normalizeCompatPromptRules(rules: Partial<CompatPromptRule>[]) {
  return rules.map((rule, index) => normalizeCompatPromptRule(rule, index));
}

export function formatCompatPromptRulesJson(rules: CompatPromptRule[]) {
  return JSON.stringify(normalizeCompatPromptRules(rules), null, 2);
}

function extractCompatPromptRulesArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as {
    modelPromptRules?: unknown;
    compatPromptConfig?: {
      modelPromptRules?: unknown;
    };
  };
  if (Array.isArray(source.modelPromptRules)) {
    return source.modelPromptRules;
  }
  if (source.compatPromptConfig && Array.isArray(source.compatPromptConfig.modelPromptRules)) {
    return source.compatPromptConfig.modelPromptRules;
  }
  return null;
}

export function parseCompatPromptRulesJson(value: string): CompatPromptRule[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("模型规则 JSON 格式无效。");
  }
  const sourceArray = extractCompatPromptRulesArray(parsed);
  if (!sourceArray) {
    throw new Error(
      "模型规则 JSON 必须是数组，或包含 modelPromptRules / compatPromptConfig.modelPromptRules。"
    );
  }

  return sourceArray.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`第 ${index + 1} 条模型规则必须是对象。`);
    }

    const source = entry as Record<string, unknown>;
    const hint = typeof source.hint === "string" ? source.hint.trim() : "";
    if (!hint) {
      throw new Error(`第 ${index + 1} 条模型规则缺少 hint。`);
    }
    return normalizeCompatPromptRule(
      {
        id: typeof source.id === "string" ? source.id : undefined,
        enabled: typeof source.enabled === "boolean" ? source.enabled : undefined,
        provider: typeof source.provider === "string" ? source.provider : undefined,
        upstreamModelPattern:
          typeof source.upstreamModelPattern === "string"
            ? source.upstreamModelPattern
            : undefined,
        hint
      },
      index
    );
  });
}

export function parsePromptLabModelListInput(value: string) {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of value.split(/[\r\n,]+/)) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    models.push(trimmed);
    if (models.length >= 12) {
      break;
    }
  }
  return models;
}

export function ensureCompatPromptRuleIdsUnique(rules: CompatPromptRule[]) {
  const usedIds = new Set<string>();
  return rules.map((rule, index) => {
    const base = rule.id.trim() || `rule-${index + 1}`;
    let nextId = base;
    let suffix = 2;
    while (usedIds.has(nextId)) {
      nextId = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(nextId);
    return {
      ...rule,
      id: nextId
    };
  });
}

export function inspectCompatPromptRules(rules: CompatPromptRule[]) {
  const issues: CompatPromptRuleCheckItem[] = [];
  const normalized = normalizeCompatPromptRules(rules);
  const keyToIndexes = new Map<string, number[]>();

  for (let index = 0; index < normalized.length; index += 1) {
    const rule = normalized[index];
    const provider = rule.provider.trim().toLowerCase();
    const upstream = rule.upstreamModelPattern.trim().toLowerCase();
    const key = `${provider}::${upstream}`;
    const indexes = keyToIndexes.get(key) ?? [];
    indexes.push(index);
    keyToIndexes.set(key, indexes);

    if (!provider && (!upstream || upstream === "*" || upstream === "all" || upstream === "any")) {
      issues.push({
        level: "warn",
        message: `规则 #${index + 1} 过于宽泛（provider 和 upstreamModelPattern 都接近全匹配）。`,
        relatedIndexes: [index]
      });
    }
  }

  for (const indexes of keyToIndexes.values()) {
    if (indexes.length <= 1) {
      continue;
    }
    issues.push({
      level: "error",
      message: `存在重复匹配条件（规则 ${indexes.map((item) => `#${item + 1}`).join("、")}）。`,
      relatedIndexes: indexes
    });
  }

  return issues;
}

export function buildPromptLabHintFromFailure(item: PromptLabFailureCase) {
  const trimmed = item.suggestedHint.trim();
  if (trimmed) {
    return trimmed;
  }
  return [
    "- 严格遵循工具 schema，不得虚构工具参数。",
    "- 工具失败后修正调用再重试，不要跳步。",
    "- 提交结论前执行端到端校验。"
  ].join("\n");
}

export function humanizeConsoleErrorMessage(raw: string) {
  const text = raw.trim();
  if (!text) {
    return "操作失败，请重试。";
  }
  if (/missing upstream api key/i.test(text) || /缺少上游 api key/i.test(text)) {
    return "缺少上游 API Key。影响：无法联通测试或转发请求。建议：在上游渠道中补充 API Key 后重试。";
  }
  if (/rate limit/i.test(text)) {
    return "请求触发限流。影响：当前操作被网关保护策略拦截。建议：稍后重试，或降低并发。";
  }
  if (/timeout|timed out|超时/i.test(text)) {
    return "请求超时。影响：测试或调用未完成。建议：检查网络/上游状态，或适当提高 timeout。";
  }
  if (/not found|不存在/i.test(text)) {
    return "目标资源不存在。建议：刷新列表后确认对象仍然可用。";
  }
  return text;
}

export function stringifyCompatPromptRuleForSearch(rule: CompatPromptRule) {
  return [rule.id, rule.provider, rule.upstreamModelPattern, rule.hint].join(" ").toLowerCase();
}

export function resolveThinkingTokens(contextWindow: number | null) {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return 8192;
  }
  return Math.max(2048, Math.min(8192, Math.floor(contextWindow * 0.1)));
}

export function resolveCodexTokenBudgets(contextWindow: number | null) {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      autoCompactTokenLimit: null
    };
  }

  // Keep compaction slightly below full window to avoid hard context overflow.
  const autoCompactTokenLimit = Math.max(4096, Math.floor(contextWindow * 0.85));

  return {
    autoCompactTokenLimit
  };
}

export function resolveClaudeMaxOutputTokens(contextWindow: number | null) {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return 8192;
  }
  // Claude docs example: 1m window -> 32000 max output tokens.
  return Math.max(4096, Math.min(32000, Math.floor(contextWindow * 0.032)));
}

function formatContextWindowSuffix(contextWindow: number) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return "";
  }
  if (contextWindow % 1_000_000 === 0) {
    return `${Math.floor(contextWindow / 1_000_000)}m`;
  }
  if (contextWindow % 1_000 === 0) {
    return `${Math.floor(contextWindow / 1_000)}k`;
  }
  return String(Math.floor(contextWindow));
}

export function formatClaudeModelWithContext(model: string, contextWindow: number | null) {
  const normalizedModel = model.trim();
  if (!normalizedModel || !contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return normalizedModel;
  }
  const suffix = formatContextWindowSuffix(contextWindow);
  if (!suffix) {
    return normalizedModel;
  }
  return `${normalizedModel}[${suffix}]`;
}

export function inferContextWindowFromModel(model: string, provider: ProviderName) {
  const normalized = model.trim().toLowerCase().replace(/\[[^\]]+\]$/, "");
  if (!normalized) {
    return null;
  }

  // GLM coding presets usually expose 128k context.
  if (provider === "glm") {
    if (
      normalized === "glm-5" ||
      normalized.startsWith("glm-5-") ||
      normalized.startsWith("glm-4.5")
    ) {
      return 128000;
    }
  }

  // Doubao coding presets commonly expose 128k context.
  if (provider === "doubao") {
    if (normalized.includes("doubao-seed") || normalized.includes("seed-2.0-code")) {
      return 128000;
    }
  }

  // Codex/GPT-5 family commonly uses large windows.
  if (normalized.startsWith("gpt-5")) {
    return 272000;
  }

  // Claude family default context is typically 200k.
  if (normalized.startsWith("claude-")) {
    return 200000;
  }

  return null;
}

export function toBase64Utf8(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function sanitizeTomlKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "custom";
}

export function normalizeModelCode(provider: ProviderName, model: string) {
  const trimmed = model.trim();
  if (provider === "glm") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

const LOG_MARKDOWN_PLUGINS = [remarkGfm];
const LOG_MARKDOWN_SIGNAL_RE =
  /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~)|\[[^\]]+\]\([^)]+\)|\|.+\|/m;
const LARGE_LOG_BLOCK_THRESHOLD = 12000;

export const MarkdownLogBlock = memo(function MarkdownLogBlock({ value }: { value: string }) {
  const normalized = value.trim();
  if (!normalized) {
    return <div className="tc-log-markdown tc-log-markdown-empty">[empty]</div>;
  }
  const shouldUseMarkdown =
    normalized.length <= LARGE_LOG_BLOCK_THRESHOLD && LOG_MARKDOWN_SIGNAL_RE.test(normalized);
  if (!shouldUseMarkdown) {
    return <pre className="tc-log-markdown tc-log-markdown-plain">{normalized}</pre>;
  }
  return (
    <div className="tc-log-markdown">
      <ReactMarkdown remarkPlugins={LOG_MARKDOWN_PLUGINS} skipHtml>
        {normalized}
      </ReactMarkdown>
    </div>
  );
});

export function summarizeLogPreview(...values: string[]) {
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
  }
  return "";
}
