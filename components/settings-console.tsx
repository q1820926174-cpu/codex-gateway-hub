"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  WorkspaceHero,
  type WorkspaceHeroAction,
  type WorkspaceHeroStat
} from "@/components/console/workspace-hero";
import { JsonViewer } from "@/components/json-viewer";
import { useLocale, type LocaleCode } from "@/components/locale-provider";
import {
  Button,
  Card,
  Checkbox,
  DateRangePicker,
  Dialog,
  Input,
  Layout,
  MessagePlugin,
  Menu,
  Select,
  Switch,
  Tabs,
  Tag
} from "tdesign-react";
import {
  ApiIcon,
  ControlPlatformIcon,
  DashboardIcon,
  TimeIcon,
  UserCircleIcon,
  UserIcon
} from "tdesign-icons-react";
import type { EChartsOption } from "echarts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const PROVIDERS = ["openai", "anthropic", "openrouter", "xai", "deepseek", "glm", "doubao", "custom"] as const;
type ProviderName = (typeof PROVIDERS)[number];

const UPSTREAM_WIRE_APIS = ["responses", "chat_completions", "anthropic_messages"] as const;
type UpstreamWireApi = (typeof UPSTREAM_WIRE_APIS)[number];

const PROVIDER_DEFAULT_BASE_URL: Record<Exclude<ProviderName, "custom">, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api",
  xai: "https://api.x.ai",
  deepseek: "https://api.deepseek.com",
  glm: "https://open.bigmodel.cn/api/coding/paas/v4",
  doubao: "https://ark.cn-beijing.volces.com/api/coding/v3"
};

const PROVIDER_META: Record<ProviderName, { label: string; tip: string }> = {
  openai: { label: "OpenAI", tip: "国际通用生态" },
  anthropic: { label: "Anthropic", tip: "Claude 官方协议" },
  openrouter: { label: "OpenRouter", tip: "聚合多家模型" },
  xai: { label: "xAI", tip: "Grok 体系" },
  deepseek: { label: "DeepSeek", tip: "高性价比" },
  glm: { label: "GLM", tip: "智谱开放平台" },
  doubao: { label: "豆包", tip: "火山方舟" },
  custom: { label: "自定义", tip: "兼容 OpenAI 或 Anthropic 格式" }
};

const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:3000";

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
const OPENAI_GREEN = "#10a37f";
const OPENAI_SLATE = "#334155";
const OPENAI_SOFT = "#94a3b8";
const USAGE_RANGE_OPTIONS = [
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 }
] as const;
const USAGE_METRIC_META: Record<
  UsageMetricKey,
  { label: string; shortLabel: string; color: string; isToken: boolean }
> = {
  requestCount: { label: "请求数", shortLabel: "请求", color: OPENAI_SLATE, isToken: false },
  promptTokens: { label: "输入 Token", shortLabel: "输入", color: OPENAI_GREEN, isToken: true },
  completionTokens: { label: "输出 Token", shortLabel: "输出", color: OPENAI_SOFT, isToken: true },
  totalTokens: { label: "Total Token", shortLabel: "总量", color: "#0f172a", isToken: true }
};
const CN_MINUTE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai"
});
const EMPTY_AI_CALL_STATS: AiCallLogStats = {
  matched: 0,
  main: 0,
  visionFallback: 0,
  visionByModel: [],
  visionByKey: []
};

const LOCALE_OPTIONS: Array<{ label: string; value: LocaleCode }> = [
  { label: "中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
];

export type EditorModule = "access" | "upstream" | "runtime" | "logs" | "calls" | "usage" | "docs";
type SettingsConsoleProps = {
  module?: EditorModule;
};

const MODULE_LABEL: Record<EditorModule, { zh: string; en: string }> = {
  access: { zh: "基础接入", en: "Access" },
  upstream: { zh: "上游渠道", en: "Upstreams" },
  runtime: { zh: "运行时调度", en: "Runtime" },
  logs: { zh: "请求日志", en: "Request Logs" },
  calls: { zh: "AI 调用日志", en: "AI Call Logs" },
  usage: { zh: "用量报表", en: "Usage Report" },
  docs: { zh: "接口文档", en: "API Docs" }
};

const MODULE_SUMMARY: Record<EditorModule, { zh: string; en: string }> = {
  access: {
    zh: "管理本地 Key 鉴权、映射策略和调用方入口。",
    en: "Manage local key auth, mappings, and client-facing entry points."
  },
  upstream: {
    zh: "维护上游供应商、模型池和视觉兜底通道。",
    en: "Maintain upstream providers, model pools, and fallback vision routing."
  },
  runtime: {
    zh: "在线切换模型、覆盖默认值并实时启停 Key。",
    en: "Switch models online, override defaults, and toggle keys in runtime."
  },
  logs: {
    zh: "排查网关请求链路，查看请求体、响应体和错误。",
    en: "Inspect request chains with payloads, responses, and errors."
  },
  calls: {
    zh: "追踪真实模型调用，核对系统提示词与结果。",
    en: "Trace actual model invocations with prompts and outputs."
  },
  usage: {
    zh: "按 Key / 模型 / 时间段观察 Token 消耗趋势。",
    en: "Track token consumption by key, model, and time buckets."
  },
  docs: {
    zh: "查看网关与管理接口文档，复制即用示例。",
    en: "Browse gateway/ops API docs and copy ready-to-run examples."
  }
};

type ApiDocEndpoint = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  zh: string;
  en: string;
};

const API_DOC_GATEWAY_ENDPOINTS: ApiDocEndpoint[] = [
  {
    method: "POST",
    path: "/v1/chat/completions",
    zh: "OpenAI Chat Completions 兼容（别名：/api/v1/chat/completions）",
    en: "OpenAI Chat Completions compatible (alias: /api/v1/chat/completions)"
  },
  {
    method: "POST",
    path: "/v1/completions",
    zh: "OpenAI Completions 兼容（别名：/api/v1/completions）",
    en: "OpenAI Completions compatible (alias: /api/v1/completions)"
  },
  {
    method: "POST",
    path: "/v1/responses",
    zh: "OpenAI Responses 兼容（别名：/api/v1/responses）",
    en: "OpenAI Responses compatible (alias: /api/v1/responses)"
  },
  {
    method: "POST",
    path: "/v1/messages",
    zh: "Anthropic Messages 兼容（别名：/api/v1/messages）",
    en: "Anthropic Messages compatible (alias: /api/v1/messages)"
  }
];

const API_DOC_MANAGEMENT_ENDPOINTS: ApiDocEndpoint[] = [
  { method: "GET", path: "/api/health", zh: "健康检查", en: "Health check" },
  { method: "GET", path: "/api/config", zh: "配置摘要", en: "Config summary" },
  { method: "PUT", path: "/api/config", zh: "已废弃（返回 410）", en: "Deprecated (returns 410)" },
  { method: "GET", path: "/api/keys", zh: "Key 列表", en: "List keys" },
  { method: "POST", path: "/api/keys", zh: "创建 Key", en: "Create key" },
  { method: "GET", path: "/api/keys/:id", zh: "查询 Key", en: "Get key" },
  { method: "PUT", path: "/api/keys/:id", zh: "更新 Key", en: "Update key" },
  { method: "DELETE", path: "/api/keys/:id", zh: "删除 Key", en: "Delete key" },
  { method: "GET", path: "/api/upstreams", zh: "渠道列表", en: "List upstream channels" },
  { method: "POST", path: "/api/upstreams", zh: "创建渠道", en: "Create upstream channel" },
  { method: "GET", path: "/api/upstreams/:id", zh: "查询渠道", en: "Get upstream channel" },
  { method: "PUT", path: "/api/upstreams/:id", zh: "更新渠道", en: "Update upstream channel" },
  { method: "DELETE", path: "/api/upstreams/:id", zh: "删除渠道", en: "Delete upstream channel" },
  { method: "POST", path: "/api/upstreams/test", zh: "测试上游连通", en: "Test upstream connectivity" },
  { method: "POST", path: "/api/keys/test-upstream", zh: "按 Key 测试上游", en: "Test upstream by key" },
  { method: "GET", path: "/api/keys/switch-model", zh: "查询运行时状态", en: "Get runtime switch status" },
  { method: "POST", path: "/api/keys/switch-model", zh: "运行时切模/启停", en: "Switch runtime model or enable/disable key" },
  { method: "GET", path: "/api/usage", zh: "用量报表", en: "Usage report" },
  { method: "DELETE", path: "/api/usage", zh: "清空用量", en: "Clear usage events" },
  { method: "GET", path: "/api/logs", zh: "访问日志", en: "API access logs" },
  { method: "DELETE", path: "/api/logs", zh: "清空访问日志", en: "Clear API access logs" },
  { method: "GET", path: "/api/call-logs", zh: "AI 调用日志", en: "AI call logs" },
  { method: "DELETE", path: "/api/call-logs", zh: "清空 AI 调用日志", en: "Clear AI call logs" },
  { method: "POST", path: "/api/secret-entry", zh: "提交入口暗号", en: "Submit entry secret" },
  { method: "DELETE", path: "/api/secret-entry", zh: "清除入口暗号", en: "Clear entry secret cookie" }
];

type UpstreamModelConfig = {
  id: string;
  name: string;
  aliasModel: string | null;
  model: string;
  upstreamWireApi: UpstreamWireApi;
  supportsVision: boolean;
  visionChannelId: number | null;
  visionModel: string | null;
  enabled: boolean;
};

type KeyModelMapping = {
  id: string;
  clientModel: string;
  targetModel: string;
  enabled: boolean;
};

type GatewayKey = {
  id: number;
  name: string;
  localKey: string;
  upstreamChannelId: number | null;
  upstreamChannelName: string | null;
  provider: ProviderName;
  upstreamWireApi: UpstreamWireApi;
  wireApi: string;
  upstreamBaseUrl: string;
  hasUpstreamApiKey: boolean;
  upstreamModels: UpstreamModelConfig[];
  modelMappings: KeyModelMapping[];
  defaultModel: string;
  supportsVision: boolean;
  visionModel: string | null;
  dynamicModelSwitch: boolean;
  contextSwitchThreshold: number;
  contextOverflowModel: string | null;
  activeModelOverride: string | null;
  timeoutMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type UpstreamChannel = {
  id: number;
  name: string;
  provider: ProviderName;
  upstreamWireApi: UpstreamWireApi;
  upstreamBaseUrl: string;
  hasUpstreamApiKey: boolean;
  upstreamModels: UpstreamModelConfig[];
  defaultModel: string;
  supportsVision: boolean;
  visionModel: string | null;
  timeoutMs: number;
  enabled: boolean;
  keyCount: number;
  createdAt: string;
  updatedAt: string;
};

type KeysResponse = {
  items: GatewayKey[];
  wireApi: string;
};

type ChannelsResponse = {
  items: UpstreamChannel[];
  providers: ProviderName[];
  upstreamWireApis: UpstreamWireApi[];
};

type ApiLogEntry = {
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

type AiCallLogEntry = {
  id: string;
  keyId: number;
  keyName: string;
  route: string;
  requestWireApi: string;
  upstreamWireApi: string;
  requestedModel: string;
  clientModel: string;
  upstreamModel: string;
  callType: "main" | "vision_fallback";
  stream: boolean;
  systemPrompt: string;
  userPrompt: string;
  assistantResponse: string;
  images?: Array<{
    sourceType: "data_url" | "remote_url" | "unsupported";
    source: string;
    savedUrl: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    error?: string;
  }>;
  createdAt: string;
};

type AiCallLogStats = {
  matched: number;
  main: number;
  visionFallback: number;
  visionByModel: Array<{ model: string; count: number }>;
  visionByKey: Array<{ keyId: number; keyName: string; count: number }>;
};

type UsageSummaryRow = {
  keyId: number;
  keyName: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type UsageModelRow = UsageSummaryRow & {
  model: string;
};

type UsageTimelineRow = UsageModelRow & {
  minute: string;
};

type UsageReport = {
  windowMinutes: number;
  keyId: number | null;
  generatedAt: string;
  rangeFrom?: string;
  rangeTo?: string;
  summary: {
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    uniqueKeys: number;
    uniqueModels: number;
  };
  perKey: UsageSummaryRow[];
  perModel: UsageModelRow[];
  timeline: UsageTimelineRow[];
};

type UsageMetricKey = "requestCount" | "promptTokens" | "completionTokens" | "totalTokens";
type UsageBucketMode = "auto" | "1" | "5" | "15" | "60";

type KeyFormState = {
  name: string;
  localKey: string;
  upstreamChannelId: number | null;
  modelMappings: KeyModelMapping[];
  dynamicModelSwitch: boolean;
  contextSwitchThreshold: number;
  contextOverflowModel: string;
  enabled: boolean;
};

type ChannelFormState = {
  name: string;
  provider: ProviderName;
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  clearUpstreamApiKey: boolean;
  timeoutMs: number;
  enabled: boolean;
  defaultModel: string;
  upstreamModels: UpstreamModelConfig[];
};

type CodingPreset = {
  id: "glm-coding" | "doubao-coding";
  label: string;
  provider: ProviderName;
  upstreamBaseUrl: string;
  defaultModel: string;
  upstreamWireApi: UpstreamWireApi;
  supportsVision: boolean;
  visionModel: string | null;
};

const CODING_PRESETS: CodingPreset[] = [
  {
    id: "glm-coding",
    label: "GLM 国内编程套餐建议",
    provider: "glm",
    upstreamBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    defaultModel: "glm-5",
    upstreamWireApi: "chat_completions",
    supportsVision: true,
    visionModel: null
  },
  {
    id: "doubao-coding",
    label: "豆包编程套餐建议",
    provider: "doubao",
    upstreamBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    defaultModel: "doubao-seed-2.0-code",
    upstreamWireApi: "chat_completions",
    supportsVision: true,
    visionModel: null
  }
];

function generateLocalKey() {
  const random = crypto.getRandomValues(new Uint8Array(24));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk-${suffix}`;
}

function generateModelId() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `mdl_${suffix}`;
}

function generateMappingId() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `map_${suffix}`;
}

function createUpstreamModelDraft(
  overrides: Partial<UpstreamModelConfig> = {}
): UpstreamModelConfig {
  return {
    id: overrides.id ?? generateModelId(),
    name: overrides.name ?? "默认模型",
    aliasModel: overrides.aliasModel ?? null,
    model: overrides.model ?? "gpt-4.1-mini",
    upstreamWireApi: overrides.upstreamWireApi ?? "responses",
    supportsVision: overrides.supportsVision ?? true,
    visionChannelId: overrides.visionChannelId ?? null,
    visionModel: overrides.visionModel ?? null,
    enabled: overrides.enabled ?? true
  };
}

function createEmptyKeyFormState(): KeyFormState {
  return {
    name: "new-local-key",
    localKey: generateLocalKey(),
    upstreamChannelId: null,
    modelMappings: [],
    dynamicModelSwitch: false,
    contextSwitchThreshold: 12000,
    contextOverflowModel: "",
    enabled: true
  };
}

function createEmptyChannelFormState(): ChannelFormState {
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

function syncChannelFormWithModelPool(form: ChannelFormState): ChannelFormState {
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

function toKeyForm(key: GatewayKey): KeyFormState {
  return {
    name: key.name,
    localKey: key.localKey,
    upstreamChannelId: key.upstreamChannelId,
    modelMappings:
      key.modelMappings?.map((item) => ({
        id: item.id || generateMappingId(),
        clientModel: item.clientModel,
        targetModel: item.targetModel,
        enabled: item.enabled
      })) ?? [],
    dynamicModelSwitch: key.dynamicModelSwitch,
    contextSwitchThreshold: key.contextSwitchThreshold,
    contextOverflowModel: key.contextOverflowModel ?? "",
    enabled: key.enabled
  };
}

function toChannelForm(channel: UpstreamChannel): ChannelFormState {
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
            visionChannelId: item.visionChannelId ?? null
          }))
        : [
            createUpstreamModelDraft({
              aliasModel: null,
              model: channel.defaultModel,
              upstreamWireApi: channel.upstreamWireApi,
              supportsVision: channel.supportsVision,
              visionChannelId: null,
              visionModel: channel.visionModel
            })
          ]
  });
}

function formatCnDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return CN_DATE_FORMATTER.format(date);
}

function formatNumber(value: number) {
  return NUMBER_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatMinuteLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return CN_MINUTE_FORMATTER.format(date);
}

function formatCompactNumber(value: number) {
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

function pickUsageMetricValue(
  row: Pick<UsageTimelineRow, UsageMetricKey>,
  metric: UsageMetricKey
) {
  return Number(row[metric] ?? 0);
}

function resolveUsageBucketMinutes(minutes: number, mode: UsageBucketMode) {
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

function maskLocalKey(localKey: string) {
  if (localKey.length <= 16) {
    return localKey;
  }
  return `${localKey.slice(0, 10)}...${localKey.slice(-4)}`;
}

function normalizeSelectValue(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return String(value ?? "");
}

function toBase64Utf8(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function sanitizeTomlKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "custom";
}

function normalizeModelCode(provider: ProviderName, model: string) {
  const trimmed = model.trim();
  if (provider === "glm") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function MarkdownLogBlock({ value }: { value: string }) {
  const normalized = value.trim();
  if (!normalized) {
    return <div className="tc-log-markdown tc-log-markdown-empty">[empty]</div>;
  }
  return (
    <div className="tc-log-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export function SettingsConsole({ module = "access" }: SettingsConsoleProps) {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const routeModule = module;

  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [channels, setChannels] = useState<UpstreamChannel[]>([]);
  const [wireApi, setWireApi] = useState("responses");

  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);

  const [keyForm, setKeyForm] = useState<KeyFormState>(() => createEmptyKeyFormState());
  const [channelForm, setChannelForm] = useState<ChannelFormState>(() => createEmptyChannelFormState());

  const [runtimeModel, setRuntimeModel] = useState("");
  const [syncDefaultModel, setSyncDefaultModel] = useState(false);
  const [testPrompt, setTestPrompt] = useState("请只回复：upstream_test_ok");
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);
  const [logLimit, setLogLimit] = useState(100);
  const [aiCallLogs, setAiCallLogs] = useState<AiCallLogEntry[]>([]);
  const [loadingAiCallLogs, setLoadingAiCallLogs] = useState(false);
  const [autoRefreshAiCallLogs, setAutoRefreshAiCallLogs] = useState(true);
  const [aiCallLogLimit, setAiCallLogLimit] = useState(100);
  const [aiCallKeyFilter, setAiCallKeyFilter] = useState<number | null>(null);
  const [aiCallModelFilter, setAiCallModelFilter] = useState("");
  const [aiCallTypeFilter, setAiCallTypeFilter] = useState<"" | "main" | "vision_fallback">("");
  const [aiCallModelOptions, setAiCallModelOptions] = useState<string[]>([]);
  const [aiCallStats, setAiCallStats] = useState<AiCallLogStats>(EMPTY_AI_CALL_STATS);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [autoRefreshUsage, setAutoRefreshUsage] = useState(true);
  const [usageMinutes, setUsageMinutes] = useState(180);
  const [usageDateRange, setUsageDateRange] = useState<string[]>([]);
  const [usageMetric, setUsageMetric] = useState<UsageMetricKey>("totalTokens");
  const [usageBucketMode, setUsageBucketMode] = useState<UsageBucketMode>("auto");
  const [usageTimelineLimit, setUsageTimelineLimit] = useState(600);
  const [usageKeyFilter, setUsageKeyFilter] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [testingUpstream, setTestingUpstream] = useState(false);

  const selectedKey = useMemo(
    () => keys.find((item) => item.id === selectedKeyId) ?? null,
    [keys, selectedKeyId]
  );
  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  );

  const selectedChannelForKey = useMemo(
    () => channels.find((item) => item.id === keyForm.upstreamChannelId) ?? null,
    [channels, keyForm.upstreamChannelId]
  );
  const [gatewayOrigin, setGatewayOrigin] = useState(DEFAULT_GATEWAY_ORIGIN);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const origin = window.location.origin.replace(/\/+$/, "");
    if (origin) {
      setGatewayOrigin(origin);
    }
  }, []);

  const runtimeSwitchEndpoint = useMemo(() => {
    return `${gatewayOrigin}/api/keys/switch-model`;
  }, [gatewayOrigin]);
  const gatewayV1Endpoint = useMemo(() => {
    return `${gatewayOrigin}/v1`;
  }, [gatewayOrigin]);
  const runtimeDocLocalKey = useMemo(() => {
    const candidate = (selectedKey?.localKey ?? keyForm.localKey).trim();
    return candidate || "<your_local_key>";
  }, [keyForm.localKey, selectedKey?.localKey]);
  const runtimeDocModel = useMemo(() => {
    const candidate =
      runtimeModel.trim() ||
      selectedKey?.activeModelOverride?.trim() ||
      selectedKey?.defaultModel ||
      "gpt-4.1-mini";
    return candidate.trim() || "gpt-4.1-mini";
  }, [runtimeModel, selectedKey?.activeModelOverride, selectedKey?.defaultModel]);
  const runtimeApiExamples = useMemo(
    () => ({
      queryStatus: `curl -sS "${runtimeSwitchEndpoint}" \\
  -H "Authorization: Bearer ${runtimeDocLocalKey}"`,
      switchModel: `curl -sS -X POST "${runtimeSwitchEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${runtimeDocLocalKey}" \\
  -d '{
    "model": "${runtimeDocModel}",
    "syncDefaultModel": false
  }'`,
      clearOverride: `curl -sS -X POST "${runtimeSwitchEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${runtimeDocLocalKey}" \\
  -d '{
    "clear": true
  }'`,
      toggleEnabledById: `curl -sS -X POST "${runtimeSwitchEndpoint}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": ${selectedKey?.id ?? 1},
    "enabled": false
  }'`,
      payloadSchema: `{
  "id": 1,
  "localKey": "sk-...",
  "keyName": "${locale === "en-US" ? "prod-coding-gateway" : "质谱编程套餐"}",
  "model": "${runtimeDocModel}",
  "clear": false,
  "syncDefaultModel": false,
  "enabled": true
}`
    }),
    [locale, runtimeDocLocalKey, runtimeDocModel, runtimeSwitchEndpoint, selectedKey?.id]
  );
  const apiDocExamples = useMemo(
    () => ({
      chatCompletions: `curl -sS "${gatewayV1Endpoint}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${runtimeDocLocalKey}" \\
  -d '{
    "model": "${runtimeDocModel}",
    "messages": [
      {"role":"system","content":"You are concise."},
      {"role":"user","content":"Say hello in one line."}
    ]
  }'`,
      responses: `curl -sS "${gatewayV1Endpoint}/responses" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${runtimeDocLocalKey}" \\
  -d '{
    "model": "${runtimeDocModel}",
    "input": [
      {
        "role": "user",
        "content": [{"type":"input_text","text":"hello"}]
      }
    ]
  }'`,
      anthropicMessages: `curl -sS "${gatewayV1Endpoint}/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${runtimeDocLocalKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${runtimeDocModel}",
    "max_tokens": 512,
    "messages": [
      {"role":"user","content":"用一句话介绍你自己"}
    ]
  }'`
    }),
    [gatewayV1Endpoint, runtimeDocLocalKey, runtimeDocModel]
  );

  const isNewKey = selectedKeyId === null;
  const isNewChannel = selectedChannelId === null;
  const enabledKeyCount = useMemo(() => keys.filter((item) => item.enabled).length, [keys]);
  const enabledChannelCount = useMemo(
    () => channels.filter((item) => item.enabled).length,
    [channels]
  );

  const keySelectOptions = useMemo(
    () => [
      { label: `+ ${t("新建本地 Key", "New Local Key")}`, value: "__new__" },
      ...keys.map((item) => ({
        label: `${item.name} · ${maskLocalKey(item.localKey)}`,
        value: String(item.id)
      }))
    ],
    [keys, t]
  );

  const channelSelectOptions = useMemo(
    () => [
      { label: `+ ${t("新建上游渠道", "New Upstream")}`, value: "__new__" },
      ...channels.map((item) => ({
        label: `${item.name} · ${PROVIDER_META[item.provider].label} · ${t("模型", "models")}${item.upstreamModels.length}`,
        value: String(item.id)
      }))
    ],
    [channels, t]
  );

  const keyBindChannelOptions = useMemo(
    () =>
      channels.map((item) => ({
        label: `${item.name} · ${PROVIDER_META[item.provider].label}`,
        value: String(item.id)
      })),
    [channels]
  );

  const usageKeyOptions = useMemo(
    () => [
      { label: t("全部 Key", "All Keys"), value: "__all__" },
      ...keys.map((item) => ({
        label: `${item.name} · ${maskLocalKey(item.localKey)}`,
        value: String(item.id)
      }))
    ],
    [keys, t]
  );

  const aiCallKeyOptions = useMemo(
    () => [
      { label: t("全部 Key", "All Keys"), value: "__all__" },
      ...keys.map((item) => ({
        label: `${item.name} · ${maskLocalKey(item.localKey)}`,
        value: String(item.id)
      }))
    ],
    [keys, t]
  );

  const aiCallModelSelectOptions = useMemo(
    () => [
      { label: t("全部模型", "All Models"), value: "__all__" },
      ...aiCallModelOptions.map((model) => ({
        label: model,
        value: model
      }))
    ],
    [aiCallModelOptions, t]
  );

  const aiCallTypeOptions = useMemo(
    () => [
      { label: t("全部调用", "All Calls"), value: "__all__" },
      { label: t("主调用", "Main Calls"), value: "main" },
      { label: t("辅助视觉", "Vision Fallback"), value: "vision_fallback" }
    ],
    [t]
  );

  const resolvedUsageBucketMinutes = useMemo(
    () => resolveUsageBucketMinutes(usageMinutes, usageBucketMode),
    [usageMinutes, usageBucketMode]
  );

  const usagePrimaryMetricMeta = useMemo(() => USAGE_METRIC_META[usageMetric], [usageMetric]);
  const hasCustomUsageDateRange = Boolean(
    usageDateRange[0]?.trim() && usageDateRange[1]?.trim()
  );
  const usageRangeTagLabel = hasCustomUsageDateRange
    ? `${t("范围", "Range")} ${usageDateRange[0]} ~ ${usageDateRange[1]}`
    : `${t("窗口", "Window")} ${usageMinutes} ${t("分钟", "minutes")}`;

  const usageTimelinePoints = useMemo(() => {
    if (!usageReport || usageReport.timeline.length === 0) {
      return [];
    }
    const bucketMs = Math.max(1, resolvedUsageBucketMinutes) * 60_000;
    const minuteMap = new Map<
      string,
      { minute: string; requestCount: number; promptTokens: number; completionTokens: number; totalTokens: number }
    >();

    for (const row of usageReport.timeline) {
      const minuteDate = new Date(row.minute);
      if (Number.isNaN(minuteDate.getTime())) {
        continue;
      }
      const bucketStart = Math.floor(minuteDate.getTime() / bucketMs) * bucketMs;
      const bucketMinute = new Date(bucketStart).toISOString();

      const current = minuteMap.get(bucketMinute) ?? {
        minute: bucketMinute,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      };
      current.requestCount += row.requestCount;
      current.promptTokens += row.promptTokens;
      current.completionTokens += row.completionTokens;
      current.totalTokens += row.totalTokens;
      minuteMap.set(bucketMinute, current);
    }

    return Array.from(minuteMap.values()).sort((a, b) => a.minute.localeCompare(b.minute));
  }, [resolvedUsageBucketMinutes, usageReport]);

  const usageTimelineChartOption = useMemo<EChartsOption | null>(() => {
    if (!usageTimelinePoints.length) {
      return null;
    }
    const metricLabel = usagePrimaryMetricMeta.label;
    const isTokenMetric = usagePrimaryMetricMeta.isToken;

    return {
      color: [usagePrimaryMetricMeta.color],
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc"
        },
        valueFormatter: (value) =>
          typeof value === "number" ? formatCompactNumber(value) : String(value ?? "")
      },
      legend: {
        top: 6,
        textStyle: {
          color: "#475569"
        }
      },
      grid: {
        left: 56,
        right: 24,
        top: 44,
        bottom: 52
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        axisLine: {
          lineStyle: {
            color: "#dbe3ef"
          }
        },
        axisLabel: {
          color: "#64748b",
          rotate: usageTimelinePoints.length > 20 ? 35 : 0
        },
        data: usageTimelinePoints.map((item) => formatMinuteLabel(item.minute))
      },
      yAxis: {
        type: "value",
        name: isTokenMetric ? "Token" : "请求",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatCompactNumber(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        },
        nameTextStyle: {
          color: "#64748b"
        }
      },
      dataZoom: usageTimelinePoints.length > 90 ? [{ type: "inside", start: 40, end: 100 }] : [],
      series: [
        {
          name: metricLabel,
          type: "line",
          smooth: 0.35,
          showSymbol: false,
          lineStyle: {
            width: 2
          },
          areaStyle: {
            opacity: 0.12
          },
          data: usageTimelinePoints.map((item) => pickUsageMetricValue(item, usageMetric))
        }
      ]
    };
  }, [usageMetric, usagePrimaryMetricMeta, usageTimelinePoints]);

  const usagePerKeyChartOption = useMemo<EChartsOption | null>(() => {
    if (!usageReport || usageReport.perKey.length === 0) {
      return null;
    }
    const topKeys = [...usageReport.perKey]
      .sort(
        (a, b) =>
          pickUsageMetricValue(b, usageMetric) - pickUsageMetricValue(a, usageMetric)
      )
      .slice(0, 12)
      .reverse();

    return {
      color: [usagePrimaryMetricMeta.color],
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        valueFormatter: (value) =>
          typeof value === "number" ? formatCompactNumber(value) : String(value ?? "")
      },
      grid: {
        left: 180,
        right: 24,
        top: 20,
        bottom: 28
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatCompactNumber(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        }
      },
      yAxis: {
        type: "category",
        axisLabel: {
          color: "#334155",
          formatter: (value: string) => (value.length > 24 ? `${value.slice(0, 24)}...` : value)
        },
        data: topKeys.map((item) => item.keyName)
      },
      series: [
        {
          name: usagePrimaryMetricMeta.label,
          type: "bar",
          barMaxWidth: 14,
          data: topKeys.map((item) => pickUsageMetricValue(item, usageMetric)),
          itemStyle: {
            borderRadius: [0, 6, 6, 0]
          }
        }
      ]
    };
  }, [usageMetric, usagePrimaryMetricMeta, usageReport]);

  const usagePerModelChartOption = useMemo<EChartsOption | null>(() => {
    if (!usageReport || usageReport.perModel.length === 0) {
      return null;
    }
    const topModels = [...usageReport.perModel]
      .sort(
        (a, b) =>
          pickUsageMetricValue(b, usageMetric) - pickUsageMetricValue(a, usageMetric)
      )
      .slice(0, 10)
      .reverse();

    return {
      color: [usagePrimaryMetricMeta.color],
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        valueFormatter: (value) =>
          typeof value === "number" ? formatCompactNumber(value) : String(value ?? "")
      },
      grid: {
        left: 200,
        right: 24,
        top: 20,
        bottom: 28
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatCompactNumber(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        }
      },
      yAxis: {
        type: "category",
        axisLabel: {
          color: "#334155",
          formatter: (value: string) => (value.length > 30 ? `${value.slice(0, 30)}...` : value)
        },
        data: topModels.map((item) => `${item.model} · ${item.keyName}`)
      },
      series: [
        {
          name: usagePrimaryMetricMeta.label,
          type: "bar",
          barMaxWidth: 14,
          data: topModels.map((item) => pickUsageMetricValue(item, usageMetric)),
          itemStyle: {
            borderRadius: [0, 6, 6, 0]
          },
          label: {
            show: true,
            position: "right",
            color: "#475569",
            formatter: (params: { value?: unknown }) => {
              const rawValue = params?.value;
              const value = Array.isArray(rawValue) ? Number(rawValue[0] ?? 0) : Number(rawValue ?? 0);
              return formatCompactNumber(value);
            }
          }
        }
      ]
    };
  }, [usageMetric, usagePrimaryMetricMeta, usageReport]);

  const channelModelOptions = useMemo(
    () =>
      channelForm.upstreamModels.map((item) => ({
        label: item.aliasModel
          ? `${item.name} · ${item.aliasModel} -> ${item.model}`
          : `${item.name} · ${item.model}`,
        value: item.model
      })),
    [channelForm.upstreamModels]
  );

  const keyOverflowModelOptions = useMemo(() => {
    if (!selectedChannelForKey) {
      return [];
    }
    return selectedChannelForKey.upstreamModels
      .filter((item) => item.enabled)
      .map((item) => ({
        label: item.aliasModel
          ? `${item.name} · ${item.aliasModel} -> ${item.model}`
          : `${item.name} · ${item.model}`,
        value: item.model
      }));
  }, [selectedChannelForKey]);

  const visionChannelOptions = useMemo(
    () => [
      { label: "当前渠道", value: "__self__" },
      ...channels
        .filter((item) => item.id !== selectedChannelId)
        .map((item) => ({
          label: `${item.name} · ${PROVIDER_META[item.provider].label}`,
          value: String(item.id)
        }))
    ],
    [channels, selectedChannelId]
  );

  function resolveVisionModelOptions(model: UpstreamModelConfig) {
    const sourceModels = model.visionChannelId
      ? channels.find((item) => item.id === model.visionChannelId)?.upstreamModels ?? []
      : channelForm.upstreamModels;
    return sourceModels
      .filter((item) => item.enabled)
      .map((item) => ({
        label: item.aliasModel
          ? `${item.name} · ${item.aliasModel} -> ${item.model}`
          : `${item.name} · ${item.model}`,
        value: item.model
      }));
  }

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedKey) {
      setRuntimeModel(selectedKey.activeModelOverride ?? selectedKey.defaultModel);
      return;
    }
    setRuntimeModel("");
  }, [selectedKey]);

  useEffect(() => {
    if (routeModule !== "logs") {
      return;
    }
    void loadApiLogs(true);
    if (!autoRefreshLogs) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadApiLogs(true);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeModule, autoRefreshLogs, logLimit]);

  useEffect(() => {
    if (routeModule !== "calls") {
      return;
    }
    void loadAiCallLogs(true);
    if (!autoRefreshAiCallLogs) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadAiCallLogs(true);
    }, 3000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeModule,
    autoRefreshAiCallLogs,
    aiCallLogLimit,
    aiCallKeyFilter,
    aiCallModelFilter,
    aiCallTypeFilter
  ]);

  useEffect(() => {
    if (routeModule !== "usage") {
      return;
    }
    void loadUsageReport(true);
    if (!autoRefreshUsage) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadUsageReport(true);
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeModule,
    autoRefreshUsage,
    usageMinutes,
    usageTimelineLimit,
    usageKeyFilter,
    usageDateRange[0],
    usageDateRange[1]
  ]);

  function notifySuccess(content: string) {
    MessagePlugin.success(content);
  }

  function notifyError(content: string) {
    MessagePlugin.error(content);
  }

  function notifyInfo(content: string) {
    MessagePlugin.info(content);
  }

  function statusTheme(status: number | null): "success" | "warning" | "danger" | "default" {
    if (status === null) {
      return "danger";
    }
    if (status >= 500) {
      return "danger";
    }
    if (status >= 400) {
      return "warning";
    }
    if (status >= 200 && status < 400) {
      return "success";
    }
    return "default";
  }

  function statusClassName(status: number | null): "ok" | "warn" | "err" {
    if (status === null || status >= 500) {
      return "err";
    }
    if (status >= 400) {
      return "warn";
    }
    return "ok";
  }

  async function bootstrap() {
    setLoading(true);
    try {
      await Promise.all([loadChannels(), loadKeys()]);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadKeys() {
    const response = await fetch("/api/keys", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`加载本地 Key 失败 (${response.status})`);
    }
    const data = (await response.json()) as KeysResponse;
    setKeys(data.items);
    setWireApi(data.wireApi);

    if (data.items.length === 0) {
      setSelectedKeyId(null);
      setKeyForm(createEmptyKeyFormState());
      return;
    }

    const nextSelectedId =
      selectedKeyId !== null && data.items.some((item) => item.id === selectedKeyId)
        ? selectedKeyId
        : data.items[0].id;
    const key = data.items.find((item) => item.id === nextSelectedId)!;
    setSelectedKeyId(key.id);
    setKeyForm(toKeyForm(key));
  }

  async function loadChannels() {
    const response = await fetch("/api/upstreams", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`加载上游渠道失败 (${response.status})`);
    }
    const data = (await response.json()) as ChannelsResponse;
    setChannels(data.items);

    if (data.items.length === 0) {
      setSelectedChannelId(null);
      setChannelForm(createEmptyChannelFormState());
      return;
    }

    const nextSelectedId =
      selectedChannelId !== null && data.items.some((item) => item.id === selectedChannelId)
        ? selectedChannelId
        : data.items[0].id;
    const channel = data.items.find((item) => item.id === nextSelectedId)!;
    setSelectedChannelId(channel.id);
    setChannelForm(toChannelForm(channel));
  }

  async function loadApiLogs(silent = false) {
    if (!silent) {
      setLoadingLogs(true);
    }
    try {
      const response = await fetch(`/api/logs?limit=${logLimit}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `加载日志失败 (${response.status})`);
      }
      const body = (await response.json()) as { items?: ApiLogEntry[] };
      setApiLogs(Array.isArray(body.items) ? body.items : []);
    } catch (err) {
      if (!silent) {
        notifyError(err instanceof Error ? err.message : "加载日志失败");
      }
    } finally {
      if (!silent) {
        setLoadingLogs(false);
      }
    }
  }

  async function clearApiLogs() {
    setLoadingLogs(true);
    try {
      const response = await fetch("/api/logs", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `清空日志失败 (${response.status})`);
      }
      setApiLogs([]);
      notifySuccess("请求日志已清空。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "清空日志失败");
    } finally {
      setLoadingLogs(false);
    }
  }

  async function loadAiCallLogs(silent = false) {
    if (!silent) {
      setLoadingAiCallLogs(true);
    }
    try {
      const params = new URLSearchParams({
        limit: String(aiCallLogLimit)
      });
      if (aiCallKeyFilter) {
        params.set("keyId", String(aiCallKeyFilter));
      }
      if (aiCallModelFilter.trim()) {
        params.set("model", aiCallModelFilter.trim());
      }
      if (aiCallTypeFilter) {
        params.set("callType", aiCallTypeFilter);
      }
      const response = await fetch(`/api/call-logs?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `加载 AI 调用日志失败 (${response.status})`);
      }
      const body = (await response.json()) as {
        items?: AiCallLogEntry[];
        models?: string[];
        stats?: AiCallLogStats;
      };
      setAiCallLogs(Array.isArray(body.items) ? body.items : []);
      setAiCallModelOptions(Array.isArray(body.models) ? body.models : []);
      setAiCallStats(body.stats ?? EMPTY_AI_CALL_STATS);
    } catch (err) {
      if (!silent) {
        notifyError(err instanceof Error ? err.message : "加载 AI 调用日志失败");
      }
    } finally {
      if (!silent) {
        setLoadingAiCallLogs(false);
      }
    }
  }

  async function clearAiCallLogs() {
    setLoadingAiCallLogs(true);
    try {
      const response = await fetch("/api/call-logs", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `清空 AI 调用日志失败 (${response.status})`);
      }
      setAiCallLogs([]);
      setAiCallModelOptions([]);
      setAiCallStats(EMPTY_AI_CALL_STATS);
      notifySuccess("AI 调用日志已清空。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "清空 AI 调用日志失败");
    } finally {
      setLoadingAiCallLogs(false);
    }
  }

  async function loadUsageReport(silent = false) {
    if (!silent) {
      setLoadingUsage(true);
    }
    try {
      const params = new URLSearchParams({
        minutes: String(usageMinutes),
        limit: String(usageTimelineLimit)
      });
      if (usageDateRange[0]?.trim() && usageDateRange[1]?.trim()) {
        params.set("from", usageDateRange[0].trim());
        params.set("to", usageDateRange[1].trim());
      }
      if (usageKeyFilter) {
        params.set("keyId", String(usageKeyFilter));
      }
      const response = await fetch(`/api/usage?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `加载用量报表失败 (${response.status})`);
      }
      const body = (await response.json()) as UsageReport;
      setUsageReport(body);
    } catch (err) {
      if (!silent) {
        notifyError(err instanceof Error ? err.message : "加载用量报表失败");
      }
    } finally {
      if (!silent) {
        setLoadingUsage(false);
      }
    }
  }

  async function clearUsageReport() {
    setLoadingUsage(true);
    try {
      const response = await fetch("/api/usage", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `清空用量报表失败 (${response.status})`);
      }
      setUsageReport((prev) =>
        prev
          ? {
              ...prev,
              generatedAt: new Date().toISOString(),
              summary: {
                requestCount: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                uniqueKeys: 0,
                uniqueModels: 0
              },
              perKey: [],
              perModel: [],
              timeline: []
            }
          : prev
      );
      notifySuccess("用量记录已清空。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "清空用量报表失败");
    } finally {
      setLoadingUsage(false);
    }
  }

  function createNewKeyDraft() {
    setSelectedKeyId(null);
    setKeyForm(createEmptyKeyFormState());
  }

  function openExistingKeyById(id: number) {
    const key = keys.find((item) => item.id === id);
    if (!key) {
      return;
    }
    setSelectedKeyId(key.id);
    setKeyForm(toKeyForm(key));
  }

  function createNewChannelDraft() {
    setSelectedChannelId(null);
    setChannelForm(createEmptyChannelFormState());
  }

  function openExistingChannelById(id: number) {
    const channel = channels.find((item) => item.id === id);
    if (!channel) {
      return;
    }
    setSelectedChannelId(channel.id);
    setChannelForm(toChannelForm(channel));
  }

  function applyProviderPreset(nextProvider: ProviderName) {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        provider: nextProvider,
        upstreamBaseUrl:
          nextProvider === "custom" ? prev.upstreamBaseUrl : PROVIDER_DEFAULT_BASE_URL[nextProvider]
      })
    );
  }

  function applyCodingPreset(preset: CodingPreset) {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        provider: preset.provider,
        upstreamBaseUrl: preset.upstreamBaseUrl,
        defaultModel: preset.defaultModel,
        upstreamModels: [
          createUpstreamModelDraft({
            name: "主模型",
            model: preset.defaultModel,
            upstreamWireApi: preset.upstreamWireApi,
            supportsVision: preset.supportsVision,
            visionModel: preset.visionModel
          })
        ]
      })
    );
    notifyInfo(`已应用：${preset.label}`);
  }

  function addUpstreamModel() {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: [
          ...prev.upstreamModels,
          createUpstreamModelDraft({
            name: `模型 ${prev.upstreamModels.length + 1}`,
            upstreamWireApi: "responses"
          })
        ]
      })
    );
  }

  function updateUpstreamModel(
    id: string,
    updater: (model: UpstreamModelConfig) => UpstreamModelConfig
  ) {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: prev.upstreamModels.map((item) => (item.id === id ? updater(item) : item))
      })
    );
  }

  function removeUpstreamModel(id: string) {
    setChannelForm((prev) => {
      const nextModels = prev.upstreamModels.filter((item) => item.id !== id);
      if (nextModels.length === 0) {
        return prev;
      }
      return syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: nextModels
      });
    });
  }

  function setChannelDefaultModel(model: string) {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        defaultModel: model
      })
    );
  }

  function addKeyModelMapping() {
    setKeyForm((prev) => ({
      ...prev,
      modelMappings: [
        ...prev.modelMappings,
        {
          id: generateMappingId(),
          clientModel: "",
          targetModel: selectedChannelForKey?.defaultModel ?? "",
          enabled: true
        }
      ]
    }));
  }

  function updateKeyModelMapping(
    id: string,
    updater: (mapping: KeyModelMapping) => KeyModelMapping
  ) {
    setKeyForm((prev) => ({
      ...prev,
      modelMappings: prev.modelMappings.map((item) => (item.id === id ? updater(item) : item))
    }));
  }

  function removeKeyModelMapping(id: string) {
    setKeyForm((prev) => ({
      ...prev,
      modelMappings: prev.modelMappings.filter((item) => item.id !== id)
    }));
  }

  async function saveKey() {
    setSavingKey(true);
    try {
      if (!keyForm.name.trim()) {
        throw new Error("请输入 Key 名称。");
      }
      if (!keyForm.localKey.trim()) {
        throw new Error("请输入本地 Key。");
      }
      if (!keyForm.upstreamChannelId) {
        throw new Error("请选择上游渠道。");
      }
      const overflowModel = keyForm.contextOverflowModel.trim();
      if (keyForm.dynamicModelSwitch && !overflowModel) {
        throw new Error("启用动态切模时，必须设置溢出模型。");
      }
      const modelMappings = keyForm.modelMappings
        .map((item) => ({
          id: item.id,
          clientModel: item.clientModel.trim(),
          targetModel: item.targetModel.trim(),
          enabled: item.enabled
        }))
        .filter((item) => item.clientModel && item.targetModel);

      const payload = {
        name: keyForm.name.trim(),
        localKey: keyForm.localKey.trim(),
        upstreamChannelId: keyForm.upstreamChannelId,
        modelMappings,
        dynamicModelSwitch: keyForm.dynamicModelSwitch,
        contextSwitchThreshold: Number(keyForm.contextSwitchThreshold),
        contextOverflowModel: overflowModel || undefined,
        clearContextOverflowModel: overflowModel.length === 0,
        enabled: keyForm.enabled
      };

      const url = isNewKey ? "/api/keys" : `/api/keys/${selectedKeyId}`;
      const method = isNewKey ? "POST" : "PUT";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `保存失败 (${response.status})`);
      }

      await loadKeys();
      notifySuccess(isNewKey ? "本地 Key 创建成功。" : "本地 Key 已更新。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingKey(false);
    }
  }

  async function deleteSelectedKey() {
    if (selectedKeyId === null) {
      return;
    }
    if (!window.confirm("确认删除当前本地 Key 吗？")) {
      return;
    }

    setSavingKey(true);
    try {
      const response = await fetch(`/api/keys/${selectedKeyId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `删除失败 (${response.status})`);
      }
      await loadKeys();
      notifySuccess("本地 Key 已删除。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSavingKey(false);
    }
  }

  async function saveChannel() {
    setSavingChannel(true);
    try {
      if (!channelForm.name.trim()) {
        throw new Error("请输入渠道名称。");
      }

      const upstreamModels = channelForm.upstreamModels.map((item) => ({
        ...item,
        name: item.name.trim(),
        aliasModel: item.aliasModel?.trim() || null,
        model: normalizeModelCode(channelForm.provider, item.model),
        visionChannelId: item.visionChannelId ?? null,
        visionModel: item.visionModel?.trim() || null
      }));
      if (upstreamModels.length === 0) {
        throw new Error("请至少配置一个上游模型。");
      }
      for (const item of upstreamModels) {
        if (!item.name) {
          throw new Error("模型展示名不能为空。");
        }
        if (!item.model) {
          throw new Error("模型 ID 不能为空。");
        }
        if (!item.supportsVision && !item.visionModel) {
          throw new Error(`模型「${item.name}」未开启视觉时必须设置视觉模型。`);
        }
        if (
          !item.supportsVision &&
          item.visionModel &&
          item.visionModel.trim() &&
          item.visionModel.trim() === item.model
        ) {
          throw new Error(`模型「${item.name}」的视觉模型不能与主模型相同，请配置跨模型辅助视觉。`);
        }
      }

      const normalizedDefaultModel = normalizeModelCode(
        channelForm.provider,
        channelForm.defaultModel
      );
      const defaultProfile =
        upstreamModels.find((item) => item.model === normalizedDefaultModel) ?? upstreamModels[0];
      const payload = {
        name: channelForm.name.trim(),
        provider: channelForm.provider,
        upstreamBaseUrl: channelForm.upstreamBaseUrl.trim(),
        upstreamApiKey: channelForm.upstreamApiKey.trim() || undefined,
        clearUpstreamApiKey: channelForm.clearUpstreamApiKey,
        timeoutMs: Number(channelForm.timeoutMs),
        enabled: channelForm.enabled,
        upstreamModels,
        defaultModel: defaultProfile.model,
        supportsVision: defaultProfile.supportsVision,
        visionModel: defaultProfile.supportsVision ? undefined : defaultProfile.visionModel ?? undefined
      };

      const url = isNewChannel ? "/api/upstreams" : `/api/upstreams/${selectedChannelId}`;
      const method = isNewChannel ? "POST" : "PUT";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => ({}))) as UpstreamChannel & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `保存失败 (${response.status})`);
      }

      await Promise.all([loadChannels(), loadKeys()]);
      setSelectedChannelId(body.id);
      setChannelForm(toChannelForm(body));
      notifySuccess(isNewChannel ? "上游渠道创建成功。" : "上游渠道已更新。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingChannel(false);
    }
  }

  async function deleteSelectedChannel() {
    if (selectedChannelId === null) {
      return;
    }
    if (!window.confirm("删除渠道后，绑定该渠道的 Key 将解除绑定。确认继续吗？")) {
      return;
    }

    setSavingChannel(true);
    try {
      const response = await fetch(`/api/upstreams/${selectedChannelId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `删除失败 (${response.status})`);
      }
      await Promise.all([loadChannels(), loadKeys()]);
      notifySuccess("上游渠道已删除。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSavingChannel(false);
    }
  }

  async function switchModel(clear: boolean) {
    if (selectedKeyId === null) {
      notifyError("请先选择本地 Key。");
      return;
    }
    if (!clear && !runtimeModel.trim()) {
      notifyError("请输入运行时模型。");
      return;
    }

    setSwitchingModel(true);
    try {
      const response = await fetch("/api/keys/switch-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selectedKeyId,
          model: clear ? undefined : runtimeModel.trim(),
          clear,
          syncDefaultModel
        })
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `切换失败 (${response.status})`);
      }

      await loadKeys();
      notifySuccess(clear ? "已清空运行时模型覆盖。" : "运行时模型切换成功。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "切换失败");
    } finally {
      setSwitchingModel(false);
    }
  }

  async function testUpstreamModel(targetModel?: UpstreamModelConfig) {
    setTestingUpstream(true);
    setTestingModelId(targetModel?.id ?? null);

    try {
      const modelToTest = normalizeModelCode(
        channelForm.provider,
        targetModel?.model ?? channelForm.defaultModel
      );
      const wireApiToTest = targetModel?.upstreamWireApi ?? "responses";
      if (!modelToTest) {
        throw new Error("请先填写测试模型。");
      }

      const response = await fetch("/api/upstreams/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId ?? undefined,
          provider: channelForm.provider,
          upstreamWireApi: wireApiToTest,
          upstreamBaseUrl: channelForm.upstreamBaseUrl,
          upstreamApiKey: channelForm.upstreamApiKey,
          clearUpstreamApiKey: channelForm.clearUpstreamApiKey,
          model: modelToTest,
          timeoutMs: Number(channelForm.timeoutMs),
          testPrompt
        })
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        latencyMs?: number;
        model?: string;
        endpoint?: string;
        responsePreview?: string;
        upstreamStatus?: number;
        upstreamPreview?: string;
      };

      if (!response.ok) {
        const statusDetail =
          typeof body.upstreamStatus === "number" ? ` (upstream ${body.upstreamStatus})` : "";
        const preview = body.upstreamPreview ? ` | ${body.upstreamPreview}` : "";
        throw new Error(`${body.error ?? `测试失败 (${response.status})`}${statusDetail}${preview}`);
      }

      const summary = `延迟 ${body.latencyMs ?? "-"}ms · 模型 ${body.model ?? modelToTest} · 端点 ${body.endpoint ?? "-"} · 返回 ${body.responsePreview ?? "-"}`;
      notifySuccess("上游模型测试通过。");
      notifyInfo(summary);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTestingUpstream(false);
      setTestingModelId(null);
    }
  }

  async function copyTextToClipboard(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(successMessage);
    } catch {
      notifyError(t("复制失败，请检查浏览器权限。", "Copy failed. Please check browser permissions."));
    }
  }

  async function copyLocalKey() {
    await copyTextToClipboard(keyForm.localKey, "本地 Key 已复制。");
  }

  function handleMenuRoute(next: string) {
    if (
      next === "access" ||
      next === "upstream" ||
      next === "runtime" ||
      next === "logs" ||
      next === "calls" ||
      next === "usage" ||
      next === "docs"
    ) {
      router.push(`/console/${next}`);
    }
  }

  function resolveCcSwitchProviderContext() {
    const localKey = keyForm.localKey.trim();
    if (!localKey) {
      throw new Error("本地 Key 为空，无法生成导入链接。");
    }

    const origin = gatewayOrigin;
    const endpoint = `${origin}/v1`;
    const modelProvider = selectedKey?.provider ?? selectedChannelForKey?.provider ?? "openai";
    const modelPool =
      selectedChannelForKey?.upstreamModels?.length
        ? selectedChannelForKey.upstreamModels
        : selectedKey?.upstreamModels ?? [];
    const preferredModel =
      selectedKey?.activeModelOverride?.trim() ||
      selectedKey?.defaultModel ||
      selectedChannelForKey?.defaultModel ||
      "gpt-4.1-mini";
    const matchedProfile =
      modelPool.find(
        (item) => item.model === preferredModel || item.aliasModel === preferredModel
      ) ?? modelPool.find((item) => item.enabled) ?? modelPool[0] ?? null;
    const model =
      matchedProfile?.aliasModel?.trim() ||
      normalizeModelCode(modelProvider, matchedProfile?.model ?? preferredModel);
    const providerName = (keyForm.name || "gateway").trim() || "gateway";

    return {
      localKey,
      origin,
      endpoint,
      model,
      providerName
    };
  }

  function buildCcSwitchCodexDeepLink() {
    const { localKey, origin, endpoint, model, providerName } = resolveCcSwitchProviderContext();
    const providerKey = sanitizeTomlKey(providerName);

    const codexConfigToml = [
      `model_provider = "${providerKey}"`,
      `model = "${model}"`,
      'model_reasoning_effort = "high"',
      "disable_response_storage = true",
      "",
      `[model_providers.${providerKey}]`,
      `name = "${providerKey}"`,
      `base_url = "${endpoint}"`,
      'wire_api = "responses"',
      "requires_openai_auth = true",
      ""
    ].join("\n");

    const inlineConfig = {
      auth: {
        OPENAI_API_KEY: localKey
      },
      config: codexConfigToml
    };
    const params = new URLSearchParams({
      resource: "provider",
      app: "codex",
      name: `${providerName} (Gateway)`,
      homepage: origin,
      endpoint,
      apiKey: localKey,
      model,
      notes: "Imported from Codex Gateway Hub",
      configFormat: "json",
      config: toBase64Utf8(JSON.stringify(inlineConfig)),
      enabled: "true"
    });

    return `ccswitch://v1/import?${params.toString()}`;
  }

  function buildCcSwitchClaudeDeepLink() {
    const { localKey, origin, endpoint, model, providerName } = resolveCcSwitchProviderContext();
    const anthropicBaseUrl = origin;
    const inlineConfig = {
      env: {
        ANTHROPIC_AUTH_TOKEN: localKey,
        ANTHROPIC_BASE_URL: anthropicBaseUrl,
        ANTHROPIC_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        CLAUDE_CODE_EFFORT_LEVEL: "high",
        MAX_THINKING_TOKENS: "8192"
      }
    };
    const params = new URLSearchParams({
      resource: "provider",
      app: "claude",
      name: `${providerName} (Gateway)`,
      homepage: origin,
      endpoint: anthropicBaseUrl,
      apiKey: localKey,
      model,
      haikuModel: model,
      sonnetModel: model,
      opusModel: model,
      notes: "Imported from Codex Gateway Hub",
      configFormat: "json",
      config: toBase64Utf8(JSON.stringify(inlineConfig)),
      enabled: "true"
    });

    return `ccswitch://v1/import?${params.toString()}`;
  }

  function buildCcSwitchClaudeThinkingPatch() {
    const { model } = resolveCcSwitchProviderContext();
    return JSON.stringify(
      {
        env: {
          ANTHROPIC_REASONING_MODEL: model,
          CLAUDE_CODE_EFFORT_LEVEL: "high",
          MAX_THINKING_TOKENS: "8192"
        }
      },
      null,
      2
    );
  }

  async function copyCcSwitchCodexDeepLink() {
    try {
      const link = buildCcSwitchCodexDeepLink();
      await copyTextToClipboard(link, t("Codex 导入链接已复制。", "Codex import link copied."));
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : t("复制 Codex 导入链接失败", "Failed to copy Codex import link")
      );
    }
  }

  function openCcSwitchCodexImport() {
    try {
      const link = buildCcSwitchCodexDeepLink();
      window.location.href = link;
      notifyInfo(t("正在尝试唤起 CC Switch Codex 导入。", "Trying to open CC Switch Codex import."));
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : t("唤起 CC Switch Codex 失败", "Failed to open CC Switch Codex")
      );
    }
  }

  async function copyCcSwitchClaudeDeepLink() {
    try {
      const link = buildCcSwitchClaudeDeepLink();
      await copyTextToClipboard(link, t("Claude Code 导入链接已复制。", "Claude Code import link copied."));
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Claude Code 导入链接失败", "Failed to copy Claude Code import link")
      );
    }
  }

  async function copyCcSwitchClaudeThinkingPatch() {
    try {
      const patch = buildCcSwitchClaudeThinkingPatch();
      await copyTextToClipboard(
        patch,
        t("Claude Thinking 补丁已复制。", "Claude thinking patch copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Claude Thinking 补丁失败", "Failed to copy Claude thinking patch")
      );
    }
  }

  function openCcSwitchClaudeImport() {
    try {
      const link = buildCcSwitchClaudeDeepLink();
      window.location.href = link;
      notifyInfo(
        t("正在尝试唤起 CC Switch Claude Code 导入。", "Trying to open CC Switch Claude Code import.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("唤起 CC Switch Claude Code 失败", "Failed to open CC Switch Claude Code")
      );
    }
  }

  const keySelectionValue = isNewKey ? "__new__" : String(selectedKeyId);
  const channelSelectionValue = isNewChannel ? "__new__" : String(selectedChannelId);
  const routeModuleTitle = t(MODULE_LABEL[routeModule].zh, MODULE_LABEL[routeModule].en);
  const routeModuleSummary = t(MODULE_SUMMARY[routeModule].zh, MODULE_SUMMARY[routeModule].en);
  const workspaceHeroStats: WorkspaceHeroStat[] = [
    {
      id: "keys",
      label: t("本地 Key", "Local Keys"),
      value: `${enabledKeyCount}/${keys.length}`,
      note: t("启用 / 总数", "Enabled / Total"),
      tone: "accent"
    },
    {
      id: "upstreams",
      label: t("上游渠道", "Upstreams"),
      value: `${enabledChannelCount}/${channels.length}`,
      note: t("启用 / 总数", "Enabled / Total"),
      tone: "success"
    },
    {
      id: "calls",
      label: t("最近匹配调用", "Matched Calls"),
      value: formatNumber(aiCallStats.matched),
      note: t("来自 AI 调用日志筛选结果", "From current AI call filters"),
      tone: routeModule === "calls" ? "accent" : "default"
    },
    {
      id: "tokens",
      label: "Total Token",
      value: formatCompactNumber(usageReport?.summary.totalTokens ?? 0),
      note: usageRangeTagLabel,
      tone: routeModule === "usage" ? "warning" : "default"
    }
  ];
  const workspaceHeroActions: WorkspaceHeroAction[] = [
    {
      id: "refresh-core",
      label: t("刷新核心配置", "Refresh Core Data"),
      note: t("同步本地 Key 与上游渠道", "Sync local keys and upstream channels"),
      onClick: () => void bootstrap(),
      disabled: loading
    }
  ];

  if (routeModule === "access" || routeModule === "runtime") {
    workspaceHeroActions.push({
      id: "new-key",
      label: t("新建本地 Key", "Create Local Key"),
      note: t("生成新的鉴权入口并配置映射", "Generate an auth entry with model mapping"),
      onClick: createNewKeyDraft,
      disabled: loading
    });
  }

  if (routeModule === "upstream") {
    workspaceHeroActions.push({
      id: "new-upstream",
      label: t("新建上游渠道", "Create Upstream"),
      note: t("新增供应商配置与模型池", "Add provider settings and model pool"),
      onClick: createNewChannelDraft,
      disabled: loading
    });
  }

  if (routeModule === "logs") {
    workspaceHeroActions.push({
      id: "refresh-logs",
      label: t("刷新请求日志", "Refresh Request Logs"),
      note: t("按当前筛选条件重新拉取", "Reload with current filters"),
      onClick: () => void loadApiLogs(),
      disabled: loadingLogs
    });
  }

  if (routeModule === "calls") {
    workspaceHeroActions.push({
      id: "refresh-calls",
      label: t("刷新调用日志", "Refresh AI Call Logs"),
      note: t("核对真实模型与调用类型", "Check actual model routes and call types"),
      onClick: () => void loadAiCallLogs(),
      disabled: loadingAiCallLogs
    });
  }

  if (routeModule === "usage") {
    workspaceHeroActions.push({
      id: "refresh-usage",
      label: t("刷新用量报表", "Refresh Usage"),
      note: t("按时间窗重新统计 Token", "Recalculate token usage by range"),
      onClick: () => void loadUsageReport(),
      disabled: loadingUsage
    });
  }

  if (routeModule === "docs") {
    workspaceHeroActions.push({
      id: "copy-base-url",
      label: t("复制网关地址", "Copy Gateway Base URL"),
      note: gatewayV1Endpoint,
      onClick: () =>
        void copyTextToClipboard(
          gatewayV1Endpoint,
          t("网关 Base URL 已复制。", "Gateway base URL copied.")
        )
    });
  }

  return (
    <div className="tc-console">
      <Layout className="tc-layout">
        <Layout.Aside width="232px" className="tc-aside">
          <div className="tc-brand">
            <div className="tc-brand-title">{t("Codex 模型网关", "Codex Gateway Hub")}</div>
            <div className="tc-brand-sub">{t("AI Gateway Workspace", "AI Gateway Workspace")}</div>
          </div>

          <Menu
            value={routeModule}
            className="tc-side-menu"
            expanded={["key-mgmt"]}
            onChange={(value) => handleMenuRoute(String(value))}
          >
            <Menu.MenuItem value="dashboard" icon={<DashboardIcon />} disabled>
              {t("工作台", "Dashboard")}
            </Menu.MenuItem>
            <Menu.SubMenu value="key-mgmt" title={t("Key 管理", "Key Management")} icon={<ControlPlatformIcon />}>
              <Menu.MenuItem value="access" icon={<UserIcon />}>
                {t("基础接入", "Access")}
              </Menu.MenuItem>
              <Menu.MenuItem value="upstream" icon={<ApiIcon />}>
                {t("上游渠道", "Upstreams")}
              </Menu.MenuItem>
              <Menu.MenuItem value="runtime" icon={<TimeIcon />} disabled={keys.length === 0}>
                {t("运行时调度", "Runtime")}
              </Menu.MenuItem>
              <Menu.MenuItem value="logs" icon={<ApiIcon />}>
                {t("请求日志", "Request Logs")}
              </Menu.MenuItem>
              <Menu.MenuItem value="calls" icon={<ApiIcon />}>
                {t("AI 调用日志", "AI Call Logs")}
              </Menu.MenuItem>
              <Menu.MenuItem value="usage" icon={<TimeIcon />}>
                {t("用量报表", "Usage Report")}
              </Menu.MenuItem>
              <Menu.MenuItem value="docs" icon={<ApiIcon />}>
                {t("接口文档", "API Docs")}
              </Menu.MenuItem>
            </Menu.SubMenu>
          </Menu>

          <div className="tc-aside-footer">
            {t("Key", "Keys")} {keys.length}/{enabledKeyCount} · {t("渠道", "Upstreams")} {channels.length}/{enabledChannelCount}
          </div>
        </Layout.Aside>

        <Layout className="tc-main">
          <Layout.Header className="tc-header" height="56px">
            <div className="tc-header-left">
              <div className="tc-header-title-wrap">
                <div className="tc-header-title">{routeModuleTitle}</div>
                <div className="tc-header-subtitle">{routeModuleSummary}</div>
              </div>
            </div>
            <div className="tc-header-right">
              <Select
                value={locale}
                options={LOCALE_OPTIONS}
                style={{ width: 120 }}
                onChange={(value) => {
                  const next = normalizeSelectValue(value);
                  if (next === "zh-CN" || next === "en-US") {
                    setLocale(next);
                  }
                }}
              />
              <Button variant="text" shape="circle" icon={<UserCircleIcon />} />
            </div>
          </Layout.Header>

          <div className="tc-route-tabs">
            <Tabs
              value={routeModule}
              size="medium"
              theme="card"
              onChange={(value) => handleMenuRoute(String(value))}
            >
              <Tabs.TabPanel value="access" label={t("基础接入", "Access")} />
              <Tabs.TabPanel value="upstream" label={t("上游渠道", "Upstreams")} />
              <Tabs.TabPanel value="runtime" label={t("运行时调度", "Runtime")} disabled={keys.length === 0} />
              <Tabs.TabPanel value="logs" label={t("请求日志", "Request Logs")} />
              <Tabs.TabPanel value="calls" label={t("AI 调用日志", "AI Call Logs")} />
              <Tabs.TabPanel value="usage" label={t("用量报表", "Usage Report")} />
              <Tabs.TabPanel value="docs" label={t("接口文档", "API Docs")} />
            </Tabs>
          </div>

          <Layout.Content className="tc-content">
            <div className="tc-overview-zone">
              <WorkspaceHero
                title={t("网关工作台", "Gateway Workspace")}
                subtitle={routeModuleSummary}
                stats={workspaceHeroStats}
                actions={workspaceHeroActions}
                rightSlot={
                  <div className="tc-workspace-hero-tags">
                    <Tag variant="light-outline">{routeModuleTitle}</Tag>
                    <Tag variant="light-outline">wire_api={wireApi}</Tag>
                  </div>
                }
              />
            </div>

            <Card className="tc-panel" bordered>
              <div className="tc-toolbar">
                {routeModule === "logs" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("请求日志", "Request Logs")}</span>
                    <Tag variant="light-outline">{t("当前", "Current")} {apiLogs.length} {t("条", "items")}</Tag>
                    {loadingLogs ? <Tag theme="warning" variant="light-outline">{t("刷新中", "Refreshing")}</Tag> : null}
                  </div>
                ) : routeModule === "calls" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("AI 调用日志", "AI Call Logs")}</span>
                    <Tag variant="light-outline">{t("当前", "Current")} {aiCallLogs.length} {t("条", "items")}</Tag>
                    <Tag variant="light-outline">{t("匹配", "Matched")} {aiCallStats.matched}</Tag>
                    <Tag theme="warning" variant="light-outline">
                      {t("辅助视觉", "Vision Fallback")} {aiCallStats.visionFallback}
                    </Tag>
                    {loadingAiCallLogs ? (
                      <Tag theme="warning" variant="light-outline">
                        {t("刷新中", "Refreshing")}
                      </Tag>
                    ) : null}
                  </div>
                ) : routeModule === "usage" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("Token 用量报表", "Token Usage Report")}</span>
                    <Tag variant="light-outline">{usageRangeTagLabel}</Tag>
                    <Tag variant="light-outline">
                      {t("请求", "Requests")} {usageReport?.summary.requestCount ?? 0}
                    </Tag>
                    {loadingUsage ? <Tag theme="warning" variant="light-outline">{t("刷新中", "Refreshing")}</Tag> : null}
                  </div>
                ) : routeModule === "docs" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("接口文档", "API Docs")}</span>
                    <Tag variant="light-outline">{t("网关路由", "Gateway Routes")} {API_DOC_GATEWAY_ENDPOINTS.length}</Tag>
                    <Tag variant="light-outline">{t("管理路由", "Management Routes")} {API_DOC_MANAGEMENT_ENDPOINTS.length}</Tag>
                    <Tag variant="light-outline">{t("基础地址", "Base URL")} {gatewayV1Endpoint}</Tag>
                  </div>
                ) : routeModule === "upstream" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("上游渠道", "Upstreams")}</span>
                    <Select
                      value={channelSelectionValue}
                      options={channelSelectOptions}
                      style={{ width: 460 }}
                      onChange={(value) => {
                        const next = normalizeSelectValue(value);
                        if (next === "__new__") {
                          createNewChannelDraft();
                          return;
                        }
                        const id = Number(next);
                        if (!Number.isNaN(id)) {
                          openExistingChannelById(id);
                        }
                      }}
                    />
                    {selectedChannel ? (
                      <Tag theme={selectedChannel.enabled ? "success" : "default"} variant="light-outline">
                        {selectedChannel.enabled ? t("启用", "Enabled") : t("停用", "Disabled")}
                      </Tag>
                    ) : (
                      <Tag variant="light-outline">{t("新建草稿", "New Draft")}</Tag>
                    )}
                  </div>
                ) : (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("本地 Key", "Local Key")}</span>
                    <Select
                      value={keySelectionValue}
                      options={keySelectOptions}
                      style={{ width: 460 }}
                      onChange={(value) => {
                        const next = normalizeSelectValue(value);
                        if (next === "__new__") {
                          createNewKeyDraft();
                          return;
                        }
                        const id = Number(next);
                        if (!Number.isNaN(id)) {
                          openExistingKeyById(id);
                        }
                      }}
                    />
                    {selectedKey ? (
                      <Tag theme={selectedKey.enabled ? "success" : "default"} variant="light-outline">
                        {selectedKey.enabled ? t("启用", "Enabled") : t("停用", "Disabled")}
                      </Tag>
                    ) : (
                      <Tag variant="light-outline">{t("新建草稿", "New Draft")}</Tag>
                    )}
                  </div>
                )}

                <div className="tc-toolbar-right">
                  {routeModule === "upstream" ? (
                    <>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void bootstrap()}
                        disabled={loading}
                      >
                        {t("刷新", "Refresh")}
                      </Button>
                      <Button theme="primary" onClick={createNewChannelDraft}>
                        {t("新建渠道", "New Upstream")}
                      </Button>
                    </>
                  ) : routeModule === "access" || routeModule === "runtime" ? (
                    <>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void bootstrap()}
                        disabled={loading}
                      >
                        {t("刷新", "Refresh")}
                      </Button>
                      <Button theme="primary" onClick={createNewKeyDraft}>
                        {t("新建 Key", "New Key")}
                      </Button>
                    </>
                  ) : routeModule === "logs" ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void loadApiLogs()}
                      disabled={loadingLogs}
                    >
                      {t("刷新日志", "Refresh Logs")}
                    </Button>
                  ) : routeModule === "calls" ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void loadAiCallLogs()}
                      disabled={loadingAiCallLogs}
                    >
                      {t("刷新日志", "Refresh Logs")}
                    </Button>
                  ) : routeModule === "usage" ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void loadUsageReport()}
                      disabled={loadingUsage}
                    >
                      {t("刷新报表", "Refresh Report")}
                    </Button>
                  ) : routeModule === "docs" ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() =>
                        void copyTextToClipboard(
                          gatewayV1Endpoint,
                          t("网关 Base URL 已复制。", "Gateway base URL copied.")
                        )
                      }
                    >
                      {t("复制网关地址", "Copy Base URL")}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="tc-meta-row">
                <Tag variant="light-outline">wire_api={wireApi}</Tag>
                {routeModule === "logs" ? (
                  <>
                    <Tag variant="light-outline">logs={apiLogs.length}</Tag>
                    <Tag variant="light-outline">
                      latest={formatCnDate(apiLogs[0]?.createdAt ?? "")}
                    </Tag>
                  </>
                ) : routeModule === "calls" ? (
                  <>
                    <Tag variant="light-outline">calls={aiCallLogs.length}</Tag>
                    <Tag variant="light-outline">matched={aiCallStats.matched}</Tag>
                    <Tag variant="light-outline">main={aiCallStats.main}</Tag>
                    <Tag variant="light-outline">vision_fallback={aiCallStats.visionFallback}</Tag>
                    <Tag variant="light-outline">
                      latest={formatCnDate(aiCallLogs[0]?.createdAt ?? "")}
                    </Tag>
                  </>
                ) : routeModule === "usage" ? (
                  <>
                    <Tag variant="light-outline">
                      requests={usageReport?.summary.requestCount ?? 0}
                    </Tag>
                    <Tag variant="light-outline">
                      total_tokens={usageReport?.summary.totalTokens ?? 0}
                    </Tag>
                    <Tag variant="light-outline">
                      keys={usageReport?.summary.uniqueKeys ?? 0}
                    </Tag>
                    <Tag variant="light-outline">
                      updated={formatCnDate(usageReport?.generatedAt ?? "")}
                    </Tag>
                  </>
                ) : routeModule === "docs" ? (
                  <>
                    <Tag variant="light-outline">gateway_base={gatewayV1Endpoint}</Tag>
                    <Tag variant="light-outline">runtime_switch={runtimeSwitchEndpoint}</Tag>
                    <Tag variant="light-outline">auth=Authorization Bearer / x-api-key</Tag>
                  </>
                ) : routeModule === "upstream" ? (
                  <>
                    <Tag variant="light-outline">
                      provider={PROVIDER_META[channelForm.provider].label}
                    </Tag>
                    <Tag variant="light-outline">models={channelForm.upstreamModels.length}</Tag>
                    <Tag variant="light-outline">
                      bind_keys={selectedChannel?.keyCount ?? 0}
                    </Tag>
                    <Tag variant="light-outline">
                      updated={formatCnDate(selectedChannel?.updatedAt ?? "")}
                    </Tag>
                  </>
                ) : (
                  <>
                    <Tag variant="light-outline">channel={selectedKey?.upstreamChannelName ?? "-"}</Tag>
                    <Tag variant="light-outline">
                      provider={selectedKey ? PROVIDER_META[selectedKey.provider].label : "-"}
                    </Tag>
                    <Tag variant="light-outline">
                      updated={formatCnDate(selectedKey?.updatedAt ?? "")}
                    </Tag>
                  </>
                )}
              </div>

              {routeModule === "access" ? (
                <section className="tc-section">
                  <h3>{t("本地 Key 接入", "Local Key Access")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "one-api 风格：本地 Key 只负责鉴权与调度，上游连接在「上游渠道」模块独立维护。",
                      "one-api style: local key handles auth and scheduling only. Upstream connections are managed in the Upstreams module."
                    )}
                  </p>
                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("Key 名称", "Key Name")}</span>
                      <Input
                        value={keyForm.name}
                        onChange={(value) => setKeyForm((prev) => ({ ...prev, name: value }))}
                        placeholder={t("如：生产-客服网关", "e.g. prod-support-gateway")}
                        clearable
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("绑定上游渠道", "Bind Upstream")}</span>
                      <Select
                        value={keyForm.upstreamChannelId ? String(keyForm.upstreamChannelId) : undefined}
                        options={keyBindChannelOptions}
                        placeholder={t("请选择渠道", "Select upstream")}
                        onChange={(value) => {
                          const next = Number(normalizeSelectValue(value));
                          if (!Number.isNaN(next) && next > 0) {
                            setKeyForm((prev) => ({ ...prev, upstreamChannelId: next }));
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>{t("本地 Key（OpenAI 风格）", "Local Key (OpenAI style)")}</span>
                      <div className="tc-inline-actions">
                        <Input
                          value={keyForm.localKey}
                          onChange={(value) => setKeyForm((prev) => ({ ...prev, localKey: value }))}
                          placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                          clearable
                        />
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            setKeyForm((prev) => ({
                              ...prev,
                              localKey: generateLocalKey()
                            }))
                          }
                        >
                          {t("生成", "Generate")}
                        </Button>
                        <Button variant="outline" theme="default" onClick={() => void copyLocalKey()}>
                          {t("复制", "Copy")}
                        </Button>
                      </div>
                    </label>

                    <label className="tc-switchline">
                      <span>{t("按上下文长度自动切模", "Auto-switch by context length")}</span>
                      <Switch
                        value={keyForm.dynamicModelSwitch}
                        onChange={(value) =>
                          setKeyForm((prev) => ({
                            ...prev,
                            dynamicModelSwitch: Boolean(value)
                          }))
                        }
                      />
                    </label>

                    <label className="tc-switchline">
                      <span>{t("启用状态", "Enabled")}</span>
                      <Switch
                        value={keyForm.enabled}
                        onChange={(value) =>
                          setKeyForm((prev) => ({
                            ...prev,
                            enabled: Boolean(value)
                          }))
                        }
                      />
                    </label>

                    {keyForm.dynamicModelSwitch ? (
                      <>
                        <label className="tc-field">
                          <span>{t("切换阈值（输入 Token）", "Switch Threshold (prompt tokens)")}</span>
                          <Input
                            type="number"
                            value={String(keyForm.contextSwitchThreshold)}
                            onChange={(value) => {
                              const n = Number(value);
                              if (!Number.isNaN(n)) {
                                setKeyForm((prev) => ({
                                  ...prev,
                                  contextSwitchThreshold: n
                                }));
                              }
                            }}
                          />
                        </label>
                        <label className="tc-field">
                          <span>{t("溢出模型（超阈值切换）", "Overflow Model (above threshold)")}</span>
                          <Select
                            value={keyForm.contextOverflowModel || undefined}
                            options={keyOverflowModelOptions}
                            placeholder={t("请选择渠道中的模型", "Select a model from upstream")}
                            onChange={(value) =>
                              setKeyForm((prev) => ({
                                ...prev,
                                contextOverflowModel: normalizeSelectValue(value)
                              }))
                            }
                          />
                        </label>
                      </>
                    ) : null}
                  </div>

                  <div className="tc-actions-row">
                    <Tag variant="light-outline">{t("单 Key 内部模型映射（客户端 -> 内部）", "Single-key model mapping (client -> internal)")}</Tag>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={addKeyModelMapping}
                      disabled={!keyForm.upstreamChannelId}
                    >
                      {t("新增映射", "Add Mapping")}
                    </Button>
                  </div>

                  {keyForm.modelMappings.length > 0 ? (
                    <div className="tc-model-list">
                      {keyForm.modelMappings.map((item, index) => (
                        <div key={item.id} className="tc-model-item">
                          <div className="tc-model-head">
                            <strong>映射 #{index + 1}</strong>
                            <div className="tc-model-actions">
                              <span>{t("启用", "Enabled")}</span>
                              <Switch
                                value={item.enabled}
                                onChange={(value) =>
                                  updateKeyModelMapping(item.id, (prev) => ({
                                    ...prev,
                                    enabled: Boolean(value)
                                  }))
                                }
                              />
                              <Button
                                variant="outline"
                                theme="danger"
                                onClick={() => removeKeyModelMapping(item.id)}
                              >
                                {t("删除", "Delete")}
                              </Button>
                            </div>
                          </div>

                          <div className="tc-form-grid">
                            <label className="tc-field">
                              <span>{t("客户端模型名", "Client Model Name")}</span>
                              <Input
                                value={item.clientModel}
                                onChange={(value) =>
                                  updateKeyModelMapping(item.id, (prev) => ({
                                    ...prev,
                                    clientModel: value
                                  }))
                                }
                                placeholder={t("如：gpt-5.3-codex", "e.g. gpt-5.3-codex")}
                                clearable
                              />
                            </label>

                            <label className="tc-field">
                              <span>{t("内部模型名", "Internal Model Name")}</span>
                              <Input
                                value={item.targetModel}
                                onChange={(value) =>
                                  updateKeyModelMapping(item.id, (prev) => ({
                                    ...prev,
                                    targetModel: value
                                  }))
                                }
                                placeholder={t("如：glm-5 / gpt-4.1-mini", "e.g. glm-5 / gpt-4.1-mini")}
                                clearable
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="tc-upstream-advice">
                      {t(
                        "未配置映射时，客户端模型名按现有模型池（model/alias）直接解析。",
                        "Without mapping, client model names are resolved directly from current model pool (model/alias)."
                      )}
                    </p>
                  )}

                  {selectedChannelForKey ? (
                    <div className="tc-meta-row">
                      <Tag theme="primary" variant="light-outline">
                        {t("渠道供应商", "Upstream Provider")}: {PROVIDER_META[selectedChannelForKey.provider].label}
                      </Tag>
                      <Tag variant="light-outline">
                        {t("默认模型", "Default Model")}: {selectedChannelForKey.defaultModel}
                      </Tag>
                      <Tag variant="light-outline">
                        {t("协议", "Wire API")}: {selectedChannelForKey.upstreamWireApi}
                      </Tag>
                      <Tag variant="light-outline">
                        {t("上游地址", "Upstream URL")}: {selectedChannelForKey.upstreamBaseUrl}
                      </Tag>
                    </div>
                  ) : (
                    <p className="tc-tip err">{t("请先在「上游渠道」创建渠道，再回来绑定本地 Key。", "Create an upstream first, then bind local key here.")}</p>
                  )}

                  <p className="tc-upstream-advice">
                    {t("保存入口统一在本页底部，仅保留一个", "Save action is unified at bottom with one button")}「
                    {isNewKey ? t("创建 Key", "Create Key") : t("保存 Key", "Save Key")}」。
                  </p>
                  <p className="tc-tip">
                    {t(
                      "提示：CC Switch 当前 deep link 不会完整保留 Claude Thinking 变量。导入后可点“复制 Claude Thinking 补丁”，在 CC Switch 的 Claude 配置中补上。",
                      "Tip: CC Switch deep link currently does not fully preserve Claude thinking variables. After import, copy the Claude thinking patch and apply it in CC Switch Claude config."
                    )}
                  </p>

                  <div className="tc-actions-row">
                    <Button
                      theme="primary"
                      variant="outline"
                      onClick={openCcSwitchCodexImport}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("一键导入 CC Switch（Codex）", "One-click Import to CC Switch (Codex)")}
                    </Button>
                    <Button
                      theme="primary"
                      variant="outline"
                      onClick={openCcSwitchClaudeImport}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("一键导入 CC Switch（Claude Code）", "One-click Import to CC Switch (Claude Code)")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchCodexDeepLink()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Codex 导入链接", "Copy Codex Import Link")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchClaudeDeepLink()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Claude Code 导入链接", "Copy Claude Code Import Link")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchClaudeThinkingPatch()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Claude Thinking 补丁", "Copy Claude Thinking Patch")}
                    </Button>
                  </div>
                </section>
              ) : null}

              {routeModule === "upstream" ? (
                <section className="tc-section">
                  <h3>{t("上游渠道配置", "Upstream Configuration")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "渠道独立管理，可配置多模型池、视觉兜底模型与单模型连通测试。以下仅提供套餐建议，不做强制预设。",
                      "Manage upstreams independently with model pools, vision fallback, and per-model health checks. Suggestions only, no forced presets."
                    )}
                  </p>

                  <div className="tc-upstream-toolbar">
                    {CODING_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        variant="outline"
                        theme="default"
                        onClick={() => applyCodingPreset(preset)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button theme="primary" variant="outline" onClick={addUpstreamModel}>
                      {t("新增上游模型", "Add Upstream Model")}
                    </Button>
                  </div>

                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("渠道名称", "Upstream Name")}</span>
                      <Input
                        value={channelForm.name}
                        onChange={(value) => setChannelForm((prev) => ({ ...prev, name: value }))}
                        placeholder={t("如：openai-主线路", "e.g. openai-main")}
                        clearable
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("供应商", "Provider")}</span>
                      <Select
                        value={channelForm.provider}
                        options={PROVIDERS.map((provider) => ({
                          label: `${PROVIDER_META[provider].label} · ${PROVIDER_META[provider].tip}`,
                          value: provider
                        }))}
                        onChange={(value) => applyProviderPreset(normalizeSelectValue(value) as ProviderName)}
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>{t("上游 Base URL", "Upstream Base URL")}</span>
                      <Input
                        value={channelForm.upstreamBaseUrl}
                        onChange={(value) =>
                          setChannelForm((prev) => ({ ...prev, upstreamBaseUrl: value }))
                        }
                        placeholder="https://api.openai.com"
                        clearable
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>
                        {t("上游 API Key", "Upstream API Key")}{" "}
                        {selectedChannel?.hasUpstreamApiKey ? t("（已配置）", "(configured)") : t("（未配置）", "(not set)")}
                      </span>
                      <Input
                        type="password"
                        value={channelForm.upstreamApiKey}
                        onChange={(value) =>
                          setChannelForm((prev) => ({
                            ...prev,
                            upstreamApiKey: value,
                            clearUpstreamApiKey: false
                          }))
                        }
                        placeholder={isNewChannel ? t("请输入上游 Key", "Enter upstream API key") : t("留空表示不变", "Keep empty to keep unchanged")}
                        clearable
                      />
                    </label>

                    {!isNewChannel ? (
                      <label className="tc-checkline">
                        <Checkbox
                          checked={channelForm.clearUpstreamApiKey}
                          onChange={(checked) =>
                            setChannelForm((prev) => ({
                              ...prev,
                              clearUpstreamApiKey: checked,
                              upstreamApiKey: ""
                            }))
                          }
                        >
                          {t("清空渠道 API Key", "Clear Upstream API Key")}
                        </Checkbox>
                      </label>
                    ) : null}

                    <label className="tc-field">
                      <span>{t("请求超时（毫秒）", "Request Timeout (ms)")}</span>
                      <Input
                        type="number"
                        value={String(channelForm.timeoutMs)}
                        onChange={(value) => {
                          const n = Number(value);
                          if (!Number.isNaN(n)) {
                            setChannelForm((prev) => ({ ...prev, timeoutMs: n }));
                          }
                        }}
                      />
                    </label>

                    <label className="tc-switchline">
                      <span>{t("启用状态", "Enabled")}</span>
                      <Switch
                        value={channelForm.enabled}
                        onChange={(value) =>
                          setChannelForm((prev) => ({ ...prev, enabled: Boolean(value) }))
                        }
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("默认模型", "Default Model")}</span>
                      <Select
                        value={channelForm.defaultModel}
                        options={channelModelOptions}
                        onChange={(value) => setChannelDefaultModel(normalizeSelectValue(value))}
                      />
                    </label>
                  </div>

                  <div className="tc-model-list">
                    {channelForm.upstreamModels.map((item, index) => (
                      <div className="tc-model-item" key={item.id}>
                        <div className="tc-model-head">
                          <strong>{t("模型", "Model")} #{index + 1}</strong>
                          <div className="tc-model-actions">
                            <Button
                              variant="outline"
                              size="small"
                              onClick={() => setChannelDefaultModel(item.model)}
                              disabled={channelForm.defaultModel === item.model}
                            >
                              {channelForm.defaultModel === item.model ? t("当前默认", "Current Default") : t("设为默认", "Set Default")}
                            </Button>
                            <Button
                              variant="outline"
                              size="small"
                              loading={testingUpstream && testingModelId === item.id}
                              onClick={() => void testUpstreamModel(item)}
                              disabled={savingChannel || loading}
                            >
                              {t("测试", "Test")}
                            </Button>
                            <Button
                              theme="danger"
                              variant="text"
                              size="small"
                              disabled={channelForm.upstreamModels.length <= 1}
                              onClick={() => removeUpstreamModel(item.id)}
                            >
                              {t("删除", "Delete")}
                            </Button>
                          </div>
                        </div>

                        <div className="tc-form-grid">
                          <label className="tc-field">
                            <span>{t("展示名", "Display Name")}</span>
                            <Input
                              value={item.name}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  name: value
                                }))
                              }
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("对外模型名（别名）", "Public Model Name (Alias)")}</span>
                            <Input
                              value={item.aliasModel ?? ""}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  aliasModel: value
                                }))
                              }
                              placeholder={t("如：gpt-5.3-codex（可选）", "e.g. gpt-5.3-codex (optional)")}
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("模型 ID", "Model ID")}</span>
                            <Input
                              value={item.model}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  model: value
                                }))
                              }
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("协议", "Wire API")}</span>
                            <Select
                              value={item.upstreamWireApi}
                              options={UPSTREAM_WIRE_APIS.map((wireApi) => ({
                                label: wireApi,
                                value: wireApi
                              }))}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  upstreamWireApi: normalizeSelectValue(value) as UpstreamWireApi
                                }))
                              }
                            />
                          </label>

                          <label className="tc-switchline">
                            <span>{t("启用模型", "Model Enabled")}</span>
                            <Switch
                              value={item.enabled}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  enabled: Boolean(value)
                                }))
                              }
                            />
                          </label>

                          <label className="tc-switchline">
                            <span>{t("主模型支持视觉", "Main Model Supports Vision")}</span>
                            <Switch
                              value={item.supportsVision}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev) => ({
                                  ...prev,
                                  supportsVision: Boolean(value),
                                  visionChannelId: Boolean(value) ? null : prev.visionChannelId,
                                  visionModel: Boolean(value) ? null : prev.visionModel
                                }))
                              }
                            />
                          </label>

                          {!item.supportsVision ? (
                            <>
                              <p className="tc-upstream-advice tc-field-wide">
                                {t(
                                  "当前主模型不支持视觉。收到图片后会先调用下方辅助视觉渠道/模型做图片转文本，再回到本模型继续推理。",
                                  "This main model has no native vision. Image input will be converted by fallback vision channel/model first, then fed back to this model."
                                )}
                              </p>
                              <label className="tc-field">
                                <span>{t("视觉渠道（可跨供应商）", "Vision Channel (cross-provider)")}</span>
                                <Select
                                  value={
                                    item.visionChannelId
                                      ? String(item.visionChannelId)
                                      : "__self__"
                                  }
                                  options={visionChannelOptions}
                                  onChange={(value) => {
                                    const next = normalizeSelectValue(value);
                                    updateUpstreamModel(item.id, (prev) => ({
                                      ...prev,
                                      visionChannelId:
                                        next === "__self__" ? null : Number(next) || null
                                    }));
                                  }}
                                />
                              </label>

                              <label className="tc-field">
                                <span>{t("从视觉渠道选择模型", "Pick Model from Vision Channel")}</span>
                                <Select
                                  value={item.visionModel ?? undefined}
                                  options={resolveVisionModelOptions(item)}
                                  placeholder={t("可选，不填可手输", "Optional; leave empty to type manually")}
                                  onChange={(value) =>
                                    updateUpstreamModel(item.id, (prev) => ({
                                      ...prev,
                                      visionModel: normalizeSelectValue(value) || null
                                    }))
                                  }
                                />
                              </label>

                              <label className="tc-field tc-field-wide">
                                <span>{t("辅助视觉模型（跨模型图片转文本）", "Fallback Vision Model (cross-model image-to-text)")}</span>
                                <Input
                                  value={item.visionModel ?? ""}
                                  onChange={(value) =>
                                    updateUpstreamModel(item.id, (prev) => ({
                                      ...prev,
                                      visionModel: value
                                    }))
                                  }
                                  placeholder={t("如：glm-4v / doubao-vision / gpt-4.1-mini", "e.g. glm-4v / doubao-vision / gpt-4.1-mini")}
                                  clearable
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="tc-form-grid">
                    <label className="tc-field tc-field-wide">
                      <span>{t("上游测试提示词", "Upstream Test Prompt")}</span>
                      <Input
                        value={testPrompt}
                        onChange={(value) => setTestPrompt(value)}
                        placeholder={t("如：请只回复 upstream_test_ok", "e.g. Reply only: upstream_test_ok")}
                        clearable
                      />
                    </label>
                  </div>

                  <div className="tc-actions-row">
                    <Button
                      variant="outline"
                      theme="default"
                      loading={testingUpstream && testingModelId === null}
                      onClick={() => void testUpstreamModel()}
                      disabled={savingChannel || loading}
                    >
                      {t("测试默认模型", "Test Default Model")}
                    </Button>
                  </div>
                </section>
              ) : null}

              {routeModule === "logs" ? (
                <section className="tc-section">
                  <h3>{t("接口访问日志", "API Access Logs")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "按时间倒序展示网关收到的请求与返回结果。敏感字段已自动脱敏。",
                      "Shows gateway requests/responses in reverse chronological order. Sensitive fields are redacted."
                    )}
                  </p>

                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group">
                      <label className="tc-switchline">
                        <span>{t("自动刷新（3秒）", "Auto Refresh (3s)")}</span>
                        <Switch
                          value={autoRefreshLogs}
                          onChange={(value) => setAutoRefreshLogs(Boolean(value))}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("拉取条数", "Fetch Limit")}</span>
                        <Select
                          value={String(logLimit)}
                          options={[
                            { label: "50 条", value: "50" },
                            { label: "100 条", value: "100" },
                            { label: "200 条", value: "200" },
                            { label: "500 条", value: "500" }
                          ]}
                          style={{ width: 140 }}
                          onChange={(value) => {
                            const next = Number(normalizeSelectValue(value));
                            if (Number.isFinite(next)) {
                              setLogLimit(next);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group tc-log-toolbar-actions">
                      <Button
                        variant="outline"
                        theme="danger"
                        onClick={() => void clearApiLogs()}
                        disabled={loadingLogs}
                      >
                        {t("清空日志", "Clear Logs")}
                      </Button>
                    </div>
                  </div>

                  {apiLogs.length === 0 ? (
                    <p className="tc-upstream-advice">{t("暂无日志。先调用一次接口后再查看。", "No logs yet. Send one request first.")}</p>
                  ) : (
                    <div className="tc-log-list">
                      {apiLogs.map((item) => (
                        <article
                          className={`tc-log-item tc-log-item-${statusClassName(item.status)}`}
                          key={`${item.id}-${item.createdAt}`}
                        >
                          <div className="tc-log-head">
                            <div className="tc-log-head-main">
                              <div className="tc-log-tags">
                                <Tag theme={statusTheme(item.status)} variant="light-outline">
                                  {item.status ?? "ERROR"}
                                </Tag>
                                <Tag variant="light-outline">{item.method}</Tag>
                                <Tag variant="light-outline">{item.route}</Tag>
                                <Tag variant="light-outline">{item.elapsedMs}ms</Tag>
                              </div>
                              <span className="tc-log-time">{formatCnDate(item.createdAt)}</span>
                            </div>
                            <div className="tc-log-subline">
                              <code className="tc-log-path">{item.path}</code>
                              <span className="tc-log-id">req#{item.id}</span>
                            </div>
                          </div>
                          <div className="tc-log-panels">
                            <div className="tc-log-panel">
                              <strong>{t("请求体", "Request Body")}</strong>
                              <JsonViewer value={item.requestBody} />
                            </div>
                            <div className={`tc-log-panel${item.error ? " tc-log-panel-error" : ""}`}>
                              <strong>{item.error ? t("错误", "Error") : t("响应体", "Response Body")}</strong>
                              <JsonViewer value={item.error ? item.error : item.responseBody} />
                            </div>
                          </div>
                          <details className="tc-log-detail">
                            <summary>{t("展开请求/响应头", "Expand Request/Response Headers")}</summary>
                            <div className="tc-log-panels">
                              <div className="tc-log-panel">
                                <strong>{t("请求头", "Request Headers")}</strong>
                                <JsonViewer value={item.requestHeaders} />
                              </div>
                              <div className="tc-log-panel">
                                <strong>{t("响应头", "Response Headers")}</strong>
                                <JsonViewer value={item.responseHeaders} />
                              </div>
                            </div>
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {routeModule === "calls" ? (
                <section className="tc-section">
                  <h3>{t("AI 调用日志", "AI Call Logs")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "展示系统提示词、用户提问、模型回答，以及真实上游模型（实际调用模型）信息。支持按 Key / 模型 / 调用类型筛选，并可单独统计跨模型辅助视觉调用。",
                      "Shows system prompt, user question, assistant response, and real upstream model (actually used). Supports filtering by key/model/call type, including cross-model vision fallback stats."
                    )}
                  </p>

                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group">
                      <label className="tc-switchline">
                        <span>{t("自动刷新（3秒）", "Auto Refresh (3s)")}</span>
                        <Switch
                          value={autoRefreshAiCallLogs}
                          onChange={(value) => setAutoRefreshAiCallLogs(Boolean(value))}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("拉取条数", "Fetch Limit")}</span>
                        <Select
                          value={String(aiCallLogLimit)}
                          options={[
                            { label: "50 条", value: "50" },
                            { label: "100 条", value: "100" },
                            { label: "200 条", value: "200" },
                            { label: "500 条", value: "500" }
                          ]}
                          style={{ width: 140 }}
                          onChange={(value) => {
                            const next = Number(normalizeSelectValue(value));
                            if (Number.isFinite(next)) {
                              setAiCallLogLimit(next);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("筛选 Key", "Filter Key")}</span>
                        <Select
                          value={aiCallKeyFilter ? String(aiCallKeyFilter) : "__all__"}
                          options={aiCallKeyOptions}
                          style={{ width: 220 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            if (next === "__all__") {
                              setAiCallKeyFilter(null);
                              return;
                            }
                            const id = Number(next);
                            if (Number.isFinite(id) && id > 0) {
                              setAiCallKeyFilter(id);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("筛选真实模型", "Filter Upstream Model")}</span>
                        <Select
                          value={aiCallModelFilter || "__all__"}
                          options={aiCallModelSelectOptions}
                          style={{ width: 280 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallModelFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("调用类型", "Call Type")}</span>
                        <Select
                          value={aiCallTypeFilter || "__all__"}
                          options={aiCallTypeOptions}
                          style={{ width: 180 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            if (next === "__all__") {
                              setAiCallTypeFilter("");
                              return;
                            }
                            if (next === "main" || next === "vision_fallback") {
                              setAiCallTypeFilter(next);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group tc-log-toolbar-actions">
                      <Button
                        variant="outline"
                        theme="danger"
                        onClick={() => void clearAiCallLogs()}
                        disabled={loadingAiCallLogs}
                      >
                        {t("清空日志", "Clear Logs")}
                      </Button>
                    </div>
                  </div>

                  <div className="tc-meta-row">
                    <Tag variant="light-outline">匹配调用={aiCallStats.matched}</Tag>
                    <Tag variant="light-outline">主调用={aiCallStats.main}</Tag>
                    <Tag theme="warning" variant="light-outline">
                      辅助视觉={aiCallStats.visionFallback}
                    </Tag>
                    {aiCallStats.visionByModel.slice(0, 5).map((item) => (
                      <Tag key={`vision-model-${item.model}`} theme="primary" variant="light-outline">
                        视觉模型 {item.model} · {item.count}
                      </Tag>
                    ))}
                    {aiCallStats.visionByKey.slice(0, 3).map((item) => (
                      <Tag key={`vision-key-${item.keyId}`} variant="light-outline">
                        视觉 Key {item.keyName} · {item.count}
                      </Tag>
                    ))}
                  </div>

                  {aiCallLogs.length === 0 ? (
                    <p className="tc-upstream-advice">{t("暂无 AI 调用日志。先发起一次模型请求后再查看。", "No AI call logs yet. Send one model request first.")}</p>
                  ) : (
                    <div className="tc-log-list">
                      {aiCallLogs.map((item) => (
                        <article className="tc-log-item tc-log-item-ok" key={`${item.id}-${item.createdAt}`}>
                          <div className="tc-log-head">
                            <div className="tc-log-head-main">
                              <div className="tc-log-tags">
                                <Tag theme="success" variant="light-outline">
                                  OK
                                </Tag>
                                <Tag
                                  theme={item.callType === "vision_fallback" ? "warning" : "primary"}
                                  variant="light-outline"
                                >
                                  {item.callType === "vision_fallback" ? "辅助视觉" : "主调用"}
                                </Tag>
                                <Tag variant="light-outline">{item.route}</Tag>
                                <Tag variant="light-outline">key={item.keyName}</Tag>
                                <Tag variant="light-outline">
                                  真实模型={item.upstreamModel}
                                </Tag>
                                <Tag variant="light-outline">客户端模型={item.clientModel}</Tag>
                                <Tag variant="light-outline">请求模型={item.requestedModel}</Tag>
                                <Tag variant="light-outline">
                                  {item.stream ? "stream" : "non-stream"}
                                </Tag>
                              </div>
                              <span className="tc-log-time">{formatCnDate(item.createdAt)}</span>
                            </div>
                            <div className="tc-log-subline">
                              <code className="tc-log-path">
                                request={item.requestWireApi} · upstream={item.upstreamWireApi}
                              </code>
                              <span className="tc-log-id">log#{item.id}</span>
                            </div>
                          </div>
                          <div className="tc-log-panels">
                            <div className="tc-log-panel">
                              <strong>系统提示词</strong>
                              <MarkdownLogBlock value={item.systemPrompt || ""} />
                            </div>
                            <div className="tc-log-panel">
                              <strong>用户提问</strong>
                              <MarkdownLogBlock value={item.userPrompt || ""} />
                            </div>
                          </div>
                          {Array.isArray(item.images) && item.images.length > 0 ? (
                            <div className="tc-log-panels">
                              <div className="tc-log-panel tc-log-panel-full">
                                <strong>图片快照</strong>
                                <div className="tc-log-image-grid">
                                  {item.images.map((image, idx) => (
                                    <article
                                      className="tc-log-image-card"
                                      key={`${item.id}-image-${idx}-${image.savedUrl ?? image.source}`}
                                    >
                                      {image.savedUrl ? (
                                        <button
                                          type="button"
                                          className="tc-log-image-zoom-btn"
                                          onClick={() =>
                                            setPreviewImage({
                                              url: image.savedUrl!,
                                              title: `log#${item.id} · 图片 ${idx + 1}`
                                            })
                                          }
                                        >
                                          <img
                                            src={image.savedUrl}
                                            alt={`log-${item.id}-image-${idx + 1}`}
                                            className="tc-log-image-thumb"
                                            loading="lazy"
                                          />
                                        </button>
                                      ) : (
                                        <div className="tc-log-image-missing">图片保存失败</div>
                                      )}
                                      <div className="tc-log-image-meta">
                                        <span>来源：{image.sourceType}</span>
                                        <span>地址：{image.source}</span>
                                        <span>类型：{image.mimeType || "-"}</span>
                                        <span>
                                          大小：
                                          {typeof image.sizeBytes === "number"
                                            ? `${formatNumber(image.sizeBytes)} bytes`
                                            : "-"}
                                        </span>
                                        {image.error ? <span className="tc-log-image-error">{image.error}</span> : null}
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <div className="tc-log-panels">
                            <div className="tc-log-panel tc-log-panel-full">
                              <strong>模型回答</strong>
                              <MarkdownLogBlock value={item.assistantResponse || ""} />
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {routeModule === "usage" ? (
                <section className="tc-section">
                  <h3>{t("Token 用量统计报表", "Token Usage Report")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "按分钟聚合展示每个本地 Key 与模型的 token 用量，支持自动刷新和按 Key 筛选。",
                      "Shows per-minute aggregated token usage by local key and model. Supports auto refresh and key filter."
                    )}
                  </p>

                  <div className="tc-usage-toolbar">
                    <div className="tc-usage-range">
                      <span>时间范围</span>
                      <div className="tc-usage-range-buttons">
                        {USAGE_RANGE_OPTIONS.map((item) => (
                          <Button
                            key={`usage-range-${item.minutes}`}
                            size="small"
                            theme={!hasCustomUsageDateRange && usageMinutes === item.minutes ? "primary" : "default"}
                            variant={!hasCustomUsageDateRange && usageMinutes === item.minutes ? "base" : "outline"}
                            onClick={() => {
                              setUsageMinutes(item.minutes);
                              setUsageDateRange([]);
                            }}
                          >
                            {item.label}
                          </Button>
                        ))}
                        {hasCustomUsageDateRange ? (
                          <Button size="small" variant="outline" onClick={() => setUsageDateRange([])}>
                            清除自由日期
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <label className="tc-switchline">
                      <span>自动刷新（5秒）</span>
                      <Switch
                        value={autoRefreshUsage}
                        onChange={(value) => setAutoRefreshUsage(Boolean(value))}
                      />
                    </label>

                    <label className="tc-field">
                      <span>统计窗口</span>
                      <Select
                        value={String(usageMinutes)}
                        options={[
                          { label: "30 分钟", value: "30" },
                          { label: "1 小时", value: "60" },
                          { label: "3 小时", value: "180" },
                          { label: "12 小时", value: "720" },
                          { label: "24 小时", value: "1440" },
                          { label: "7 天", value: "10080" }
                        ]}
                        style={{ width: 150 }}
                        onChange={(value) => {
                          const next = Number(normalizeSelectValue(value));
                          if (Number.isFinite(next)) {
                            setUsageMinutes(next);
                            setUsageDateRange([]);
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field">
                      <span>自由日期范围</span>
                      <DateRangePicker
                        enableTimePicker
                        clearable
                        valueType="YYYY-MM-DD HH:mm:ss"
                        format="YYYY-MM-DD HH:mm:ss"
                        value={usageDateRange}
                        placeholder={["开始时间", "结束时间"]}
                        style={{ width: "min(360px, 100%)" }}
                        onChange={(value) => {
                          if (!Array.isArray(value)) {
                            setUsageDateRange([]);
                            return;
                          }
                          const next = value.map((item) => String(item ?? "").trim());
                          if (next.length === 2 && next[0] && next[1]) {
                            setUsageDateRange([next[0], next[1]]);
                            return;
                          }
                          setUsageDateRange([]);
                        }}
                      />
                    </label>

                    <label className="tc-field">
                      <span>主指标</span>
                      <Select
                        value={usageMetric}
                        options={[
                          { label: "请求数", value: "requestCount" },
                          { label: "输入 Token", value: "promptTokens" },
                          { label: "输出 Token", value: "completionTokens" },
                          { label: "Total Token", value: "totalTokens" }
                        ]}
                        style={{ width: 150 }}
                        onChange={(value) => {
                          const next = normalizeSelectValue(value) as UsageMetricKey;
                          if (next in USAGE_METRIC_META) {
                            setUsageMetric(next);
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field">
                      <span>时间桶</span>
                      <Select
                        value={usageBucketMode}
                        options={[
                          { label: "自动", value: "auto" },
                          { label: "1 分钟", value: "1" },
                          { label: "5 分钟", value: "5" },
                          { label: "15 分钟", value: "15" },
                          { label: "1 小时", value: "60" }
                        ]}
                        style={{ width: 140 }}
                        onChange={(value) => {
                          const next = normalizeSelectValue(value) as UsageBucketMode;
                          if (["auto", "1", "5", "15", "60"].includes(next)) {
                            setUsageBucketMode(next);
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field">
                      <span>本地 Key 筛选</span>
                      <Select
                        value={usageKeyFilter ? String(usageKeyFilter) : "__all__"}
                        options={usageKeyOptions}
                        style={{ width: 300 }}
                        onChange={(value) => {
                          const next = normalizeSelectValue(value);
                          if (next === "__all__") {
                            setUsageKeyFilter(null);
                            return;
                          }
                          const id = Number(next);
                          if (Number.isFinite(id) && id > 0) {
                            setUsageKeyFilter(id);
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field">
                      <span>分钟明细上限</span>
                      <Select
                        value={String(usageTimelineLimit)}
                        options={[
                          { label: "200 行", value: "200" },
                          { label: "600 行", value: "600" },
                          { label: "1200 行", value: "1200" },
                          { label: "2000 行", value: "2000" }
                        ]}
                        style={{ width: 140 }}
                        onChange={(value) => {
                          const next = Number(normalizeSelectValue(value));
                          if (Number.isFinite(next)) {
                            setUsageTimelineLimit(next);
                          }
                        }}
                      />
                    </label>

                    <div className="tc-usage-toolbar-actions">
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void loadUsageReport()}
                        disabled={loadingUsage}
                      >
                        手动刷新
                      </Button>
                      <Button
                        variant="outline"
                        theme="danger"
                        onClick={() => void clearUsageReport()}
                        disabled={loadingUsage}
                      >
                        清空统计
                      </Button>
                    </div>
                  </div>

                  {!usageReport || usageReport.summary.requestCount === 0 ? (
                    <p className="tc-upstream-advice">暂无 token 用量数据。先发起一次模型请求后再查看。</p>
                  ) : (
                    <>
                      <div className="tc-usage-cards">
                        <article className="tc-usage-card">
                          <span>请求总数</span>
                          <strong>{formatNumber(usageReport.summary.requestCount)}</strong>
                        </article>
                        <article className="tc-usage-card">
                          <span>输入 Token</span>
                          <strong>{formatNumber(usageReport.summary.promptTokens)}</strong>
                        </article>
                        <article className="tc-usage-card">
                          <span>输出 Token</span>
                          <strong>{formatNumber(usageReport.summary.completionTokens)}</strong>
                        </article>
                        <article className="tc-usage-card">
                          <span>Total Token</span>
                          <strong>{formatNumber(usageReport.summary.totalTokens)}</strong>
                        </article>
                      </div>

                      <div className="tc-usage-charts">
                        <div className="tc-usage-chart-card tc-usage-chart-wide">
                          <h4>趋势图（{usagePrimaryMetricMeta.label}）</h4>
                          <p className="tc-usage-chart-note">
                            OpenAI 风格主图：当前时间桶 {resolvedUsageBucketMinutes} 分钟，统计
                            {hasCustomUsageDateRange
                              ? ` ${usageDateRange[0]} 至 ${usageDateRange[1]}`
                              : usageMinutes >= 1440
                                ? ` 最近 ${(usageMinutes / 1440).toFixed(usageMinutes % 1440 === 0 ? 0 : 1)} 天`
                                : ` 最近 ${usageMinutes} 分钟`}
                            的用量趋势。
                          </p>
                          {usageTimelineChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usageTimelineChartOption}
                              style={{ width: "100%", height: 320 }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">暂无分钟趋势数据。</p>
                          )}
                        </div>

                        <div className="tc-usage-chart-card">
                          <h4>Key Top12（{usagePrimaryMetricMeta.shortLabel}）</h4>
                          <p className="tc-usage-chart-note">对比不同本地 Key 的核心指标分布。</p>
                          {usagePerKeyChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usagePerKeyChartOption}
                              style={{ width: "100%", height: 320 }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">暂无 Key 维度数据。</p>
                          )}
                        </div>

                        <div className="tc-usage-chart-card">
                          <h4>真实模型 Top10（{usagePrimaryMetricMeta.shortLabel}）</h4>
                          <p className="tc-usage-chart-note">识别高消耗模型，辅助做策略切换与限流。</p>
                          {usagePerModelChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usagePerModelChartOption}
                              style={{ width: "100%", height: 320 }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">暂无模型维度数据。</p>
                          )}
                        </div>
                      </div>

                      <div className="tc-usage-grid">
                        <div className="tc-usage-block">
                          <h4>按 Key 汇总</h4>
                          <div className="tc-usage-table-wrap">
                            <table className="tc-usage-table">
                              <thead>
                                <tr>
                                  <th>本地 Key</th>
                                  <th>请求数</th>
                                  <th>输入</th>
                                  <th>输出</th>
                                  <th>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {usageReport.perKey.map((item) => (
                                  <tr key={`key-${item.keyId}`}>
                                    <td>{item.keyName}</td>
                                    <td>{formatNumber(item.requestCount)}</td>
                                    <td>{formatNumber(item.promptTokens)}</td>
                                    <td>{formatNumber(item.completionTokens)}</td>
                                    <td>{formatNumber(item.totalTokens)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="tc-usage-block">
                          <h4>按真实模型汇总</h4>
                          <div className="tc-usage-table-wrap">
                            <table className="tc-usage-table">
                              <thead>
                                <tr>
                                  <th>真实模型（上游）</th>
                                  <th>所属 Key</th>
                                  <th>请求数</th>
                                  <th>输入</th>
                                  <th>输出</th>
                                  <th>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {usageReport.perModel.slice(0, 120).map((item, index) => (
                                  <tr key={`model-${item.keyId}-${item.model}-${index}`}>
                                    <td>{item.model}</td>
                                    <td>{item.keyName}</td>
                                    <td>{formatNumber(item.requestCount)}</td>
                                    <td>{formatNumber(item.promptTokens)}</td>
                                    <td>{formatNumber(item.completionTokens)}</td>
                                    <td>{formatNumber(item.totalTokens)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      <div className="tc-usage-block">
                        <h4>按分钟明细（真实模型）</h4>
                        <div className="tc-usage-table-wrap">
                          <table className="tc-usage-table">
                            <thead>
                              <tr>
                                <th>分钟</th>
                                <th>Key</th>
                                <th>真实模型（上游）</th>
                                <th>请求数</th>
                                <th>输入</th>
                                <th>输出</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usageReport.timeline.map((item, index) => (
                                <tr key={`timeline-${item.minute}-${item.keyId}-${item.model}-${index}`}>
                                  <td>{formatCnDate(item.minute)}</td>
                                  <td>{item.keyName}</td>
                                  <td>{item.model}</td>
                                  <td>{formatNumber(item.requestCount)}</td>
                                  <td>{formatNumber(item.promptTokens)}</td>
                                  <td>{formatNumber(item.completionTokens)}</td>
                                  <td>{formatNumber(item.totalTokens)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              {routeModule === "docs" ? (
                <section className="tc-section">
                  <h3>{t("本端接口文档", "Gateway API Documentation")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "以下文档与当前服务端实现保持一致，包含网关推理接口和管理接口。网关鉴权使用本地 Key（不是上游 API Key）。",
                      "This section mirrors the current server implementation, including gateway inference APIs and management APIs. Gateway auth uses local keys (not upstream API keys)."
                    )}
                  </p>

                  <div className="tc-meta-row">
                    <Tag variant="light-outline">{t("网关基地址", "Gateway Base URL")}: {gatewayV1Endpoint}</Tag>
                    <Tag variant="light-outline">{t("管理基地址", "Management Base URL")}: {gatewayOrigin}/api</Tag>
                    <Tag variant="light-outline">POST /v1/messages: x-api-key / Authorization</Tag>
                  </div>

                  <div className="tc-usage-grid">
                    <div className="tc-usage-block">
                      <h4>{t("网关推理接口", "Gateway Inference Endpoints")}</h4>
                      <div className="tc-usage-table-wrap">
                        <table className="tc-usage-table">
                          <thead>
                            <tr>
                              <th>{t("方法", "Method")}</th>
                              <th>{t("路径", "Path")}</th>
                              <th>{t("说明", "Description")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {API_DOC_GATEWAY_ENDPOINTS.map((item) => (
                              <tr key={`${item.method}-${item.path}`}>
                                <td><Tag variant="light-outline">{item.method}</Tag></td>
                                <td><code>{item.path}</code></td>
                                <td>{t(item.zh, item.en)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="tc-usage-block">
                      <h4>{t("管理与运维接口", "Management and Ops Endpoints")}</h4>
                      <div className="tc-usage-table-wrap">
                        <table className="tc-usage-table">
                          <thead>
                            <tr>
                              <th>{t("方法", "Method")}</th>
                              <th>{t("路径", "Path")}</th>
                              <th>{t("说明", "Description")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {API_DOC_MANAGEMENT_ENDPOINTS.map((item) => (
                              <tr key={`${item.method}-${item.path}`}>
                                <td><Tag variant="light-outline">{item.method}</Tag></td>
                                <td><code>{item.path}</code></td>
                                <td>{t(item.zh, item.en)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="tc-runtime-doc">
                    <h4>{t("调用示例", "Quick Examples")}</h4>
                    <p className="tc-upstream-advice">
                      {t(
                        "示例中的本地 Key 会优先使用当前选中的 Key；若未选择，则使用占位符。",
                        "Examples prefer the currently selected local key; otherwise they use a placeholder."
                      )}
                    </p>

                    <div className="tc-log-panels">
                      <div className="tc-log-panel">
                        <div className="tc-runtime-doc-head">
                          <strong>POST /v1/chat/completions</strong>
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() =>
                              void copyTextToClipboard(
                                apiDocExamples.chatCompletions,
                                t("示例命令已复制。", "Example command copied.")
                              )
                            }
                          >
                            {t("复制命令", "Copy Command")}
                          </Button>
                        </div>
                        <pre className="tc-json-fallback">{apiDocExamples.chatCompletions}</pre>
                      </div>

                      <div className="tc-log-panel">
                        <div className="tc-runtime-doc-head">
                          <strong>POST /v1/responses</strong>
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() =>
                              void copyTextToClipboard(
                                apiDocExamples.responses,
                                t("示例命令已复制。", "Example command copied.")
                              )
                            }
                          >
                            {t("复制命令", "Copy Command")}
                          </Button>
                        </div>
                        <pre className="tc-json-fallback">{apiDocExamples.responses}</pre>
                      </div>

                      <div className="tc-log-panel">
                        <div className="tc-runtime-doc-head">
                          <strong>POST /v1/messages</strong>
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() =>
                              void copyTextToClipboard(
                                apiDocExamples.anthropicMessages,
                                t("示例命令已复制。", "Example command copied.")
                              )
                            }
                          >
                            {t("复制命令", "Copy Command")}
                          </Button>
                        </div>
                        <pre className="tc-json-fallback">{apiDocExamples.anthropicMessages}</pre>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {routeModule === "runtime" ? (
                selectedKey ? (
                  <section className="tc-section">
                    <h3>{t("运行时调度", "Runtime")}</h3>
                    <div className="tc-meta-row">
                      <Tag variant="light-outline">{t("当前默认模型", "Default Model")}: {selectedKey.defaultModel}</Tag>
                      <Tag variant="light-outline">
                        {t("绑定渠道", "Bound Upstream")}: {selectedKey.upstreamChannelName ?? "-"}
                      </Tag>
                    </div>
                    <div className="tc-form-grid">
                      <label className="tc-field tc-field-wide">
                        <span>{t("运行时覆盖模型", "Runtime Override Model")}</span>
                        <Input
                          value={runtimeModel}
                          onChange={(value) => setRuntimeModel(value)}
                          placeholder={t("如：gpt-4.1 / glm-4-plus", "e.g. gpt-4.1 / glm-4-plus")}
                          clearable
                        />
                      </label>

                      <label className="tc-checkline">
                        <Checkbox
                          checked={syncDefaultModel}
                          onChange={(checked) => setSyncDefaultModel(checked)}
                        >
                          {t("切换时同步更新默认模型", "Update default model together")}
                        </Checkbox>
                      </label>
                    </div>

                    <div className="tc-actions-row">
                      <Button
                        theme="primary"
                        loading={switchingModel}
                        onClick={() => void switchModel(false)}
                        disabled={loading}
                      >
                        {t("应用运行时切换", "Apply Runtime Switch")}
                      </Button>
                      <Button
                        theme="danger"
                        variant="outline"
                        onClick={() => void switchModel(true)}
                        disabled={switchingModel || loading}
                      >
                        {t("清空覆盖", "Clear Override")}
                      </Button>
                    </div>

                    <div className="tc-runtime-doc">
                      <h4>{t("API 控制切换文档", "API Runtime Control Guide")}</h4>
                      <p className="tc-upstream-advice">
                        {t(
                          "可通过接口查询当前生效模型、设置运行时覆盖、清空覆盖，以及启用/停用本地 Key。",
                          "Use API to query effective model, set runtime override, clear override, and enable/disable local key."
                        )}
                      </p>
                      <div className="tc-meta-row">
                        <Tag variant="light-outline">GET {runtimeSwitchEndpoint}</Tag>
                        <Tag variant="light-outline">POST {runtimeSwitchEndpoint}</Tag>
                        <Tag variant="light-outline">selector=id/localKey/keyName/Bearer</Tag>
                      </div>

                      <div className="tc-log-panels">
                        <div className="tc-log-panel tc-log-panel-full">
                          <div className="tc-runtime-doc-head">
                            <strong>{t("查询当前运行时状态（GET）", "Query Runtime Status (GET)")}</strong>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() =>
                                void copyTextToClipboard(
                                  runtimeApiExamples.queryStatus,
                                  t("查询命令已复制。", "Query command copied.")
                                )
                              }
                            >
                              {t("复制命令", "Copy Command")}
                            </Button>
                          </div>
                          <pre className="tc-json-fallback">{runtimeApiExamples.queryStatus}</pre>
                        </div>

                        <div className="tc-log-panel">
                          <div className="tc-runtime-doc-head">
                            <strong>{t("设置运行时覆盖模型（POST）", "Set Runtime Override (POST)")}</strong>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() =>
                                void copyTextToClipboard(
                                  runtimeApiExamples.switchModel,
                                  t("切换命令已复制。", "Switch command copied.")
                                )
                              }
                            >
                              {t("复制命令", "Copy Command")}
                            </Button>
                          </div>
                          <pre className="tc-json-fallback">{runtimeApiExamples.switchModel}</pre>
                        </div>

                        <div className="tc-log-panel">
                          <div className="tc-runtime-doc-head">
                            <strong>{t("清空运行时覆盖（POST）", "Clear Runtime Override (POST)")}</strong>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() =>
                                void copyTextToClipboard(
                                  runtimeApiExamples.clearOverride,
                                  t("清空命令已复制。", "Clear command copied.")
                                )
                              }
                            >
                              {t("复制命令", "Copy Command")}
                            </Button>
                          </div>
                          <pre className="tc-json-fallback">{runtimeApiExamples.clearOverride}</pre>
                        </div>

                        <div className="tc-log-panel">
                          <div className="tc-runtime-doc-head">
                            <strong>{t("按 Key ID 启停（POST）", "Enable/Disable by Key ID (POST)")}</strong>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() =>
                                void copyTextToClipboard(
                                  runtimeApiExamples.toggleEnabledById,
                                  t("启停命令已复制。", "Enable/disable command copied.")
                                )
                              }
                            >
                              {t("复制命令", "Copy Command")}
                            </Button>
                          </div>
                          <pre className="tc-json-fallback">{runtimeApiExamples.toggleEnabledById}</pre>
                        </div>

                        <div className="tc-log-panel">
                          <div className="tc-runtime-doc-head">
                            <strong>{t("POST 参数结构", "POST Payload")}</strong>
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() =>
                                void copyTextToClipboard(
                                  runtimeApiExamples.payloadSchema,
                                  t("参数结构已复制。", "Payload copied.")
                                )
                              }
                            >
                              {t("复制结构", "Copy Payload")}
                            </Button>
                          </div>
                          <pre className="tc-json-fallback">{runtimeApiExamples.payloadSchema}</pre>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="tc-section">
                    <h3>{t("运行时调度", "Runtime")}</h3>
                    <p className="tc-tip err">{t("请先创建并保存一个本地 Key。", "Create and save a local key first.")}</p>
                  </section>
                )
              ) : null}

              {routeModule === "access" ? (
                <footer className="tc-footer-actions">
                  <Button
                    theme="primary"
                    loading={savingKey}
                    onClick={() => void saveKey()}
                    disabled={loading}
                  >
                    {isNewKey ? t("创建 Key", "Create Key") : t("保存 Key", "Save Key")}
                  </Button>
                  {!isNewKey ? (
                    <Button
                      theme="danger"
                      variant="outline"
                      onClick={() => void deleteSelectedKey()}
                      disabled={savingKey || loading}
                    >
                      {t("删除 Key", "Delete Key")}
                    </Button>
                  ) : null}
                </footer>
              ) : null}

              {routeModule === "upstream" ? (
                <footer className="tc-footer-actions">
                  <Button
                    theme="primary"
                    loading={savingChannel}
                    onClick={() => void saveChannel()}
                    disabled={loading}
                  >
                    {isNewChannel ? t("创建渠道", "Create Upstream") : t("保存渠道", "Save Upstream")}
                  </Button>
                  {!isNewChannel ? (
                    <Button
                      theme="danger"
                      variant="outline"
                      onClick={() => void deleteSelectedChannel()}
                      disabled={savingChannel || loading}
                    >
                      {t("删除渠道", "Delete Upstream")}
                    </Button>
                  ) : null}
                </footer>
              ) : null}
            </Card>

            <Dialog
              visible={Boolean(previewImage)}
              width="min(92vw, 1200px)"
              header={previewImage ? `图片预览 · ${previewImage.title}` : "图片预览"}
              cancelBtn={null}
              confirmBtn={null}
              onClose={() => setPreviewImage(null)}
            >
              {previewImage ? (
                <div className="tc-image-preview-wrap">
                  <img src={previewImage.url} alt={previewImage.title} className="tc-image-preview-img" />
                </div>
              ) : null}
            </Dialog>

          </Layout.Content>
        </Layout>
      </Layout>
    </div>
  );
}
