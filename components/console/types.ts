import type { LocaleCode } from "@/components/locale-provider";

// --- Provider / Wire API constants ---
export const PROVIDERS = ["openai", "anthropic", "openrouter", "xai", "deepseek", "glm", "doubao", "custom"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const UPSTREAM_WIRE_APIS = ["responses", "chat_completions", "anthropic_messages"] as const;
export type UpstreamWireApi = (typeof UPSTREAM_WIRE_APIS)[number];

export const GLM_CODEX_THINKING_THRESHOLDS = ["off", "low", "medium", "high"] as const;
export type GlmCodexThinkingThreshold = (typeof GLM_CODEX_THINKING_THRESHOLDS)[number];

export const DOUBAO_THINKING_TYPES = ["enabled", "disabled", "auto"] as const;
export type DoubaoThinkingType = (typeof DOUBAO_THINKING_TYPES)[number];

export const PROVIDER_DEFAULT_BASE_URL: Record<Exclude<ProviderName, "custom">, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api",
  xai: "https://api.x.ai",
  deepseek: "https://api.deepseek.com",
  glm: "https://open.bigmodel.cn/api/coding/paas/v4",
  doubao: "https://ark.cn-beijing.volces.com/api/coding/v3"
};

export const PROVIDER_META: Record<ProviderName, { label: string; tip: string }> = {
  openai: { label: "OpenAI", tip: "国际通用生态" },
  anthropic: { label: "Anthropic", tip: "Claude 官方协议" },
  openrouter: { label: "OpenRouter", tip: "聚合多家模型" },
  xai: { label: "xAI", tip: "Grok 体系" },
  deepseek: { label: "DeepSeek", tip: "高性价比" },
  glm: { label: "GLM", tip: "智谱开放平台" },
  doubao: { label: "豆包", tip: "火山方舟" },
  custom: { label: "自定义", tip: "兼容 OpenAI 或 Anthropic 格式" }
};

export const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:3000";

// --- Module system ---
export type EditorModule = "access" | "prompt" | "export" | "upstream" | "runtime" | "logs" | "calls" | "usage" | "docs";

export const MODULE_LABEL: Record<EditorModule, { zh: string; en: string }> = {
  access: { zh: "基础接入", en: "Access" },
  prompt: { zh: "提示词配置", en: "Prompt Config" },
  export: { zh: "配置导出", en: "Export" },
  upstream: { zh: "上游渠道", en: "Upstreams" },
  runtime: { zh: "运行时调度", en: "Runtime" },
  logs: { zh: "请求日志", en: "Request Logs" },
  calls: { zh: "AI 调用日志", en: "AI Call Logs" },
  usage: { zh: "用量报表", en: "Usage Report" },
  docs: { zh: "接口文档", en: "API Docs" }
};

export const MODULE_SUMMARY: Record<EditorModule, { zh: string; en: string }> = {
  access: { zh: "管理本地 Key 鉴权、映射策略和调用方入口。", en: "Manage local key auth, mappings, and client-facing entry points." },
  prompt: { zh: "维护网关默认注入提示词与 AGENTS 关键词匹配规则。", en: "Manage gateway-injected default prompts and AGENTS keyword matching rules." },
  export: { zh: "集中查看 Codex / Claude 导入配置与原生导出片段。", en: "Review Codex / Claude import configs and native export snippets in one place." },
  upstream: { zh: "维护上游供应商、模型池和视觉兜底通道。", en: "Maintain upstream providers, model pools, and fallback vision routing." },
  runtime: { zh: "在线切换模型、覆盖默认值并实时启停 Key。", en: "Switch models online, override defaults, and toggle keys in runtime." },
  logs: { zh: "排查网关请求链路，查看请求体、响应体和错误。", en: "Inspect request chains with payloads, responses, and errors." },
  calls: { zh: "追踪真实模型调用，核对系统提示词与结果。", en: "Trace actual model invocations with prompts and outputs." },
  usage: { zh: "按 Key / 模型 / 时间段观察 Token 消耗趋势。", en: "Track token consumption by key, model, and time buckets." },
  docs: { zh: "查看网关与管理接口文档，复制即用示例。", en: "Browse gateway/ops API docs and copy ready-to-run examples." }
};

// --- Coding presets ---
export type CodingPreset = {
  id: "glm-coding" | "doubao-coding";
  label: string;
  provider: ProviderName;
  upstreamBaseUrl: string;
  defaultModel: string;
  contextWindow: number | null;
  upstreamWireApi: UpstreamWireApi;
  supportsVision: boolean;
  visionModel: string | null;
};

export const CODING_PRESETS: CodingPreset[] = [
  {
    id: "glm-coding",
    label: "GLM 国内编程套餐建议",
    provider: "glm",
    upstreamBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    defaultModel: "glm-5",
    contextWindow: 128000,
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
    contextWindow: 128000,
    upstreamWireApi: "chat_completions",
    supportsVision: true,
    visionModel: null
  }
];

// --- Data types (from original settings-console.tsx) ---

export type UpstreamModelConfig = {
  id: string;
  name: string;
  aliasModel: string | null;
  model: string;
  contextWindow: number | null;
  upstreamWireApi: UpstreamWireApi;
  glmCodexThinkingThreshold: GlmCodexThinkingThreshold;
  supportsVision: boolean;
  visionChannelId: number | null;
  visionModel: string | null;
  enabled: boolean;
};

export type KeyModelMapping = {
  id: string;
  clientModel: string;
  targetModel: string;
  upstreamChannelId: number | null;
  thinkingType: DoubaoThinkingType | null;
  enabled: boolean;
  dynamicModelSwitch: boolean;
  contextSwitchThreshold: number;
  contextOverflowModel: string | null;
};

export type GatewayKey = {
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

export type UpstreamChannel = {
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

export type KeysResponse = {
  items: GatewayKey[];
  wireApi: string;
};

export type ChannelsResponse = {
  items: UpstreamChannel[];
  providers: ProviderName[];
  upstreamWireApis: UpstreamWireApi[];
};

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
  callType: "main" | "vision_fallback";
  stream: boolean;
  systemPrompt: string;
  userPrompt: string;
  conversationTranscript?: string;
  assistantReasoning?: string;
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

export type AiCallLogStats = {
  matched: number;
  main: number;
  visionFallback: number;
  visionByModel: Array<{ model: string; count: number }>;
  visionByKey: Array<{ keyId: number; keyName: string; count: number }>;
};

export type AiCallLogFilterOptions = {
  upstreamModels: string[];
  requestedModels: string[];
  clientModels: string[];
  routes: string[];
  requestWireApis: string[];
  upstreamWireApis: string[];
};

export type UsageSummaryRow = {
  keyId: number;
  keyName: string;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type UsageModelRow = UsageSummaryRow & {
  model: string;
};

export type UsageTimelineRow = UsageModelRow & {
  minute: string;
};

export type UsageReport = {
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

export type UsageMetricKey = "requestCount" | "promptTokens" | "completionTokens" | "totalTokens";
export type UsageBucketMode = "auto" | "1" | "5" | "15" | "60";

// --- Form state types ---

export type KeyFormState = {
  name: string;
  localKey: string;
  upstreamChannelId: number | null;
  modelMappings: KeyModelMapping[];
  dynamicModelSwitch: boolean;
  contextSwitchThreshold: number;
  contextOverflowModel: string;
  enabled: boolean;
};

export type ChannelFormState = {
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

// --- API Doc types ---

export type ApiDocEndpoint = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  zh: string;
  en: string;
};

export const API_DOC_GATEWAY_ENDPOINTS: ApiDocEndpoint[] = [
  { method: "POST", path: "/v1/chat/completions", zh: "OpenAI Chat Completions 兼容（别名：/api/v1/chat/completions）", en: "OpenAI Chat Completions compatible (alias: /api/v1/chat/completions)" },
  { method: "POST", path: "/v1/completions", zh: "OpenAI Completions 兼容（别名：/api/v1/completions）", en: "OpenAI Completions compatible (alias: /api/v1/completions)" },
  { method: "POST", path: "/v1/responses", zh: "OpenAI Responses 兼容（别名：/api/v1/responses）", en: "OpenAI Responses compatible (alias: /api/v1/responses)" },
  { method: "POST", path: "/v1/messages", zh: "Anthropic Messages 兼容（别名：/api/v1/messages）", en: "Anthropic Messages compatible (alias: /api/v1/messages)" }
];

export const API_DOC_MANAGEMENT_ENDPOINTS: ApiDocEndpoint[] = [
  { method: "GET", path: "/api/health", zh: "健康检查", en: "Health check" },
  { method: "GET", path: "/api/config", zh: "配置摘要与全局提示词配置", en: "Config summary and global prompt config" },
  { method: "PUT", path: "/api/config", zh: "更新全局提示词配置", en: "Update global prompt config" },
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

// --- Usage constants ---
export const OPENAI_GREEN = "#10a37f";
export const OPENAI_SLATE = "#334155";
export const OPENAI_SOFT = "#94a3b8";

export const AI_CALL_RANGE_OPTIONS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 1440 }
] as const;

export const USAGE_RANGE_OPTIONS = [
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 }
] as const;

export const USAGE_METRIC_META: Record<
  UsageMetricKey,
  { label: string; shortLabel: string; color: string; isToken: boolean }
> = {
  requestCount: { label: "请求数", shortLabel: "请求", color: OPENAI_SLATE, isToken: false },
  promptTokens: { label: "输入 Token", shortLabel: "输入", color: OPENAI_GREEN, isToken: true },
  completionTokens: { label: "输出 Token", shortLabel: "输出", color: OPENAI_SOFT, isToken: true },
  totalTokens: { label: "Total Token", shortLabel: "总量", color: "#0f172a", isToken: true }
};

export const LOCALE_OPTIONS: Array<{ label: string; value: LocaleCode }> = [
  { label: "中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
];

// --- Empty defaults ---
export const EMPTY_AI_CALL_STATS: AiCallLogStats = {
  matched: 0,
  main: 0,
  visionFallback: 0,
  visionByModel: [],
  visionByKey: []
};

export const EMPTY_AI_CALL_FILTER_OPTIONS: AiCallLogFilterOptions = {
  upstreamModels: [],
  requestedModels: [],
  clientModels: [],
  routes: [],
  requestWireApis: [],
  upstreamWireApis: []
};
