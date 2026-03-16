"use client";

import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createCodexExportBundle,
  type CodexApplyPatchToolType,
  type CodexExportBundle
} from "@/lib/codex-export";
import { CodeBlock } from "@/components/code-block";
import {
  parseOverflowModelSelection,
  serializeOverflowModelSelection
} from "@/lib/overflow-model";
import { supportsGlmThinkingType } from "@/lib/key-config";
import {
  quickExportKeyMappings,
  quickExportModels,
  quickImportKeyMappings,
  quickImportModels
} from "@/lib/quick-import-export";
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
  Textarea,
  Tabs,
  Tag
} from "tdesign-react";
import {
  LayoutDashboard,
  Plug,
  Clock,
  Settings,
  User,
  UserCircle,
  BookOpen,
  Activity,
  FileText,
  Database,
  ArrowUpDown,
  Globe,
  Code2,
  FileOutput,
  Terminal,
  HelpCircle
} from "lucide-react";
import type { EChartsOption } from "echarts";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

import { UsageLoadingSkeleton, UsagePulseLoader } from "@/components/ui/UsageLoadingSkeleton";
import { WorkspaceDashboard } from "@/components/console/workspace-dashboard";
import { UsageStatCard } from "@/components/ui/UsageStatCard";
import { UsagePieChart, PIE_COLORS } from "@/components/ui/UsagePieChart";
import type { PieSlice } from "@/components/ui/UsagePieChart";
const PROVIDERS = ["openai", "anthropic", "openrouter", "xai", "deepseek", "glm", "doubao", "custom"] as const;
type ProviderName = (typeof PROVIDERS)[number];

const UPSTREAM_WIRE_APIS = ["responses", "chat_completions", "anthropic_messages"] as const;
type UpstreamWireApi = (typeof UPSTREAM_WIRE_APIS)[number];
const GLM_CODEX_THINKING_THRESHOLDS = ["off", "low", "medium", "high"] as const;
type GlmCodexThinkingThreshold = (typeof GLM_CODEX_THINKING_THRESHOLDS)[number];
const DOUBAO_THINKING_TYPES = ["enabled", "disabled", "auto"] as const;
type DoubaoThinkingType = (typeof DOUBAO_THINKING_TYPES)[number];

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
const AI_CALL_RANGE_OPTIONS = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 1440 }
] as const;
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
const EMPTY_AI_CALL_FILTER_OPTIONS: AiCallLogFilterOptions = {
  upstreamModels: [],
  requestedModels: [],
  clientModels: [],
  routes: [],
  requestWireApis: [],
  upstreamWireApis: []
};

const LOCALE_OPTIONS: Array<{ label: string; value: LocaleCode }> = [
  { label: "中文", value: "zh-CN" },
  { label: "English", value: "en-US" }
];

export type EditorModule = "access" | "prompt" | "export" | "upstream" | "runtime" | "logs" | "calls" | "usage" | "docs" | "dashboard";
type SettingsConsoleProps = {
  module?: EditorModule;
};

const MODULE_LABEL: Record<EditorModule, { zh: string; en: string }> = {
  access: { zh: "基础接入", en: "Access" },
  prompt: { zh: "提示词配置", en: "Prompt Config" },
  export: { zh: "配置导出", en: "Export" },
  upstream: { zh: "上游渠道", en: "Upstreams" },
  runtime: { zh: "运行时调度", en: "Runtime" },
  logs: { zh: "请求日志", en: "Request Logs" },
  calls: { zh: "AI 调用日志", en: "AI Call Logs" },
  usage: { zh: "用量报表", en: "Usage Report" },
  docs: { zh: "接口文档", en: "API Docs" }
  ,
  dashboard: { zh: "工作台", en: "Dashboard" }
};

const MODULE_SUMMARY: Record<EditorModule, { zh: string; en: string }> = {
  access: {
    zh: "管理本地 Key 鉴权、映射策略和调用方入口。",
    en: "Manage local key auth, mappings, and client-facing entry points."
  },
  prompt: {
    zh: "维护网关注入提示词：全局默认 + 按上游真实模型定制规则。",
    en: "Manage gateway-injected prompts: global default plus upstream-model specific rules."
  },
  export: {
    zh: "集中查看 Codex / Claude 导入配置与原生导出片段。",
    en: "Review Codex / Claude import configs and native export snippets in one place."
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
  ,
  dashboard: {
    zh: "系统运行概览与快速操作入口。",
    en: "System overview and quick actions."
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
  { method: "GET", path: "/api/config", zh: "配置摘要与提示词配置（含模型规则）", en: "Config summary and prompt config (with model rules)" },
  { method: "PUT", path: "/api/config", zh: "更新提示词配置（含模型规则）", en: "Update prompt config (with model rules)" },
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
  contextWindow: number | null;
  upstreamWireApi: UpstreamWireApi;
  glmCodexThinkingThreshold: GlmCodexThinkingThreshold;
  supportsVision: boolean;
  visionChannelId: number | null;
  visionModel: string | null;
  enabled: boolean;
};

type KeyModelMapping = {
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

type CompatPromptConfig = {
  agentsMdKeywords: string[];
  chineseReplyHint: string;
  modelPromptRules: CompatPromptRule[];
};

type CompatPromptRule = {
  id: string;
  enabled: boolean;
  provider: string;
  upstreamModelPattern: string;
  hint: string;
};

type ConfigSummaryResponse = {
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

type AiCallLogStats = {
  matched: number;
  main: number;
  visionFallback: number;
  visionByModel: Array<{ model: string; count: number }>;
  visionByKey: Array<{ keyId: number; keyName: string; count: number }>;
};

type AiCallLogFilterOptions = {
  upstreamModels: string[];
  requestedModels: string[];
  clientModels: string[];
  routes: string[];
  requestWireApis: string[];
  upstreamWireApis: string[];
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
  contextWindow: number | null;
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

function generateCompatPromptRuleId() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `rule_${suffix}`;
}

function createCompatPromptRuleDraft(overrides: Partial<CompatPromptRule> = {}): CompatPromptRule {
  return {
    id: overrides.id?.trim() || generateCompatPromptRuleId(),
    enabled: overrides.enabled ?? true,
    provider: overrides.provider?.trim() || "",
    upstreamModelPattern: overrides.upstreamModelPattern?.trim() || "",
    hint: overrides.hint ?? ""
  };
}

function createUpstreamModelDraft(
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

function normalizeGlmCodexThinkingThreshold(
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

function shouldShowGlmThinkingThreshold(provider: ProviderName, model: string) {
  return supportsGlmThinkingType(provider, model);
}

function shouldShowDoubaoThinkingType(provider: ProviderName, model: string) {
  const normalized = model.trim().toLowerCase();
  return (
    provider === "doubao" ||
    normalized.startsWith("doubao-") ||
    normalized.startsWith("deepseek-")
  );
}

function createEmptyKeyFormState(localKey = ""): KeyFormState {
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

function formatCnDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return CN_DATE_FORMATTER.format(date);
}

export function formatNumber(value: number) {
  return NUMBER_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function formatMinuteLabel(value: string) {
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

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeAiCallFilterOptions(value: unknown): AiCallLogFilterOptions {
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

function buildRecentDateRange(minutes: number): [string, string] {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, minutes) * 60_000);
  return [formatDateTimeInput(start), formatDateTimeInput(end)];
}

function formatCompatPromptKeywordsInput(keywords: string[]) {
  return keywords.join("\n");
}

function parseCompatPromptKeywordsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeCompatPromptRule(rule: Partial<CompatPromptRule>, index: number): CompatPromptRule {
  return {
    id: rule.id?.trim() || `rule-${index + 1}`,
    enabled: rule.enabled !== false,
    provider: rule.provider?.trim() || "",
    upstreamModelPattern: rule.upstreamModelPattern?.trim() || "",
    hint: rule.hint?.trim() || ""
  };
}

function normalizeCompatPromptRules(rules: Partial<CompatPromptRule>[]) {
  return rules.map((rule, index) => normalizeCompatPromptRule(rule, index));
}

function formatCompatPromptRulesJson(rules: CompatPromptRule[]) {
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

function parseCompatPromptRulesJson(value: string): CompatPromptRule[] {
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

function ensureCompatPromptRuleIdsUnique(rules: CompatPromptRule[]) {
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

function stringifyCompatPromptRuleForSearch(rule: CompatPromptRule) {
  return [rule.id, rule.provider, rule.upstreamModelPattern, rule.hint].join(" ").toLowerCase();
}

function resolveThinkingTokens(contextWindow: number | null) {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return 8192;
  }
  return Math.max(2048, Math.min(8192, Math.floor(contextWindow * 0.1)));
}

function resolveCodexTokenBudgets(contextWindow: number | null) {
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

function resolveClaudeMaxOutputTokens(contextWindow: number | null) {
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

function formatClaudeModelWithContext(model: string, contextWindow: number | null) {
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

function inferContextWindowFromModel(model: string, provider: ProviderName) {
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

const LOG_MARKDOWN_PLUGINS = [remarkGfm];
const LOG_MARKDOWN_SIGNAL_RE =
  /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~)|\[[^\]]+\]\([^)]+\)|\|.+\|/m;
const LARGE_LOG_BLOCK_THRESHOLD = 12000;

const MarkdownLogBlock = memo(function MarkdownLogBlock({ value }: { value: string }) {
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

function summarizeLogPreview(...values: string[]) {
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
  }
  return "";
}

export function SettingsConsole({ module = "access" }: SettingsConsoleProps) {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const formatGlmThinkingThresholdLabel = (threshold: GlmCodexThinkingThreshold) => {
    if (threshold === "off") {
      return t("关闭自动开启", "Never auto-enable");
    }
    if (threshold === "high") {
      return "high";
    }
    return `${threshold}+`;
  };
  const formatDoubaoThinkingTypeLabel = (type: DoubaoThinkingType) => {
    if (type === "enabled") {
      return t("强制开启", "Force Enabled");
    }
    if (type === "disabled") {
      return t("强制关闭", "Force Disabled");
    }
    return t("自动判断", "Auto");
  };
  const routeModule = module;

  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [channels, setChannels] = useState<UpstreamChannel[]>([]);
  const [wireApi, setWireApi] = useState("responses");

  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);

  const [keyForm, setKeyForm] = useState<KeyFormState>(() => createEmptyKeyFormState());
  const [channelForm, setChannelForm] = useState<ChannelFormState>(() => createEmptyChannelFormState());

  const [quickImportJson, setQuickImportJson] = useState("");
  const [quickImportDialogVisible, setQuickImportDialogVisible] = useState(false);
  const [quickExportDialogVisible, setQuickExportDialogVisible] = useState(false);
  const [quickExportJson, setQuickExportJson] = useState("");
  const [quickImportKeyMappingJson, setQuickImportKeyMappingJson] = useState("");
  const [quickImportKeyMappingDialogVisible, setQuickImportKeyMappingDialogVisible] =
    useState(false);
  const [quickExportKeyMappingDialogVisible, setQuickExportKeyMappingDialogVisible] =
    useState(false);
  const [quickExportKeyMappingJson, setQuickExportKeyMappingJson] = useState("");

  const [runtimeModel, setRuntimeModel] = useState("");
  const [syncDefaultModel, setSyncDefaultModel] = useState(false);
  const [nativeCodexApplyPatchToolType, setNativeCodexApplyPatchToolType] =
    useState<CodexApplyPatchToolType>("function");
  const [testPrompt, setTestPrompt] = useState("请只回复：upstream_test_ok");
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [apiLogs, setApiLogs] = useState<ApiLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);
  const [logLimit, setLogLimit] = useState(100);
  const [aiCallLogs, setAiCallLogs] = useState<AiCallLogEntry[]>([]);
  const [loadingAiCallLogs, setLoadingAiCallLogs] = useState(false);
  const [autoRefreshAiCallLogs, setAutoRefreshAiCallLogs] = useState(false);
  const [aiCallLogLimit, setAiCallLogLimit] = useState(50);
  const [expandedAiCallLogIds, setExpandedAiCallLogIds] = useState<string[]>([]);
  const [aiCallKeyFilter, setAiCallKeyFilter] = useState<number | null>(null);
  const [aiCallDateRange, setAiCallDateRange] = useState<string[]>([]);
  const [aiCallKeywordFilter, setAiCallKeywordFilter] = useState("");
  const [aiCallRouteFilter, setAiCallRouteFilter] = useState("");
  const [aiCallRequestWireFilter, setAiCallRequestWireFilter] = useState("");
  const [aiCallUpstreamWireFilter, setAiCallUpstreamWireFilter] = useState("");
  const [aiCallModelFilter, setAiCallModelFilter] = useState("");
  const [aiCallRequestedModelFilter, setAiCallRequestedModelFilter] = useState("");
  const [aiCallClientModelFilter, setAiCallClientModelFilter] = useState("");
  const [aiCallStreamFilter, setAiCallStreamFilter] = useState<"" | "stream" | "non_stream">("");
  const [aiCallTypeFilter, setAiCallTypeFilter] = useState<"" | "main" | "vision_fallback">("");
  const [aiCallModelOptions, setAiCallModelOptions] = useState<string[]>([]);
  const [aiCallFilterOptions, setAiCallFilterOptions] = useState<AiCallLogFilterOptions>(
    EMPTY_AI_CALL_FILTER_OPTIONS
  );
  const [aiCallStats, setAiCallStats] = useState<AiCallLogStats>(EMPTY_AI_CALL_STATS);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const deferredAiCallLogs = useDeferredValue(aiCallLogs);
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
  const [savingCompatPromptConfig, setSavingCompatPromptConfig] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [testingUpstream, setTestingUpstream] = useState(false);
  const [compatPromptKeywordsInput, setCompatPromptKeywordsInput] = useState("");
  const [compatPromptHintInput, setCompatPromptHintInput] = useState("");
  const [compatPromptRulesDraft, setCompatPromptRulesDraft] = useState<CompatPromptRule[]>([]);
  const [compatPromptRuleSearch, setCompatPromptRuleSearch] = useState("");
  const [compatPromptRulesJsonInput, setCompatPromptRulesJsonInput] = useState("[]");
  const [showCompatPromptRulesJsonEditor, setShowCompatPromptRulesJsonEditor] = useState(false);
  const [compatPromptRulesImportMode, setCompatPromptRulesImportMode] = useState<
    "append" | "replace"
  >("append");
  const compatPromptRulesFileInputRef = useRef<HTMLInputElement | null>(null);
  const [compatPromptDefaults, setCompatPromptDefaults] = useState<CompatPromptConfig | null>(
    null
  );

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
  const resolveMappingChannel = (mapping: KeyModelMapping) => {
    if (typeof mapping.upstreamChannelId === "number") {
      return channels.find((item) => item.id === mapping.upstreamChannelId) ?? null;
    }
    return selectedChannelForKey;
  };
  const resolveImportedChannelBinding = (channelName: string | null, channelId: number | null) => {
    const normalizedName = channelName?.trim().toLowerCase() ?? "";
    if (normalizedName) {
      const matchedByName = channels.filter(
        (item) => item.name.trim().toLowerCase() === normalizedName
      );
      if (matchedByName.length === 1) {
        return {
          id: matchedByName[0].id,
          requested: true,
          resolved: true
        };
      }
    }

    if (typeof channelId === "number") {
      const matchedById = channels.find((item) => item.id === channelId) ?? null;
      if (matchedById) {
        return {
          id: matchedById.id,
          requested: true,
          resolved: true
        };
      }
    }

    return {
      id: null,
      requested: Boolean(normalizedName) || typeof channelId === "number",
      resolved: false
    };
  };
  const findChannelModelProfile = (channel: UpstreamChannel | null, targetModel: string) => {
    const normalizedTargetModel = targetModel.trim().toLowerCase();
    if (!normalizedTargetModel || !channel) {
      return null;
    }

    return (
      channel.upstreamModels.find(
        (item) => item.model.trim().toLowerCase() === normalizedTargetModel
      ) ??
      channel.upstreamModels.find(
        (item) => (item.aliasModel?.trim().toLowerCase() ?? "") === normalizedTargetModel
      ) ??
      null
    );
  };
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
  const nativeCodexExportBundle = useMemo(() => {
    const localKey = keyForm.localKey.trim();
    if (!localKey) {
      return null;
    }

    const provider = selectedKey?.provider ?? selectedChannelForKey?.provider ?? "openai";
    const providerName = (keyForm.name || "gateway").trim() || "gateway";
    const modelPool =
      selectedChannelForKey?.upstreamModels?.length
        ? selectedChannelForKey.upstreamModels
        : selectedKey?.upstreamModels ?? [];
    const preferredModel =
      selectedKey?.activeModelOverride?.trim() ||
      selectedKey?.defaultModel ||
      selectedChannelForKey?.defaultModel ||
      "gpt-4.1-mini";

    return createCodexExportBundle({
      localKey,
      provider,
      providerName,
      gatewayEndpoint: gatewayV1Endpoint,
      preferredModel,
      modelPool: modelPool.map((item) => ({
        model: item.model,
        aliasModel: item.aliasModel,
        contextWindow: item.contextWindow,
        enabled: item.enabled
      })),
      applyPatchToolType: nativeCodexApplyPatchToolType
    });
  }, [
    gatewayV1Endpoint,
    keyForm.localKey,
    keyForm.name,
    nativeCodexApplyPatchToolType,
    selectedChannelForKey,
    selectedKey
  ]);
  const nativeCodexSelectedModelProfile = useMemo(() => {
    const modelPool =
      selectedChannelForKey?.upstreamModels?.length
        ? selectedChannelForKey.upstreamModels
        : selectedKey?.upstreamModels ?? [];
    if (!modelPool.length) {
      return null;
    }

    const preferredModel =
      selectedKey?.activeModelOverride?.trim() ||
      selectedKey?.defaultModel ||
      selectedChannelForKey?.defaultModel ||
      "";
    const normalizedPreferred = preferredModel.trim().toLowerCase();
    const isMatched = (item: UpstreamModelConfig) =>
      item.model.trim().toLowerCase() === normalizedPreferred ||
      (item.aliasModel?.trim().toLowerCase() ?? "") === normalizedPreferred;

    return (
      modelPool.find((item) => isMatched(item) && item.enabled) ??
      modelPool.find((item) => isMatched(item)) ??
      modelPool.find((item) => item.enabled) ??
      modelPool[0] ??
      null
    );
  }, [
    selectedChannelForKey?.defaultModel,
    selectedChannelForKey?.upstreamModels,
    selectedKey?.activeModelOverride,
    selectedKey?.defaultModel,
    selectedKey?.upstreamModels
  ]);
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
  const mappingBindChannelOptions = useMemo(
    () => [
      {
        label: t("继承 Key 绑定渠道", "Inherit key bound channel"),
        value: "__inherit__"
      },
      ...channels.map((item) => ({
        label: `${item.name} · ${PROVIDER_META[item.provider].label}`,
        value: String(item.id)
      }))
    ],
    [channels, t]
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

  const aiCallModelSelectOptions = useMemo(() => {
    const source =
      aiCallFilterOptions.upstreamModels.length > 0
        ? aiCallFilterOptions.upstreamModels
        : aiCallModelOptions;
    return [
      { label: t("全部模型", "All Models"), value: "__all__" },
      ...source.map((model) => ({
        label: model,
        value: model
      }))
    ];
  }, [aiCallFilterOptions.upstreamModels, aiCallModelOptions, t]);

  const aiCallTypeOptions = useMemo(
    () => [
      { label: t("全部调用", "All Calls"), value: "__all__" },
      { label: t("主调用", "Main Calls"), value: "main" },
      { label: t("辅助视觉", "Vision Fallback"), value: "vision_fallback" }
    ],
    [t]
  );

  const aiCallRouteOptions = useMemo(
    () => [
      { label: t("全部路由", "All Routes"), value: "__all__" },
      ...aiCallFilterOptions.routes.map((item) => ({
        label: item,
        value: item
      }))
    ],
    [aiCallFilterOptions.routes, t]
  );

  const aiCallRequestWireOptions = useMemo(
    () => [
      { label: t("全部请求协议", "All Request APIs"), value: "__all__" },
      ...aiCallFilterOptions.requestWireApis.map((item) => ({
        label: item,
        value: item
      }))
    ],
    [aiCallFilterOptions.requestWireApis, t]
  );

  const aiCallUpstreamWireOptions = useMemo(
    () => [
      { label: t("全部上游协议", "All Upstream APIs"), value: "__all__" },
      ...aiCallFilterOptions.upstreamWireApis.map((item) => ({
        label: item,
        value: item
      }))
    ],
    [aiCallFilterOptions.upstreamWireApis, t]
  );

  const aiCallRequestedModelOptions = useMemo(
    () => [
      { label: t("全部请求模型", "All Requested Models"), value: "__all__" },
      ...aiCallFilterOptions.requestedModels.map((item) => ({
        label: item,
        value: item
      }))
    ],
    [aiCallFilterOptions.requestedModels, t]
  );

  const aiCallClientModelOptions = useMemo(
    () => [
      { label: t("全部客户端模型", "All Client Models"), value: "__all__" },
      ...aiCallFilterOptions.clientModels.map((item) => ({
        label: item,
        value: item
      }))
    ],
    [aiCallFilterOptions.clientModels, t]
  );

  const aiCallStreamOptions = useMemo(
    () => [
      { label: t("全部流式", "All Stream Modes"), value: "__all__" },
      { label: t("仅 stream", "Stream Only"), value: "stream" },
      { label: t("仅非 stream", "Non-stream Only"), value: "non_stream" }
    ],
    [t]
  );
  const expandedAiCallLogIdSet = useMemo(
    () => new Set(expandedAiCallLogIds),
    [expandedAiCallLogIds]
  );

  const resolvedUsageBucketMinutes = useMemo(
    () => resolveUsageBucketMinutes(usageMinutes, usageBucketMode),
    [usageMinutes, usageBucketMode]
  );

  const usagePrimaryMetricMeta = useMemo(() => USAGE_METRIC_META[usageMetric], [usageMetric]);
  const hasCustomAiCallDateRange = Boolean(
    aiCallDateRange[0]?.trim() && aiCallDateRange[1]?.trim()
  );
  const hasCustomUsageDateRange = Boolean(
    usageDateRange[0]?.trim() && usageDateRange[1]?.trim()
  );
  const usageDateFrom = usageDateRange[0] ?? "";
  const usageDateTo = usageDateRange[1] ?? "";
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

  // 自适应趋势图高度：数据少时矮，多时高
  const usageTimelineChartHeight = useMemo(() => {
    const count = usageTimelinePoints.length;
    if (count <= 5) return 180;
    if (count <= 20) return 240;
    if (count <= 60) return 300;
    return 360;
  }, [usageTimelinePoints]);

  const usageTimelineChartOption = useMemo<EChartsOption | null>(() => {
    if (!usageTimelinePoints.length) {
      return null;
    }
    const metricLabel = usagePrimaryMetricMeta.label;
    const isTokenMetric = usagePrimaryMetricMeta.isToken;

    return {
      color: PIE_COLORS,
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc"
        },
        extraCssText: "border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);",
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
            color: "#e2e8f0",
            type: "dashed"
          }
        },
        nameTextStyle: {
          color: "#64748b"
        }
      },
      dataZoom: usageTimelinePoints.length > 90 ? [{ type: "inside", start: 40, end: 100 }] : [],
      animationDuration: 800,
      animationEasing: "cubicOut",
      series: [
        {
          name: metricLabel,
          type: "line",
          smooth: 0.35,
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            shadowColor: "rgba(59, 130, 246, 0.3)",
            shadowBlur: 8,
            shadowOffsetY: 4
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(59, 130, 246, 0.25)" },
                { offset: 0.5, color: "rgba(59, 130, 246, 0.08)" },
                { offset: 1, color: "rgba(59, 130, 246, 0.01)" }
              ]
            }
          },
          emphasis: {
            focus: "series",
            itemStyle: {
              borderWidth: 2,
              borderColor: "#fff"
            }
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
      color: PIE_COLORS,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 0,
        textStyle: { color: "#f8fafc", fontSize: 12 },
        extraCssText: "border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);",
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
            color: "#e2e8f0",
            type: "dashed"
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
      animationDuration: 600,
      animationEasing: "cubicOut",
      series: [
        {
          name: usagePrimaryMetricMeta.label,
          type: "bar",
          barMaxWidth: 14,
          data: topKeys.map((item) => pickUsageMetricValue(item, usageMetric)),
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            shadowColor: "rgba(59, 130, 246, 0.15)",
            shadowBlur: 6,
            shadowOffsetY: 2
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
      color: PIE_COLORS,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(15, 23, 42, 0.92)",
        borderColor: "rgba(255, 255, 255, 0.08)",
        borderWidth: 0,
        textStyle: { color: "#f8fafc", fontSize: 12 },
        extraCssText: "border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);",
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
            color: "#e2e8f0",
            type: "dashed"
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
      animationDuration: 600,
      animationEasing: "cubicOut",
      series: [
        {
          name: usagePrimaryMetricMeta.label,
          type: "bar",
          barMaxWidth: 14,
          data: topModels.map((item) => pickUsageMetricValue(item, usageMetric)),
          itemStyle: {
            borderRadius: [0, 6, 6, 0],
            shadowColor: "rgba(59, 130, 246, 0.15)",
            shadowBlur: 6,
            shadowOffsetY: 2
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
          ? `${item.name} · ${item.aliasModel} -> ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`
          : `${item.name} · ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`,
        value: item.model
      })),
    [channelForm.upstreamModels]
  );

  const keyOverflowModelOptions = useMemo(() => {
    const prioritizedChannels = [...channels]
      .filter((item) => item.enabled)
      .sort((a, b) => {
        if (a.id === keyForm.upstreamChannelId) {
          return -1;
        }
        if (b.id === keyForm.upstreamChannelId) {
          return 1;
        }
        return a.name.localeCompare(b.name, "zh-CN");
      });

    const options = prioritizedChannels.flatMap((channel) =>
      channel.upstreamModels
        .filter((item) => item.enabled)
        .map((item) => ({
          label: item.aliasModel
            ? `${channel.name} · ${PROVIDER_META[channel.provider].label} · ${item.name} · ${item.aliasModel} -> ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`
            : `${channel.name} · ${PROVIDER_META[channel.provider].label} · ${item.name} · ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`,
          value: serializeOverflowModelSelection(item.model, channel.id)
        }))
    );

    const currentValue = keyForm.contextOverflowModel.trim();
    if (currentValue && !options.some((item) => item.value === currentValue)) {
      const parsed = parseOverflowModelSelection(currentValue);
      options.unshift({
        label: parsed?.upstreamChannelId
          ? `${t("当前已保存", "Saved Selection")} · channel=${parsed.upstreamChannelId} · ${parsed.model}`
          : `${t("当前已保存", "Saved Selection")} · ${parsed?.model ?? currentValue}`,
        value: currentValue
      });
    }

    return options;
  }, [channels, keyForm.contextOverflowModel, keyForm.upstreamChannelId, t]);

  const mappingOverflowModelOptions = useMemo(() => {
    const prioritizedChannels = [...channels]
      .filter((item) => item.enabled)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    const options = prioritizedChannels.flatMap((channel) =>
      channel.upstreamModels
        .filter((m) => m.enabled)
        .map((m) => ({
          label: m.aliasModel
            ? `${channel.name} · ${PROVIDER_META[channel.provider].label} · ${m.name} · ${m.aliasModel} -> ${m.model}`
            : `${channel.name} · ${PROVIDER_META[channel.provider].label} · ${m.name} · ${m.model}`,
          value: serializeOverflowModelSelection(m.model, channel.id)
        }))
    );

    return options;
  }, [channels, t]);

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
          ? `${item.name} · ${item.aliasModel} -> ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`
          : `${item.name} · ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`,
        value: item.model
      }));
  }

  function applyAiCallQuickRange(minutes: number) {
    setAiCallDateRange(buildRecentDateRange(minutes));
  }

  function resetAiCallFilters() {
    setAiCallKeyFilter(null);
    setAiCallDateRange([]);
    setAiCallKeywordFilter("");
    setAiCallRouteFilter("");
    setAiCallRequestWireFilter("");
    setAiCallUpstreamWireFilter("");
    setAiCallModelFilter("");
    setAiCallRequestedModelFilter("");
    setAiCallClientModelFilter("");
    setAiCallStreamFilter("");
    setAiCallTypeFilter("");
  }

  function toggleAiCallLogExpanded(id: string) {
    setExpandedAiCallLogIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function expandVisibleAiCallLogs() {
    setExpandedAiCallLogIds(aiCallLogs.map((item) => item.id));
  }

  function collapseVisibleAiCallLogs() {
    setExpandedAiCallLogIds([]);
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
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeModule,
    autoRefreshAiCallLogs,
    aiCallLogLimit,
    aiCallKeyFilter,
    aiCallDateRange[0],
    aiCallDateRange[1],
    aiCallKeywordFilter,
    aiCallRouteFilter,
    aiCallRequestWireFilter,
    aiCallUpstreamWireFilter,
    aiCallModelFilter,
    aiCallRequestedModelFilter,
    aiCallClientModelFilter,
    aiCallStreamFilter,
    aiCallTypeFilter
  ]);

  useEffect(() => {
    if (routeModule !== "usage" && routeModule !== "dashboard") {
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
    usageDateFrom,
    usageDateTo
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
      await Promise.all([loadChannels(), loadKeys(), loadGatewayConfig()]);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  }

  function applyCompatPromptConfig(config: CompatPromptConfig) {
    const normalizedRules = normalizeCompatPromptRules(config.modelPromptRules ?? []);
    setCompatPromptKeywordsInput(formatCompatPromptKeywordsInput(config.agentsMdKeywords));
    setCompatPromptHintInput(config.chineseReplyHint);
    setCompatPromptRulesDraft(normalizedRules);
    setCompatPromptRuleSearch("");
    setCompatPromptRulesJsonInput(formatCompatPromptRulesJson(normalizedRules));
  }

  function addCompatPromptRule(overrides: Partial<CompatPromptRule> = {}) {
    setCompatPromptRulesDraft((prev) => [
      ...prev,
      createCompatPromptRuleDraft({
        enabled: true,
        ...overrides
      })
    ]);
  }

  function updateCompatPromptRule(
    index: number,
    updater: (rule: CompatPromptRule) => CompatPromptRule
  ) {
    setCompatPromptRulesDraft((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? updater(item) : item))
    );
  }

  function removeCompatPromptRule(index: number) {
    setCompatPromptRulesDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  function duplicateCompatPromptRule(index: number) {
    setCompatPromptRulesDraft((prev) => {
      if (index < 0 || index >= prev.length) {
        return prev;
      }
      const target = prev[index];
      const duplicated = createCompatPromptRuleDraft({
        enabled: target.enabled,
        provider: target.provider,
        upstreamModelPattern: target.upstreamModelPattern,
        hint: target.hint
      });
      return [...prev.slice(0, index + 1), duplicated, ...prev.slice(index + 1)];
    });
  }

  function exportCompatPromptRulesToJsonDraft() {
    setCompatPromptRulesJsonInput(formatCompatPromptRulesJson(compatPromptRulesDraft));
    notifyInfo(t("已生成最新 JSON 草稿。", "JSON draft refreshed from current rules."));
  }

  function applyImportedCompatPromptRules(
    incomingRules: CompatPromptRule[],
    mode: "append" | "replace",
    sourceLabel: string
  ) {
    const normalizedIncoming = normalizeCompatPromptRules(incomingRules);
    const mergedRules = ensureCompatPromptRuleIdsUnique(
      mode === "append"
        ? [...compatPromptRulesDraft, ...normalizedIncoming]
        : [...normalizedIncoming]
    );
    if (mergedRules.length > 128) {
      notifyError(t("模型规则最多 128 条。", "Model prompt rules are limited to 128."));
      return;
    }
    setCompatPromptRulesDraft(mergedRules);
    setCompatPromptRuleSearch("");
    setCompatPromptRulesJsonInput(formatCompatPromptRulesJson(mergedRules));
    notifySuccess(
      mode === "append"
        ? t(
            `已从 ${sourceLabel} 批量追加 ${normalizedIncoming.length} 条规则。`,
            `Appended ${normalizedIncoming.length} rules from ${sourceLabel}.`
          )
        : t(
            `已从 ${sourceLabel} 批量覆盖规则列表（${normalizedIncoming.length} 条）。`,
            `Replaced rules from ${sourceLabel} (${normalizedIncoming.length} items).`
          )
    );
  }

  function importCompatPromptRulesFromJsonDraft(mode: "append" | "replace" = "replace") {
    try {
      const nextRules = parseCompatPromptRulesJson(compatPromptRulesJsonInput);
      applyImportedCompatPromptRules(nextRules, mode, "JSON");
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("模型规则 JSON 无效。", "Invalid model rules JSON.")
      );
    }
  }

  function openCompatPromptRulesFileImporter(mode: "append" | "replace") {
    setCompatPromptRulesImportMode(mode);
    const input = compatPromptRulesFileInputRef.current;
    if (!input) {
      notifyError(t("导入控件不可用。", "Import control unavailable."));
      return;
    }
    input.value = "";
    input.click();
  }

  async function handleCompatPromptRulesFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const nextRules = parseCompatPromptRulesJson(text);
      applyImportedCompatPromptRules(nextRules, compatPromptRulesImportMode, file.name);
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("批量导入失败。", "Batch import failed.")
      );
    }
  }

  async function loadGatewayConfig() {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`加载网关配置失败 (${response.status})`);
    }
    const data = (await response.json()) as ConfigSummaryResponse;
    setCompatPromptDefaults(data.compatPromptDefaults);
    applyCompatPromptConfig(data.compatPromptConfig);
  }

  async function saveGatewayCompatPromptConfig() {
    const agentsMdKeywords = parseCompatPromptKeywordsInput(compatPromptKeywordsInput);
    const chineseReplyHint = compatPromptHintInput.trim();
    const modelPromptRules = normalizeCompatPromptRules(compatPromptRulesDraft);

    if (!agentsMdKeywords.length) {
      notifyError(t("至少保留一个 AGENTS 关键词。", "Keep at least one AGENTS keyword."));
      return;
    }
    if (!chineseReplyHint) {
      notifyError(t("默认提示词不能为空。", "Default hint cannot be empty."));
      return;
    }
    if (modelPromptRules.length > 128) {
      notifyError(t("模型规则最多 128 条。", "Model prompt rules are limited to 128."));
      return;
    }
    for (let i = 0; i < modelPromptRules.length; i += 1) {
      if (!modelPromptRules[i].hint) {
        notifyError(
          t(
            `第 ${i + 1} 条模型规则缺少 hint。`,
            `Rule #${i + 1} is missing hint.`
          )
        );
        return;
      }
    }
    setCompatPromptRulesJsonInput(formatCompatPromptRulesJson(modelPromptRules));

    setSavingCompatPromptConfig(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          compatPromptConfig: {
            agentsMdKeywords,
            chineseReplyHint,
            modelPromptRules
          }
        })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `保存网关配置失败 (${response.status})`);
      }
      const data = (await response.json()) as ConfigSummaryResponse;
      setCompatPromptDefaults(data.compatPromptDefaults);
      applyCompatPromptConfig(data.compatPromptConfig);
      notifySuccess(t("网关注入提示词配置已保存。", "Gateway injected prompt config saved."));
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("保存网关配置失败", "Failed to save gateway config")
      );
    } finally {
      setSavingCompatPromptConfig(false);
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
      setKeyForm(createEmptyKeyFormState(generateLocalKey()));
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
      if (aiCallDateRange[0]?.trim() && aiCallDateRange[1]?.trim()) {
        params.set("from", aiCallDateRange[0].trim());
        params.set("to", aiCallDateRange[1].trim());
      }
      if (aiCallKeywordFilter.trim()) {
        params.set("keyword", aiCallKeywordFilter.trim());
      }
      if (aiCallRouteFilter.trim()) {
        params.set("route", aiCallRouteFilter.trim());
      }
      if (aiCallRequestWireFilter.trim()) {
        params.set("requestWireApi", aiCallRequestWireFilter.trim());
      }
      if (aiCallUpstreamWireFilter.trim()) {
        params.set("upstreamWireApi", aiCallUpstreamWireFilter.trim());
      }
      if (aiCallModelFilter.trim()) {
        params.set("model", aiCallModelFilter.trim());
      }
      if (aiCallRequestedModelFilter.trim()) {
        params.set("requestedModel", aiCallRequestedModelFilter.trim());
      }
      if (aiCallClientModelFilter.trim()) {
        params.set("clientModel", aiCallClientModelFilter.trim());
      }
      if (aiCallStreamFilter === "stream") {
        params.set("stream", "true");
      } else if (aiCallStreamFilter === "non_stream") {
        params.set("stream", "false");
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
        filterOptions?: AiCallLogFilterOptions;
        stats?: AiCallLogStats;
      };
      const normalizedFilterOptions = normalizeAiCallFilterOptions(body.filterOptions);
      const nextItems = Array.isArray(body.items) ? body.items : [];
      startTransition(() => {
        setAiCallLogs(nextItems);
        setAiCallModelOptions(
          Array.isArray(body.models)
            ? body.models
            : normalizedFilterOptions.upstreamModels
        );
        setAiCallFilterOptions(normalizedFilterOptions);
        setAiCallStats(body.stats ?? EMPTY_AI_CALL_STATS);
        setExpandedAiCallLogIds((prev) => prev.filter((id) => nextItems.some((item) => item.id === id)));
      });
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
      setAiCallFilterOptions(EMPTY_AI_CALL_FILTER_OPTIONS);
      setAiCallStats(EMPTY_AI_CALL_STATS);
      setExpandedAiCallLogIds([]);
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
    setKeyForm(createEmptyKeyFormState(generateLocalKey()));
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
            contextWindow: preset.contextWindow,
            upstreamWireApi: preset.upstreamWireApi,
            glmCodexThinkingThreshold: "low",
            supportsVision: preset.supportsVision,
            visionModel: preset.visionModel
          })
        ]
      })
    );
    notifyInfo(
      preset.contextWindow
        ? `已应用：${preset.label}（上下文 ${formatNumber(preset.contextWindow)}）`
        : `已应用：${preset.label}`
    );
  }

  function addUpstreamModel() {
    setChannelForm((prev) =>
      syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: [
          ...prev.upstreamModels,
          createUpstreamModelDraft({
            name: `模型 ${prev.upstreamModels.length + 1}`,
            upstreamWireApi: "responses",
            glmCodexThinkingThreshold: "low"
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
          upstreamChannelId: null,
          thinkingType: null,
          enabled: true,
          dynamicModelSwitch: false,
          contextSwitchThreshold: 128000,
          contextOverflowModel: null
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
      for (const m of keyForm.modelMappings) {
        if (m.dynamicModelSwitch && !(m.contextOverflowModel?.trim())) {
          throw new Error(`映射「${m.clientModel}」启用了动态切模但未设置溢出模型。`);
        }
      }
      const modelMappings = keyForm.modelMappings
        .map((item) => ({
          id: item.id,
          clientModel: item.clientModel.trim(),
          targetModel: item.targetModel.trim(),
          upstreamChannelId:
            typeof item.upstreamChannelId === "number" ? item.upstreamChannelId : null,
          thinkingType:
            item.thinkingType === "enabled" ||
            item.thinkingType === "disabled" ||
            item.thinkingType === "auto"
              ? item.thinkingType
              : null,
          enabled: item.enabled,
          dynamicModelSwitch: item.dynamicModelSwitch,
          contextSwitchThreshold: item.contextSwitchThreshold,
          contextOverflowModel: item.contextOverflowModel?.trim() || undefined
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
        contextWindow:
          typeof item.contextWindow === "number" && Number.isFinite(item.contextWindow)
            ? Math.floor(item.contextWindow)
            : null,
        glmCodexThinkingThreshold: normalizeGlmCodexThinkingThreshold(
          item.glmCodexThinkingThreshold
        ),
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
        if (item.contextWindow !== null && (!Number.isInteger(item.contextWindow) || item.contextWindow < 256)) {
          throw new Error(`模型「${item.name}」的上下文长度必须是 >= 256 的整数。`);
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

  async function updateBoundChannelGlmThinkingThreshold(
    mapping: KeyModelMapping,
    threshold: GlmCodexThinkingThreshold
  ) {
    const mappingChannel = resolveMappingChannel(mapping);
    if (!mappingChannel) {
      notifyError(t("请先绑定上游渠道。", "Bind an upstream channel first."));
      return;
    }

    const matchedProfile = findChannelModelProfile(mappingChannel, mapping.targetModel);
    if (!matchedProfile) {
      notifyError(
        t(
          "当前映射指向的内部模型不在所选渠道模型池中，无法设置 GLM 深度思考阈值。",
          "The mapped internal model is not in the selected channel model pool, so its GLM thinking threshold cannot be updated."
        )
      );
      return;
    }

    setSavingChannel(true);
    try {
      const upstreamModels = mappingChannel.upstreamModels.map((item) =>
        item.id === matchedProfile.id
          ? {
              ...item,
              glmCodexThinkingThreshold: normalizeGlmCodexThinkingThreshold(threshold)
            }
          : item
      );

      const response = await fetch(`/api/upstreams/${mappingChannel.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          upstreamModels
        })
      });
      const body = (await response.json().catch(() => ({}))) as UpstreamChannel & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `保存失败 (${response.status})`);
      }

      await Promise.all([loadChannels(), loadKeys()]);
      if (selectedChannelId === body.id) {
        setSelectedChannelId(body.id);
        setChannelForm(toChannelForm(body));
      }
      notifySuccess(
        t(
          `已更新「${mappingChannel.name}」中 ${matchedProfile.model} 的 GLM 深度思考阈值。`,
          `Updated GLM thinking threshold for ${matchedProfile.model} in ${mappingChannel.name}.`
        )
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : t("保存失败", "Failed to save"));
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

  async function copyNativeCodexBundleFile(
    fileKey: keyof CodexExportBundle["files"],
    successMessage: string,
    failureMessage: string
  ) {
    const file = nativeCodexExportBundle?.files[fileKey];
    if (!file) {
      notifyError(failureMessage);
      return;
    }
    await copyTextToClipboard(file.content, successMessage);
  }

  async function copyLocalKey() {
    await copyTextToClipboard(keyForm.localKey, "本地 Key 已复制。");
  }

  function handleQuickExportModels() {
    const exported = quickExportModels(channelForm.upstreamModels);
    setQuickExportJson(exported);
    setQuickExportDialogVisible(true);
  }

  async function handleQuickCopyModels() {
    await copyTextToClipboard(
      quickExportModels(channelForm.upstreamModels),
      t("模型池已复制到剪贴板。", "Model pool copied to clipboard.")
    );
  }

  function handleQuickExportKeyMappings() {
    const exported = quickExportKeyMappings(
      keyForm.modelMappings,
      (channelId) => channels.find((item) => item.id === channelId)?.name ?? null
    );
    setQuickExportKeyMappingJson(exported);
    setQuickExportKeyMappingDialogVisible(true);
  }

  async function handleQuickCopyKeyMappings() {
    await copyTextToClipboard(
      quickExportKeyMappings(
        keyForm.modelMappings,
        (channelId) => channels.find((item) => item.id === channelId)?.name ?? null
      ),
      t("模型映射已复制到剪贴板。", "Model mappings copied to clipboard.")
    );
  }

  function handleOpenQuickImportDialog() {
    setQuickImportJson("");
    setQuickImportDialogVisible(true);
  }

  function handleOpenQuickImportKeyMappingDialog() {
    setQuickImportKeyMappingJson("");
    setQuickImportKeyMappingDialogVisible(true);
  }

  function handleQuickImportConfirm() {
    const result = quickImportModels(quickImportJson);
    if (!result.ok) {
      notifyError(result.error);
      return;
    }
    setChannelForm((prev) => {
      const incoming = result.models.map((m) =>
        createUpstreamModelDraft({
          name: m.name,
          aliasModel: m.aliasModel,
          model: m.model,
          contextWindow: m.contextWindow,
          upstreamWireApi: m.upstreamWireApi as "responses" | "chat_completions" | "anthropic_messages",
          glmCodexThinkingThreshold: m.glmCodexThinkingThreshold as "off" | "low" | "medium" | "high",
          supportsVision: m.supportsVision,
          visionChannelId: m.visionChannelId,
          visionModel: m.visionModel,
          enabled: m.enabled
        })
      );
      return syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: [...prev.upstreamModels, ...incoming]
      });
    });
    setQuickImportDialogVisible(false);
    notifySuccess(result.note);
  }

  function handleQuickImportReplace() {
    const result = quickImportModels(quickImportJson);
    if (!result.ok) {
      notifyError(result.error);
      return;
    }
    setChannelForm((prev) => {
      const incoming = result.models.map((m) =>
        createUpstreamModelDraft({
          name: m.name,
          aliasModel: m.aliasModel,
          model: m.model,
          contextWindow: m.contextWindow,
          upstreamWireApi: m.upstreamWireApi as "responses" | "chat_completions" | "anthropic_messages",
          glmCodexThinkingThreshold: m.glmCodexThinkingThreshold as "off" | "low" | "medium" | "high",
          supportsVision: m.supportsVision,
          visionChannelId: m.visionChannelId,
          visionModel: m.visionModel,
          enabled: m.enabled
        })
      );
      return syncChannelFormWithModelPool({
        ...prev,
        upstreamModels: incoming,
        defaultModel: incoming[0]?.model ?? prev.defaultModel
      });
    });
    setQuickImportDialogVisible(false);
    notifySuccess(result.note);
  }

  function handleQuickImportKeyMappings(replaceAll: boolean) {
    const result = quickImportKeyMappings(quickImportKeyMappingJson);
    if (!result.ok) {
      notifyError(result.error);
      return;
    }

    let unresolvedMappingChannelCount = 0;
    let unresolvedOverflowChannelCount = 0;
    const incoming = result.mappings.map((item) => {
      const mappingBinding = resolveImportedChannelBinding(
        item.upstreamChannelName,
        item.upstreamChannelId
      );
      const overflowBinding = resolveImportedChannelBinding(
        item.contextOverflowChannelName,
        item.contextOverflowChannelId
      );
      if (mappingBinding.requested && !mappingBinding.resolved) {
        unresolvedMappingChannelCount += 1;
      }
      if (
        item.contextOverflowModel &&
        overflowBinding.requested &&
        !overflowBinding.resolved
      ) {
        unresolvedOverflowChannelCount += 1;
      }
      return {
        id: generateMappingId(),
        clientModel: item.clientModel,
        targetModel: item.targetModel,
        upstreamChannelId: mappingBinding.id,
        thinkingType: item.thinkingType,
        enabled: item.enabled,
        dynamicModelSwitch: item.dynamicModelSwitch,
        contextSwitchThreshold: item.contextSwitchThreshold,
        contextOverflowModel: item.contextOverflowModel
          ? serializeOverflowModelSelection(item.contextOverflowModel, overflowBinding.id)
          : null
      };
    });

    setKeyForm((prev) => ({
      ...prev,
      modelMappings: replaceAll ? incoming : [...prev.modelMappings, ...incoming]
    }));
    setQuickImportKeyMappingDialogVisible(false);
    notifySuccess(result.note);
    if (unresolvedMappingChannelCount || unresolvedOverflowChannelCount) {
      notifyInfo(
        t(
          `已导入，但有 ${unresolvedMappingChannelCount} 条映射渠道绑定、${unresolvedOverflowChannelCount} 条溢出模型渠道绑定未命中当前工作区，已自动回退为继承当前 Key 或仅保留模型名。`,
          `Imported with fallback: ${unresolvedMappingChannelCount} mapping channel bindings and ${unresolvedOverflowChannelCount} overflow channel bindings were not found in this workspace, so they now inherit the key or keep only the model name.`
        )
      );
    }
  }

  function handleMenuRoute(next: string) {
    if (
      next === "access" ||
      next === "prompt" ||
      next === "export" ||
      next === "upstream" ||
      next === "runtime" ||
      next === "logs" ||
      next === "calls" ||
      next === "usage" ||
      next === "docs"
      || next === "dashboard"
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
    const manualContextWindow =
      typeof matchedProfile?.contextWindow === "number" && Number.isFinite(matchedProfile.contextWindow)
        ? matchedProfile.contextWindow
        : null;
    const contextWindow = manualContextWindow ?? inferContextWindowFromModel(model, modelProvider);
    const maxThinkingTokens = resolveThinkingTokens(contextWindow);
    const { autoCompactTokenLimit } = resolveCodexTokenBudgets(contextWindow);
    const claudeMaxOutputTokens = resolveClaudeMaxOutputTokens(contextWindow);
    const claudeModel = formatClaudeModelWithContext(model, contextWindow);
    const providerName = (keyForm.name || "gateway").trim() || "gateway";

    return {
      localKey,
      origin,
      endpoint,
      model,
      claudeModel,
      contextWindow,
      maxThinkingTokens,
      claudeMaxOutputTokens,
      autoCompactTokenLimit,
      providerName
    };
  }

  function buildCcSwitchCodexDeepLink() {
    const {
      localKey,
      origin,
      endpoint,
      model,
      providerName,
      contextWindow,
      autoCompactTokenLimit
    } = resolveCcSwitchProviderContext();
    const codexConfigToml = buildCcSwitchCodexConfigToml();

    const inlineConfig = buildCcSwitchCodexInlineConfig();
    const params = new URLSearchParams({
      resource: "provider",
      app: "codex",
      name: `${providerName} (Gateway)`,
      homepage: origin,
      endpoint,
      apiKey: localKey,
      model,
      notes: contextWindow
        ? `Imported from Codex Gateway Hub · context_window=${contextWindow} · compact_limit=${autoCompactTokenLimit ?? "-"}`
        : "Imported from Codex Gateway Hub",
      configFormat: "json",
      config: toBase64Utf8(JSON.stringify(inlineConfig)),
      enabled: "true"
    });

    return `ccswitch://v1/import?${params.toString()}`;
  }

  function buildCcSwitchCodexInlineConfig() {
    const authJson = buildCcSwitchCodexAuthJson();
    return {
      auth: authJson,
      config: buildCcSwitchCodexConfigToml()
    };
  }

  function buildCcSwitchCodexAuthJson() {
    const { localKey } = resolveCcSwitchProviderContext();
    return {
      OPENAI_API_KEY: localKey
    };
  }

  function buildCcSwitchCodexConfigToml() {
    const {
      endpoint,
      model,
      providerName,
      contextWindow,
      autoCompactTokenLimit
    } = resolveCcSwitchProviderContext();
    const providerKey = sanitizeTomlKey(providerName);
    return [
      `model_provider = "${providerKey}"`,
      `model = "${model}"`,
      ...(contextWindow ? [`model_context_window = ${contextWindow}`] : []),
      ...(autoCompactTokenLimit ? [`model_auto_compact_token_limit = ${autoCompactTokenLimit}`] : []),
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
  }

  function buildCcSwitchCodexContextPatch() {
    const { contextWindow, autoCompactTokenLimit } = resolveCcSwitchProviderContext();
    return [
      "# Codex context tuning patch (generated by Codex Gateway Hub)",
      "# Paste into CC Switch -> Codex provider config.toml",
      contextWindow ? `model_context_window = ${contextWindow}` : "# model_context_window = <set based on model>",
      autoCompactTokenLimit
        ? `model_auto_compact_token_limit = ${autoCompactTokenLimit}`
        : "# model_auto_compact_token_limit = <optional>"
    ].join("\n");
  }

  function buildCcSwitchClaudeInlineConfig() {
    const {
      localKey,
      origin,
      claudeModel,
      contextWindow,
      maxThinkingTokens,
      claudeMaxOutputTokens
    } = resolveCcSwitchProviderContext();
    const anthropicBaseUrl = origin;
    return {
      env: {
        ANTHROPIC_AUTH_TOKEN: localKey,
        ANTHROPIC_BASE_URL: anthropicBaseUrl,
        ANTHROPIC_MODEL: claudeModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: claudeModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: claudeModel,
        ANTHROPIC_DEFAULT_OPUS_MODEL: claudeModel,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(claudeMaxOutputTokens),
        CLAUDE_CODE_EFFORT_LEVEL: "high",
        MAX_THINKING_TOKENS: String(maxThinkingTokens),
        GATEWAY_MODEL_CONTEXT_WINDOW: contextWindow ? String(contextWindow) : ""
      }
    };
  }

  function buildCcSwitchClaudeDeepLink() {
    const {
      localKey,
      origin,
      claudeModel,
      providerName,
      contextWindow,
      claudeMaxOutputTokens
    } = resolveCcSwitchProviderContext();
    const anthropicBaseUrl = origin;
    const inlineConfig = buildCcSwitchClaudeInlineConfig();
    const params = new URLSearchParams({
      resource: "provider",
      app: "claude",
      name: `${providerName} (Gateway)`,
      homepage: origin,
      endpoint: anthropicBaseUrl,
      apiKey: localKey,
      model: claudeModel,
      haikuModel: claudeModel,
      sonnetModel: claudeModel,
      opusModel: claudeModel,
      notes: contextWindow
        ? `Imported from Codex Gateway Hub · context_window=${contextWindow} · max_output=${claudeMaxOutputTokens}`
        : "Imported from Codex Gateway Hub",
      configFormat: "json",
      config: toBase64Utf8(JSON.stringify(inlineConfig)),
      enabled: "true"
    });

    return `ccswitch://v1/import?${params.toString()}`;
  }

  function buildCcSwitchClaudeThinkingPatch() {
    const {
      claudeModel,
      contextWindow,
      maxThinkingTokens,
      claudeMaxOutputTokens
    } = resolveCcSwitchProviderContext();
    return JSON.stringify(
      {
        env: {
          ANTHROPIC_MODEL: claudeModel,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: claudeModel,
          ANTHROPIC_DEFAULT_SONNET_MODEL: claudeModel,
          ANTHROPIC_DEFAULT_OPUS_MODEL: claudeModel,
          ANTHROPIC_REASONING_MODEL: claudeModel,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(claudeMaxOutputTokens),
          CLAUDE_CODE_EFFORT_LEVEL: "high",
          MAX_THINKING_TOKENS: String(maxThinkingTokens),
          GATEWAY_MODEL_CONTEXT_WINDOW: contextWindow ? String(contextWindow) : ""
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

  async function copyCcSwitchCodexAuthJson() {
    try {
      const authJson = JSON.stringify(buildCcSwitchCodexAuthJson(), null, 2);
      await copyTextToClipboard(
        authJson,
        t("Codex auth.json（含密钥）已复制。", "Codex auth.json (with key) copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Codex auth.json 失败", "Failed to copy Codex auth.json")
      );
    }
  }

  async function copyCcSwitchCodexConfigToml() {
    try {
      const toml = buildCcSwitchCodexConfigToml();
      await copyTextToClipboard(
        toml,
        t("Codex config.toml 已复制。", "Codex config.toml copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Codex config.toml 失败", "Failed to copy Codex config.toml")
      );
    }
  }

  async function copyCcSwitchCodexContextPatch() {
    try {
      const patch = buildCcSwitchCodexContextPatch();
      await copyTextToClipboard(
        patch,
        t("Codex 上下文补丁已复制。", "Codex context patch copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Codex 上下文补丁失败", "Failed to copy Codex context patch")
      );
    }
  }

  async function openCcSwitchCodexImport() {
    try {
      const link = buildCcSwitchCodexDeepLink();
      try {
        const patch = buildCcSwitchCodexContextPatch();
        await navigator.clipboard.writeText(patch);
        notifyInfo(
          t(
            "已同步复制 Codex 上下文补丁。导入后可直接粘贴到 CC Switch 的 Codex 配置。",
            "Codex context patch copied. Paste it into CC Switch Codex config after import."
          )
        );
      } catch {
        notifyInfo(
          t(
            "无法自动复制 Codex 上下文补丁，请手动点击“复制 Codex 上下文补丁”。",
            "Could not auto-copy Codex context patch. Click 'Copy Codex Context Patch' manually."
          )
        );
      }
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

  async function copyCcSwitchClaudeConfigJson() {
    try {
      const configJson = JSON.stringify(buildCcSwitchClaudeInlineConfig(), null, 2);
      await copyTextToClipboard(
        configJson,
        t("Claude Code 配置（含密钥）已复制。", "Claude Code config (with key) copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Claude Code 配置失败", "Failed to copy Claude Code config")
      );
    }
  }

  async function copyCcSwitchClaudeThinkingPatch() {
    try {
      const patch = buildCcSwitchClaudeThinkingPatch();
      await copyTextToClipboard(
        patch,
        t("Claude 上下文/Thinking 补丁已复制。", "Claude context/thinking patch copied.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("复制 Claude 上下文/Thinking 补丁失败", "Failed to copy Claude context/thinking patch")
      );
    }
  }

  async function openCcSwitchClaudeImport() {
    try {
      const link = buildCcSwitchClaudeDeepLink();
      try {
        const patch = buildCcSwitchClaudeThinkingPatch();
        await navigator.clipboard.writeText(patch);
        notifyInfo(
          t(
            "已同步复制 Claude 上下文/Thinking 补丁。导入后可直接粘贴到 CC Switch 的 Claude 配置。",
            "Claude context/thinking patch copied. Paste it into CC Switch Claude config after import."
          )
        );
      } catch {
        notifyInfo(
          t(
            "无法自动复制 Claude 补丁，请手动点击“复制 Claude 上下文/Thinking 补丁”。",
            "Could not auto-copy Claude patch. Click 'Copy Claude Context/Thinking Patch' manually."
          )
        );
      }
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
  const codexAuthJsonPreview = (() => {
    try {
      const authJson = buildCcSwitchCodexAuthJson();
      return JSON.stringify(
        {
          OPENAI_API_KEY: authJson.OPENAI_API_KEY
        },
        null,
        2
      );
    } catch {
      return "";
    }
  })();
  const codexConfigTomlPreview = (() => {
    try {
      return buildCcSwitchCodexConfigToml();
    } catch {
      return "";
    }
  })();
  const claudeConfigPreview = (() => {
    try {
      return JSON.stringify(buildCcSwitchClaudeInlineConfig(), null, 2);
    } catch {
      return "";
    }
  })();
  const nativeCodexEmptyState = t(
    "请先填写本地 Key 后查看原生 Codex 配置预览。",
    "Fill local key to preview native Codex config."
  );
  const compatPromptKeywordCount = parseCompatPromptKeywordsInput(compatPromptKeywordsInput).length;
  const compatPromptHintLength = compatPromptHintInput.trim().length;
  const compatPromptRuleCount = compatPromptRulesDraft.length;
  const compatPromptRuleEnabledCount = compatPromptRulesDraft.filter((item) => item.enabled).length;
  const compatPromptRuleSearchKeyword = compatPromptRuleSearch.trim().toLowerCase();
  const compatPromptRuleVisibleItems = compatPromptRulesDraft
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      compatPromptRuleSearchKeyword
        ? stringifyCompatPromptRuleForSearch(rule).includes(compatPromptRuleSearchKeyword)
        : true
    );
  const compatPromptUpstreamModelSuggestions = Array.from(
    new Set(
      channels
        .flatMap((channel) => channel.upstreamModels)
        .map((model) => model.model.trim())
        .filter(Boolean)
    )
  )
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 16);
  const routeModuleTitle = t(MODULE_LABEL[routeModule].zh, MODULE_LABEL[routeModule].en);
  const routeModuleSummary = t(MODULE_SUMMARY[routeModule].zh, MODULE_SUMMARY[routeModule].en);

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
            <Menu.MenuItem value="dashboard" icon={<LayoutDashboard size={18} />}>
              {t("工作台", "Dashboard")}
            </Menu.MenuItem>
            <Menu.SubMenu value="key-mgmt" title={t("Key 管理", "Key Management")} icon={<Settings size={18} />}>
              <Menu.MenuItem value="access" icon={<User size={18} />}>
                {t("基础接入", "Access")}
              </Menu.MenuItem>
              <Menu.MenuItem value="prompt" icon={<Code2 size={18} />}>
                {t("提示词配置", "Prompt Config")}
              </Menu.MenuItem>
              <Menu.MenuItem value="export" icon={<FileOutput size={18} />}>
                {t("配置导出", "Export")}
              </Menu.MenuItem>
              <Menu.MenuItem value="upstream" icon={<Globe size={18} />}>
                {t("上游渠道", "Upstreams")}
              </Menu.MenuItem>
              <Menu.MenuItem value="runtime" icon={<ArrowUpDown size={18} />} disabled={keys.length === 0}>
                {t("运行时调度", "Runtime")}
              </Menu.MenuItem>
              <Menu.MenuItem value="logs" icon={<FileText size={18} />}>
                {t("请求日志", "Request Logs")}
              </Menu.MenuItem>
              <Menu.MenuItem value="calls" icon={<Activity size={18} />}>
                {t("AI 调用日志", "AI Call Logs")}
              </Menu.MenuItem>
              <Menu.MenuItem value="usage" icon={<Database size={18} />}>
                {t("用量报表", "Usage Report")}
              </Menu.MenuItem>
              <Menu.MenuItem value="docs" icon={<BookOpen size={18} />}>
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
              <Button variant="text" shape="circle" icon={<UserCircle size={18} />} />
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
              <Tabs.TabPanel value="prompt" label={t("提示词配置", "Prompt Config")} />
              <Tabs.TabPanel value="export" label={t("配置导出", "Export")} />
              <Tabs.TabPanel value="upstream" label={t("上游渠道", "Upstreams")} />
              <Tabs.TabPanel value="runtime" label={t("运行时调度", "Runtime")} disabled={keys.length === 0} />
              <Tabs.TabPanel value="logs" label={t("请求日志", "Request Logs")} />
              <Tabs.TabPanel value="calls" label={t("AI 调用日志", "AI Call Logs")} />
              <Tabs.TabPanel value="usage" label={t("用量报表", "Usage Report")} />
              <Tabs.TabPanel value="docs" label={t("接口文档", "API Docs")} />
              <Tabs.TabPanel value="dashboard" label={t("工作台", "Dashboard")} />
            </Tabs>
          </div>

          <Layout.Content className="tc-content">
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
                ) : routeModule === "prompt" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("提示词配置", "Prompt Config")}</span>
                    <Tag variant="light-outline">keywords={compatPromptKeywordCount}</Tag>
                    <Tag variant="light-outline">hint_chars={compatPromptHintLength}</Tag>
                    <Tag variant="light-outline">rules={compatPromptRuleCount}</Tag>
                    <Tag variant="light-outline">enabled={compatPromptRuleEnabledCount}</Tag>
                    {savingCompatPromptConfig ? (
                      <Tag theme="warning" variant="light-outline">{t("保存中", "Saving")}</Tag>
                    ) : null}
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
                  ) : routeModule === "prompt" ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void loadGatewayConfig()}
                      disabled={loading || savingCompatPromptConfig}
                    >
                      {t("刷新配置", "Refresh Config")}
                    </Button>
                  ) : routeModule === "access" || routeModule === "export" || routeModule === "runtime" ? (
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
                ) : routeModule === "prompt" ? (
                  <>
                    <Tag variant="light-outline">keywords={compatPromptKeywordCount}</Tag>
                    <Tag variant="light-outline">hint_chars={compatPromptHintLength}</Tag>
                    <Tag variant="light-outline">rules={compatPromptRuleCount}</Tag>
                    <Tag variant="light-outline">enabled={compatPromptRuleEnabledCount}</Tag>
                    <Tag variant="light-outline">defaults={compatPromptDefaults ? "loaded" : "pending"}</Tag>
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

              {routeModule === "dashboard" ? (
                <WorkspaceDashboard
                  keys={keys}
                  channels={channels}
                  usageReport={usageReport}
                  loadingUsage={loadingUsage}
                  onNavigate={handleMenuRoute}
                  onRefreshUsage={() => void loadUsageReport()}
                  t={t}
                  enabledKeyCount={enabledKeyCount}
                  enabledChannelCount={enabledChannelCount}
                  gatewayV1Endpoint={gatewayV1Endpoint}
                />
              ) : routeModule === "access" ? (
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
                            placeholder={t("可跨上游选择任意已启用模型", "Select any enabled model across upstreams")}
                            onChange={(value) =>
                              setKeyForm((prev) => ({
                                ...prev,
                                contextOverflowModel: normalizeSelectValue(value)
                              }))
                            }
                          />
                        </label>
                        <p className="tc-upstream-advice tc-field-wide">
                          {t(
                            "溢出模型支持跨上游选择。超阈值后会直接切到你选定的渠道与模型，而不再限制为当前绑定渠道。",
                            "Overflow model supports cross-upstream selection. Once the threshold is exceeded, requests switch directly to the selected channel and model instead of being limited to the currently bound upstream."
                          )}
                        </p>
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
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickExportKeyMappings}
                      disabled={!keyForm.modelMappings.length}
                    >
                      {t("导出映射", "Export Mappings")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void handleQuickCopyKeyMappings()}
                      disabled={!keyForm.modelMappings.length}
                    >
                      {t("复制映射", "Copy Mappings")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleOpenQuickImportKeyMappingDialog}
                    >
                      {t("导入映射", "Import Mappings")}
                    </Button>
                  </div>

                  {keyForm.modelMappings.length > 0 ? (
                    <div className="tc-model-list">
                      {keyForm.modelMappings.map((item, index) => {
                        const mappingChannel = resolveMappingChannel(item);
                        const targetProfile = findChannelModelProfile(mappingChannel, item.targetModel);
                        const showDoubaoThinkingControl = shouldShowDoubaoThinkingType(
                          mappingChannel?.provider ?? "openai",
                          targetProfile?.model ?? item.targetModel
                        );
                        const showGlmThinkingControl = shouldShowGlmThinkingThreshold(
                          mappingChannel?.provider ?? "openai",
                          targetProfile?.model ?? item.targetModel
                        );

                        return (
                          <div key={item.id} className="tc-model-item">
                            <div className="tc-model-head">
                              <strong>映射 #{index + 1}</strong>
                              <div className="tc-model-actions">
                                <span>{t("切模", "Overflow")}</span>
                                <Switch
                                  value={item.dynamicModelSwitch}
                                  onChange={(value) =>
                                    updateKeyModelMapping(item.id, (prev) => ({
                                      ...prev,
                                      dynamicModelSwitch: Boolean(value)
                                    }))
                                  }
                                />
                                <span className="tc-sep">|</span>
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

                              <label className="tc-field">
                                <span>
                                  {t("绑定上游渠道（映射级）", "Bind Upstream (Mapping-level)")}
                                </span>
                                <Select
                                  value={
                                    typeof item.upstreamChannelId === "number"
                                      ? String(item.upstreamChannelId)
                                      : "__inherit__"
                                  }
                                  options={mappingBindChannelOptions}
                                  onChange={(value) => {
                                    const normalized = normalizeSelectValue(value);
                                    const parsed = Number(normalized);
                                    updateKeyModelMapping(item.id, (prev) => ({
                                      ...prev,
                                      upstreamChannelId:
                                        normalized === "__inherit__" ||
                                        !Number.isInteger(parsed) ||
                                        parsed <= 0
                                          ? null
                                          : parsed
                                    }));
                                  }}
                                />
                              </label>

                              {showDoubaoThinkingControl ? (
                                <label className="tc-field">
                                  <span>{t("豆包深度思考", "Doubao Thinking")}</span>
                                  <Select
                                    value={item.thinkingType ?? "__inherit__"}
                                    options={[
                                      {
                                        value: "__inherit__",
                                        label: t("继承请求参数", "Inherit request")
                                      },
                                      ...DOUBAO_THINKING_TYPES.map((thinkingType) => ({
                                        value: thinkingType,
                                        label: formatDoubaoThinkingTypeLabel(thinkingType)
                                      }))
                                    ]}
                                    onChange={(value) => {
                                      const normalized = normalizeSelectValue(value);
                                      updateKeyModelMapping(item.id, (prev) => ({
                                        ...prev,
                                        thinkingType:
                                          normalized === "enabled" ||
                                          normalized === "disabled" ||
                                          normalized === "auto"
                                            ? normalized
                                            : null
                                      }));
                                    }}
                                  />
                                </label>
                              ) : null}

                              {showDoubaoThinkingControl ? (
                                <p className="tc-upstream-advice tc-field-wide">
                                  {t(
                                    "映射级可固定豆包 thinking.type（enabled/disabled/auto）。选择“继承请求参数”时，客户端传什么就透传什么；未传时按网关自动策略处理。",
                                    "Mapping-level setting can pin Doubao thinking.type (enabled/disabled/auto). With 'Inherit request', client input is forwarded as-is; if absent, gateway auto strategy is used."
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl ? (
                                <label className="tc-field">
                                  <span>
                                    {t(
                                      "GLM 深度思考触发阈值",
                                      "GLM Deep Thinking Threshold"
                                    )}
                                  </span>
                                  <Select
                                    value={targetProfile?.glmCodexThinkingThreshold ?? "low"}
                                    options={GLM_CODEX_THINKING_THRESHOLDS.map((threshold) => ({
                                      value: threshold,
                                      label: formatGlmThinkingThresholdLabel(threshold)
                                    }))}
                                    onChange={(value) =>
                                      void updateBoundChannelGlmThinkingThreshold(
                                        item,
                                        normalizeGlmCodexThinkingThreshold(
                                          normalizeSelectValue(value)
                                        )
                                      )
                                    }
                                    disabled={
                                      loading ||
                                      savingKey ||
                                      savingChannel ||
                                      !mappingChannel ||
                                      !targetProfile
                                    }
                                  />
                                </label>
                              ) : null}

                              {showGlmThinkingControl && mappingChannel && targetProfile ? (
                                <p className="tc-upstream-advice tc-field-wide">
                                  {t(
                                    `当前映射会继承渠道「${mappingChannel.name}」中内部模型 ${targetProfile.model} 的思考阈值设置。达到该力度时，Codex 的 reasoning_effort 才会自动映射为 GLM thinking.enabled。`,
                                    `This mapping inherits the thinking threshold from internal model ${targetProfile.model} in channel ${mappingChannel.name}. Codex reasoning_effort only auto-maps to GLM thinking.enabled once the threshold is reached.`
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl && !mappingChannel ? (
                                <p className="tc-tip err tc-field-wide">
                                  {t(
                                    "请先为该映射选择上游渠道，或让它继承 Key 绑定渠道。",
                                    "Select an upstream channel for this mapping, or make it inherit the key-level channel first."
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl && mappingChannel && !targetProfile ? (
                                <p className="tc-tip err tc-field-wide">
                                  {t(
                                    "这是一个 GLM 目标模型，但当前映射渠道的模型池里还没有找到同名内部模型，所以暂时无法设置思考阈值。请先在对应上游渠道模型池中添加或修正该模型。",
                                    "This is a GLM target model, but no matching internal model was found in the selected channel model pool yet, so the thinking threshold cannot be configured here. Add or fix the model in that upstream channel pool first."
                                  )}
                                </p>
                              ) : null}
                            </div>
                            {item.dynamicModelSwitch ? (
                              <div className="tc-mapping-overflow">
                                <span className="tc-sub-label">{t("上下文溢出切模", "Context Overflow Switch")}</span>
                                <div className="tc-form-grid">
                                  <label className="tc-field">
                                    <span>{t("切换阈值（输入 Token）", "Switch Threshold (prompt tokens)")}</span>
                                    <Input
                                      type="number"
                                      value={String(item.contextSwitchThreshold)}
                                      onChange={(value) => {
                                        const n = Number(value);
                                        if (!Number.isNaN(n)) {
                                          updateKeyModelMapping(item.id, (prev) => ({
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
                                      value={item.contextOverflowModel || undefined}
                                      options={mappingOverflowModelOptions}
                                      placeholder={t("可跨上游选择任意已启用模型", "Select any enabled model across upstreams")}
                                      onChange={(value) =>
                                        updateKeyModelMapping(item.id, (prev) => ({
                                          ...prev,
                                          contextOverflowModel: normalizeSelectValue(value)
                                        }))
                                      }
                                    />
                                  </label>
                                  <p className="tc-upstream-advice tc-field-wide">
                                    {t(
                                      "映射级溢出模型优先于 Key 级设置。超阈值后会直接切到你选定的渠道与模型。",
                                      "Mapping-level overflow model takes priority over key-level settings. Once the threshold is exceeded, requests switch directly to the selected channel and model."
                                    )}
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
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
                    <div className="tc-channel-summary">
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
                      </div>
                      <div className="tc-channel-endpoint">
                        <span className="tc-channel-endpoint-label">
                          {t("上游地址", "Upstream URL")}
                        </span>
                        <code>{selectedChannelForKey.upstreamBaseUrl}</code>
                      </div>
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
                      "导入预览与原生 Codex 导出已单独放到「配置导出」页面，便于专门查看和复制。",
                      "Import previews and native Codex export have moved to the dedicated Export page for cleaner access."
                    )}
                  </p>
                </section>
              ) : null}

              {routeModule === "access" ? (
                <section className="tc-section">
                  <h3>{t("提示词配置已迁移", "Prompt Config Has Moved")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "检测 AGENTS.md 时自动注入的默认提示词与关键词规则，已经拆到独立的「提示词配置」页面，便于单独维护。",
                      "The default injected prompt and AGENTS keyword rules used for AGENTS.md detection have moved to the dedicated Prompt Config page."
                    )}
                  </p>
                  <div className="tc-actions-row">
                    <Button theme="primary" onClick={() => handleMenuRoute("prompt")}>
                      {t("前往提示词配置", "Open Prompt Config")}
                    </Button>
                  </div>
                </section>
              ) : null}

              {routeModule === "prompt" ? (
                <section className="tc-section">
                  <h3>{t("网关注入提示词配置", "Gateway Injected Prompt Config")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "这里控制 AGENTS.md 检测场景下注入策略：未命中规则时使用默认提示词；命中上游真实模型规则时，用该模型专属提示词替换默认提示词。保存后会影响后续请求。",
                      "This controls AGENTS.md injection behavior: use the default hint when no rule matches; when a real-upstream-model rule matches, its model-specific hint replaces the default hint."
                    )}
                  </p>

                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("AGENTS 关键词（每行一个）", "AGENTS Keywords (one per line)")}</span>
                      <Textarea
                        value={compatPromptKeywordsInput}
                        onChange={(value) => setCompatPromptKeywordsInput(value)}
                        autosize={{ minRows: 4, maxRows: 8 }}
                        placeholder={"AGENTS.md\nAGENTS.MD\nagents.md"}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("默认提示词正文", "Default Prompt Body")}</span>
                      <Textarea
                        value={compatPromptHintInput}
                        onChange={(value) => setCompatPromptHintInput(value)}
                        autosize={{ minRows: 10, maxRows: 18 }}
                        placeholder={t("请输入自动注入的默认提示词", "Enter the default injected prompt")}
                      />
                    </label>
                  </div>

                  <div className="tc-model-list-toolbar">
                    <div className="tc-model-list-toolbar-left">
                      <div className="tc-model-list-title">{t("模型定制规则", "Model-Specific Rules")}</div>
                      <Tag variant="light-outline">
                        {t("当前", "Current")} {compatPromptRuleCount} {t("条", "items")}
                      </Tag>
                      <Tag variant="light-outline">
                        {t("启用", "Enabled")} {compatPromptRuleEnabledCount}
                      </Tag>
                    </div>
                    <div className="tc-model-list-toolbar-left">
                      <Input
                        value={compatPromptRuleSearch}
                        onChange={(value) => setCompatPromptRuleSearch(value)}
                        clearable
                        placeholder={t("搜索规则 ID / 模型 / 提示词", "Search rule ID / model / hint")}
                        style={{ width: 280 }}
                      />
                      <Button
                        theme="primary"
                        variant="outline"
                        onClick={() => addCompatPromptRule()}
                        disabled={compatPromptRuleCount >= 128}
                      >
                        {t("新增规则", "Add Rule")}
                      </Button>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => openCompatPromptRulesFileImporter("append")}
                        disabled={compatPromptRuleCount >= 128}
                      >
                        {t("批量导入并追加", "Batch Import (Append)")}
                      </Button>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => openCompatPromptRulesFileImporter("replace")}
                      >
                        {t("批量导入并覆盖", "Batch Import (Replace)")}
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={compatPromptRulesFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: "none" }}
                    onChange={(event) => void handleCompatPromptRulesFileChange(event)}
                  />

                  {compatPromptUpstreamModelSuggestions.length > 0 ? (
                    <>
                      <p className="tc-upstream-advice">
                        {t(
                          "已发现上游真实模型。可一键创建规则，也可以手填任意上游真实模型名称。",
                          "Detected real upstream models. You can add rules with one click, or type any upstream model manually."
                        )}
                      </p>
                      <div className="tc-actions-row">
                        {compatPromptUpstreamModelSuggestions.map((model) => (
                          <Button
                            key={model}
                            variant="outline"
                            size="small"
                            onClick={() =>
                              addCompatPromptRule({
                                upstreamModelPattern: model
                              })
                            }
                            disabled={compatPromptRuleCount >= 128}
                          >
                            {model}
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {compatPromptRuleCount === 0 ? (
                    <p className="tc-upstream-advice">
                      {t(
                        "当前没有模型规则。你可以点击“新增规则”开始按上游真实模型定制提示词。",
                        "No model rules yet. Click 'Add Rule' to start customizing hints by real upstream model."
                      )}
                    </p>
                  ) : compatPromptRuleVisibleItems.length === 0 ? (
                    <p className="tc-upstream-advice">
                      {t(
                        "没有匹配搜索条件的规则。",
                        "No rules matched the search filter."
                      )}
                    </p>
                  ) : (
                    <div className="tc-model-list">
                      {compatPromptRuleVisibleItems.map(({ rule, index }) => (
                        <div className="tc-model-item" key={`${rule.id}-${index}`}>
                          <div className="tc-model-head">
                            <strong>{t("规则", "Rule")} #{index + 1}</strong>
                            <div className="tc-model-actions">
                              <Tag
                                theme={rule.enabled ? "success" : "default"}
                                variant="light-outline"
                              >
                                {rule.enabled ? t("启用", "Enabled") : t("停用", "Disabled")}
                              </Tag>
                              <Button
                                variant="outline"
                                size="small"
                                onClick={() => duplicateCompatPromptRule(index)}
                                disabled={compatPromptRuleCount >= 128}
                              >
                                {t("复制", "Duplicate")}
                              </Button>
                              <Button
                                theme="danger"
                                variant="text"
                                size="small"
                                onClick={() => removeCompatPromptRule(index)}
                              >
                                {t("删除", "Delete")}
                              </Button>
                            </div>
                          </div>

                          <div className="tc-form-grid">
                            <label className="tc-field">
                              <span>{t("规则 ID", "Rule ID")}</span>
                              <Input
                                value={rule.id}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev) => ({
                                    ...prev,
                                    id: value
                                  }))
                                }
                                clearable
                              />
                            </label>

                            <label className="tc-switchline">
                              <span>{t("启用规则", "Rule Enabled")}</span>
                              <Switch
                                value={rule.enabled}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev) => ({
                                    ...prev,
                                    enabled: Boolean(value)
                                  }))
                                }
                              />
                            </label>

                            <label className="tc-field">
                              <span>{t("供应商匹配（可选）", "Provider Pattern (optional)")}</span>
                              <Input
                                value={rule.provider}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev) => ({
                                    ...prev,
                                    provider: value
                                  }))
                                }
                                placeholder={t("例如：doubao / glm / *", "e.g. doubao / glm / *")}
                                clearable
                              />
                            </label>

                            <label className="tc-field">
                              <span>{t("上游真实模型匹配", "Upstream Real Model Pattern")}</span>
                              <Input
                                value={rule.upstreamModelPattern}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev) => ({
                                    ...prev,
                                    upstreamModelPattern: value
                                  }))
                                }
                                placeholder={t(
                                  "例如：doubao-seed-2.0-pro / glm-5 / *",
                                  "e.g. doubao-seed-2.0-pro / glm-5 / *"
                                )}
                                clearable
                              />
                            </label>

                            <label className="tc-field tc-field-wide">
                              <span>{t("规则追加提示词", "Rule Extra Hint")}</span>
                              <Textarea
                                value={rule.hint}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev) => ({
                                    ...prev,
                                    hint: value
                                  }))
                                }
                                autosize={{ minRows: 6, maxRows: 14 }}
                                placeholder={t(
                                  "请输入该模型命中时需要追加的提示词",
                                  "Enter extra hint to append when this rule matches"
                                )}
                              />
                            </label>

                            <p className="tc-upstream-advice tc-field-wide">
                              {t(
                                "匹配建议：优先填写“上游真实模型匹配”，可搭配 provider 收敛范围。支持 `*`、`?` 通配。",
                                "Matching tip: prioritize upstream real model pattern, then narrow with provider if needed. `*` and `?` wildcards are supported."
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="tc-actions-row">
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => setShowCompatPromptRulesJsonEditor((prev) => !prev)}
                    >
                      {showCompatPromptRulesJsonEditor
                        ? t("收起 JSON 批量编辑", "Hide JSON Bulk Editor")
                        : t("展开 JSON 批量编辑", "Show JSON Bulk Editor")}
                    </Button>
                  </div>

                  {showCompatPromptRulesJsonEditor ? (
                    <>
                      <div className="tc-form-grid">
                        <label className="tc-field tc-field-wide">
                          <span>{t("高级：模型规则 JSON", "Advanced: Model Rules JSON")}</span>
                          <Textarea
                            value={compatPromptRulesJsonInput}
                            onChange={(value) => setCompatPromptRulesJsonInput(value)}
                            autosize={{ minRows: 10, maxRows: 22 }}
                            placeholder={t("可用于批量导入导出规则", "Use for bulk import/export of rules")}
                          />
                        </label>
                      </div>
                      <div className="tc-actions-row">
                        <Button variant="outline" theme="default" onClick={exportCompatPromptRulesToJsonDraft}>
                          {t("从当前规则生成 JSON", "Generate JSON from Rules")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => importCompatPromptRulesFromJsonDraft("append")}
                          disabled={compatPromptRuleCount >= 128}
                        >
                          {t("从 JSON 追加规则", "Append Rules from JSON")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => importCompatPromptRulesFromJsonDraft("replace")}
                        >
                          {t("从 JSON 覆盖规则", "Replace Rules from JSON")}
                        </Button>
                      </div>
                    </>
                  ) : null}

                  <div className="tc-actions-row">
                    <Button
                      theme="primary"
                      loading={savingCompatPromptConfig}
                      onClick={() => void saveGatewayCompatPromptConfig()}
                      disabled={loading}
                    >
                      {t("保存提示词配置", "Save Prompt Config")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => {
                        if (!compatPromptDefaults) {
                          return;
                        }
                        applyCompatPromptConfig(compatPromptDefaults);
                      }}
                      disabled={!compatPromptDefaults || savingCompatPromptConfig}
                    >
                      {t("恢复默认草稿", "Reset to Defaults")}
                    </Button>
                  </div>

                  <p className="tc-tip">
                    {t(
                      "规则字段：provider / upstreamModelPattern 支持 `*`、`?` 通配；优先按上游真实模型命中。命中规则后将替换默认提示词。支持批量导入 `.json`（数组，或含 modelPromptRules/compatPromptConfig.modelPromptRules）。关键词用于定位 AGENTS.md 段落前的插入位置。",
                      "Rule fields provider / upstreamModelPattern support `*` and `?` wildcards; matching prioritizes real upstream model. A matched rule replaces the default hint. Batch `.json` import is supported (array, or modelPromptRules/compatPromptConfig.modelPromptRules). Keywords still control where hints are injected before AGENTS.md sections."
                    )}
                  </p>
                </section>
              ) : null}

              {routeModule === "export" ? (
                <section className="tc-section">
                  <h3>{t("配置导出与导入", "Export and Import")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "这里集中展示 CC Switch 导入配置、原生 Codex 导出片段和 Claude Code 预览，不再和 Key 编辑表单混在一起。",
                      "This page centralizes CC Switch import configs, native Codex export snippets, and Claude Code previews instead of mixing them into the key editor."
                    )}
                  </p>
                  <p className="tc-tip">
                    {t(
                      "提示：CC Switch 当前 deep link 在 Codex/Claude 场景都可能丢失部分高级变量（例如 Codex 上下文窗口、Claude 上下文窗口/Thinking 变量）。导入后可点对应“补丁复制”按钮粘贴到 CC Switch 配置中。",
                      "Tip: CC Switch deep link may drop advanced variables for Codex/Claude (for example Codex context window and Claude context-window/thinking variables). After import, use the patch-copy buttons and paste into CC Switch config."
                    )}
                  </p>

                  <div className="tc-runtime-doc">
                    <div className="tc-runtime-doc-head">
                      <h4>{t("Codex auth.json 预览", "Codex auth.json Preview")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void copyCcSwitchCodexAuthJson()}
                        disabled={loading || !keyForm.localKey.trim()}
                      >
                        {t("一键复制 auth.json（含密钥）", "Copy auth.json (with key)")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        codexAuthJsonPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="json"
                    />
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：这里对应 CC Switch 的 auth.json；预览与复制都会显示完整真实密钥。",
                        "Note: This maps to CC Switch auth.json. Both preview and copy include the full real key."
                      )}
                    </p>
                    <div className="tc-runtime-doc-head">
                      <h4>{t("Codex config.toml 预览", "Codex config.toml Preview")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void copyCcSwitchCodexConfigToml()}
                        disabled={loading || !keyForm.localKey.trim()}
                      >
                        {t("一键复制 config.toml", "Copy config.toml")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        codexConfigTomlPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="toml"
                    />

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex CLI 导出", "Native Codex CLI Export")}</h4>
                      <Tag theme="primary" variant="light-outline">
                        {t("推荐", "Recommended")}
                      </Tag>
                    </div>
                    <Tabs
                      value={nativeCodexApplyPatchToolType}
                      size="medium"
                      theme="card"
                      onChange={(value) =>
                        setNativeCodexApplyPatchToolType(
                          normalizeSelectValue(value) as CodexApplyPatchToolType
                        )
                      }
                    >
                      <Tabs.TabPanel
                        value="function"
                        label={t("Function（推荐）", "Function (Recommended)")}
                      />
                      <Tabs.TabPanel value="freeform" label="Freeform" />
                    </Tabs>
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：CC Switch 导入仍是旧流程。原生 Codex 要让第三方模型稳定支持 apply_patch，还需要同时配置 `model_catalog_json` 与 `model_instructions_file`；`AGENTS.md` 为可选工作区补充。",
                        "Note: CC Switch import remains the legacy flow. Native Codex needs both `model_catalog_json` and `model_instructions_file` for stable third-party apply_patch support; `AGENTS.md` is an optional workspace supplement."
                      )}
                    </p>
                    {nativeCodexExportBundle ? (
                      <div className="tc-meta-row">
                        <Tag theme="primary" variant="light-outline">
                          {t("当前模型", "Selected Model")}: {nativeCodexExportBundle.selectedModel}
                        </Tag>
                        <Tag variant="light-outline">
                          {t("导出模型数", "Exported Models")}: {nativeCodexExportBundle.exportedModels.length}
                        </Tag>
                        <Tag variant="light-outline">
                          apply_patch: {nativeCodexExportBundle.applyPatchToolType}
                        </Tag>
                        {nativeCodexSelectedModelProfile &&
                        shouldShowGlmThinkingThreshold(
                          selectedKey?.provider ?? selectedChannelForKey?.provider ?? "openai",
                          nativeCodexSelectedModelProfile.model
                        ) ? (
                          <Tag variant="light-outline">
                            {t("GLM 深度思考", "GLM Deep Thinking")}:{" "}
                            {formatGlmThinkingThresholdLabel(
                              nativeCodexSelectedModelProfile.glmCodexThinkingThreshold
                            )}
                          </Tag>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedKeyId !== null ? (
                      <p className="tc-upstream-advice">
                        {t(
                          "已保存 Key 也可通过 `/api/keys/:id/codex-export` 获取相同导出结果。",
                          "Saved keys can also fetch the same bundle from `/api/keys/:id/codex-export`."
                        )}
                      </p>
                    ) : null}

                    <div className="tc-runtime-doc-head">
                      <h4>{t("~/.codex/.env 片段", "~/.codex/.env Snippet")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() =>
                          void copyNativeCodexBundleFile(
                            "envSnippet",
                            t("原生 Codex .env 片段已复制。", "Native Codex .env snippet copied."),
                            t("复制原生 Codex .env 片段失败", "Failed to copy native Codex .env snippet")
                          )
                        }
                        disabled={loading || !nativeCodexExportBundle}
                      >
                        {t("复制 .env 片段", "Copy .env Snippet")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={nativeCodexExportBundle?.files.envSnippet.content || nativeCodexEmptyState}
                      language="dotenv"
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.envSnippet.targetPath ?? "~/.codex/.env"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex config.toml 片段", "Native Codex config.toml Snippet")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() =>
                          void copyNativeCodexBundleFile(
                            "configTomlSnippet",
                            t("原生 Codex config.toml 片段已复制。", "Native Codex config.toml snippet copied."),
                            t(
                              "复制原生 Codex config.toml 片段失败",
                              "Failed to copy native Codex config.toml snippet"
                            )
                          )
                        }
                        disabled={loading || !nativeCodexExportBundle}
                      >
                        {t("复制原生 config.toml", "Copy Native config.toml")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.configTomlSnippet.content || nativeCodexEmptyState
                      }
                      language="toml"
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.configTomlSnippet.targetPath ?? "~/.codex/config.toml"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex model_catalog_json", "Native Codex model_catalog_json")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() =>
                          void copyNativeCodexBundleFile(
                            "modelCatalogJson",
                            t(
                              "原生 Codex model_catalog_json 已复制。",
                              "Native Codex model_catalog_json copied."
                            ),
                            t(
                              "复制原生 Codex model_catalog_json 失败",
                              "Failed to copy native Codex model_catalog_json"
                            )
                          )
                        }
                        disabled={loading || !nativeCodexExportBundle}
                      >
                        {t("复制 model_catalog_json", "Copy model_catalog_json")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.modelCatalogJson.content || nativeCodexEmptyState
                      }
                      language="json"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.modelCatalogJson.targetPath ??
                        "~/.codex/codex-gateway-hub/export.catalog.json"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex instructions", "Native Codex instructions")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() =>
                          void copyNativeCodexBundleFile(
                            "modelInstructionsMd",
                            t("原生 Codex instructions 已复制。", "Native Codex instructions copied."),
                            t(
                              "复制原生 Codex instructions 失败",
                              "Failed to copy native Codex instructions"
                            )
                          )
                        }
                        disabled={loading || !nativeCodexExportBundle}
                      >
                        {t("复制 instructions", "Copy instructions")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.modelInstructionsMd.content || nativeCodexEmptyState
                      }
                      language="markdown"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.modelInstructionsMd.targetPath ??
                        "~/.codex/codex-gateway-hub/export.instructions.md"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("可选 AGENTS.md", "Optional AGENTS.md")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() =>
                          void copyNativeCodexBundleFile(
                            "agentsMd",
                            t("原生 Codex AGENTS.md 已复制。", "Native Codex AGENTS.md copied."),
                            t("复制原生 Codex AGENTS.md 失败", "Failed to copy native Codex AGENTS.md")
                          )
                        }
                        disabled={loading || !nativeCodexExportBundle}
                      >
                        {t("复制 AGENTS.md", "Copy AGENTS.md")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={nativeCodexExportBundle?.files.agentsMd.content || nativeCodexEmptyState}
                      language="markdown"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.agentsMd.targetPath ?? "./AGENTS.md"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("Claude Code 配置预览（JSON）", "Claude Code Config Preview (JSON)")}</h4>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => void copyCcSwitchClaudeConfigJson()}
                        disabled={loading || !keyForm.localKey.trim()}
                      >
                        {t("一键复制 Claude 配置（含密钥）", "Copy Claude Config (with key)")}
                      </Button>
                    </div>
                    <CodeBlock
                      value={
                        claudeConfigPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="json"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：这里对应 CC Switch 的 Claude env 配置；预览与复制都会显示完整真实密钥。",
                        "Note: This maps to CC Switch Claude env config. Both preview and copy include the full real key."
                      )}
                    </p>
                  </div>

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
                      onClick={() => void copyCcSwitchCodexContextPatch()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Codex 上下文补丁", "Copy Codex Context Patch")}
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
                      {t("复制 Claude 上下文/Thinking 补丁", "Copy Claude Context/Thinking Patch")}
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
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickExportModels}
                      disabled={!channelForm.upstreamModels.length}
                    >
                      {t("导出模型池", "Export Model Pool")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickCopyModels}
                      disabled={!channelForm.upstreamModels.length}
                    >
                      {t("复制模型池", "Copy Model Pool")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleOpenQuickImportDialog}
                    >
                      {t("导入模型池", "Import Model Pool")}
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

                  <div className="tc-model-list-toolbar">
                    <div className="tc-model-list-toolbar-left">
                      <div className="tc-model-list-title">{t("模型池", "Model Pool")}</div>
                      <Tag variant="light-outline">
                        {t("当前", "Current")} {channelForm.upstreamModels.length} {t("个", "items")}
                      </Tag>
                    </div>
                    <Button theme="primary" variant="outline" onClick={addUpstreamModel}>
                      {t("继续添加模型", "Add Another Model")}
                    </Button>
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
                            <span>{t("上下文长度（Token）", "Context Window (tokens)")}</span>
                            <Input
                              type="number"
                              value={item.contextWindow ? String(item.contextWindow) : ""}
                              onChange={(value) => {
                                const normalized = value.trim();
                                updateUpstreamModel(item.id, (prev) => {
                                  if (!normalized) {
                                    return {
                                      ...prev,
                                      contextWindow: null
                                    };
                                  }
                                  const next = Number(normalized);
                                  if (!Number.isFinite(next)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    contextWindow: Math.floor(next)
                                  };
                                });
                              }}
                              placeholder={t("如：128000（可选）", "e.g. 128000 (optional)")}
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

                          {shouldShowGlmThinkingThreshold(
                            channelForm.provider,
                            item.model
                          ) ? (
                            <label className="tc-field">
                              <span>
                                {t(
                                  "GLM 深度思考触发阈值",
                                  "GLM Deep Thinking Threshold"
                                )}
                              </span>
                              <Select
                                value={item.glmCodexThinkingThreshold}
                                options={GLM_CODEX_THINKING_THRESHOLDS.map((threshold) => ({
                                  value: threshold,
                                  label: formatGlmThinkingThresholdLabel(threshold)
                                }))}
                                onChange={(value) =>
                                  updateUpstreamModel(item.id, (prev) => ({
                                    ...prev,
                                    glmCodexThinkingThreshold: normalizeGlmCodexThinkingThreshold(
                                      normalizeSelectValue(value)
                                    )
                                  }))
                                }
                              />
                            </label>
                          ) : null}

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

                          {shouldShowGlmThinkingThreshold(
                            channelForm.provider,
                            item.model
                          ) ? (
                            <p className="tc-upstream-advice tc-field-wide">
                              {t(
                                "当 Codex 通过本模型请求 `reasoning_effort` 时，达到这里设置的力度才会自动映射为 GLM 的 `thinking.enabled`。`off` 表示永不自动开启；如果客户端显式发送 `thinking.type`，仍以客户端为准。",
                                "When Codex sends `reasoning_effort` through this model, GLM `thinking.enabled` will only be auto-enabled once the request reaches this threshold. `off` disables auto-enable; explicit client `thinking.type` still wins."
                              )}
                            </p>
                          ) : null}

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
                      "展示系统提示词、用户提问、模型回答，以及真实上游模型（实际调用模型）信息。支持 Key、时间范围、关键词、请求路由/协议、请求模型、客户端模型、真实模型、流式模式、调用类型等组合筛选，并可单独统计跨模型辅助视觉调用。",
                      "Shows system prompt, user question, assistant response, and the real upstream model. Supports combined filters by key, time range, keyword, route/APIs, requested/client/upstream model, stream mode, and call type, plus dedicated vision-fallback stats."
                    )}
                  </p>

                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group">
                      <label className="tc-switchline">
                        <span>{t("自动刷新（8秒）", "Auto Refresh (8s)")}</span>
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
                  </div>

                  <div className="tc-log-toolbar tc-log-toolbar-detail">
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("时间范围", "Time Range")}</span>
                        <DateRangePicker
                          enableTimePicker
                          clearable
                          valueType="YYYY-MM-DD HH:mm:ss"
                          format="YYYY-MM-DD HH:mm:ss"
                          value={aiCallDateRange}
                          placeholder={[t("开始时间", "Start time"), t("结束时间", "End time")]}
                          style={{ width: 340 }}
                          onChange={(value) => {
                            if (!Array.isArray(value)) {
                              setAiCallDateRange([]);
                              return;
                            }
                            const next = value.map((item) => String(item ?? "").trim());
                            if (next.length === 2 && next[0] && next[1]) {
                              setAiCallDateRange([next[0], next[1]]);
                              return;
                            }
                            setAiCallDateRange([]);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group tc-log-range-buttons">
                      {AI_CALL_RANGE_OPTIONS.map((item) => (
                        <Button
                          key={`call-range-${item.minutes}`}
                          size="small"
                          variant="outline"
                          onClick={() => applyAiCallQuickRange(item.minutes)}
                        >
                          {item.label}
                        </Button>
                      ))}
                      {hasCustomAiCallDateRange ? (
                        <Button size="small" variant="outline" onClick={() => setAiCallDateRange([])}>
                          {t("清除时间", "Clear Time")}
                        </Button>
                      ) : null}
                    </div>
                    <div className="tc-log-toolbar-group tc-log-field-wide">
                      <label className="tc-field">
                        <span>{t("关键词", "Keyword")}</span>
                        <Input
                          value={aiCallKeywordFilter}
                          onChange={(value) => setAiCallKeywordFilter(value)}
                          placeholder={t("搜索提示词、回答、模型、Key", "Search prompts, response, models, key")}
                          clearable
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("路由", "Route")}</span>
                        <Select
                          value={aiCallRouteFilter || "__all__"}
                          options={aiCallRouteOptions}
                          style={{ width: 180 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallRouteFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("请求协议", "Request API")}</span>
                        <Select
                          value={aiCallRequestWireFilter || "__all__"}
                          options={aiCallRequestWireOptions}
                          style={{ width: 190 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallRequestWireFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("上游协议", "Upstream API")}</span>
                        <Select
                          value={aiCallUpstreamWireFilter || "__all__"}
                          options={aiCallUpstreamWireOptions}
                          style={{ width: 190 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallUpstreamWireFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("请求模型", "Requested Model")}</span>
                        <Select
                          value={aiCallRequestedModelFilter || "__all__"}
                          options={aiCallRequestedModelOptions}
                          style={{ width: 220 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallRequestedModelFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("客户端模型", "Client Model")}</span>
                        <Select
                          value={aiCallClientModelFilter || "__all__"}
                          options={aiCallClientModelOptions}
                          style={{ width: 220 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            setAiCallClientModelFilter(next === "__all__" ? "" : next);
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("流式模式", "Stream Mode")}</span>
                        <Select
                          value={aiCallStreamFilter || "__all__"}
                          options={aiCallStreamOptions}
                          style={{ width: 170 }}
                          onChange={(value) => {
                            const next = normalizeSelectValue(value);
                            if (next === "__all__") {
                              setAiCallStreamFilter("");
                              return;
                            }
                            if (next === "stream" || next === "non_stream") {
                              setAiCallStreamFilter(next);
                            }
                          }}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group tc-log-toolbar-actions">
                      <Button
                        variant="outline"
                        onClick={expandVisibleAiCallLogs}
                        disabled={aiCallLogs.length === 0}
                      >
                        {t("展开全部", "Expand All")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={collapseVisibleAiCallLogs}
                        disabled={expandedAiCallLogIds.length === 0}
                      >
                        {t("收起全部", "Collapse All")}
                      </Button>
                      <Button variant="outline" onClick={resetAiCallFilters}>
                        {t("重置筛选", "Reset Filters")}
                      </Button>
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
                    {hasCustomAiCallDateRange ? (
                      <Tag theme="primary" variant="light-outline">
                        {t("范围", "Range")}={aiCallDateRange[0]} ~ {aiCallDateRange[1]}
                      </Tag>
                    ) : null}
                    {aiCallKeywordFilter.trim() ? (
                      <Tag theme="primary" variant="light-outline">
                        {t("关键词", "Keyword")}=
                        {aiCallKeywordFilter.trim().slice(0, 24)}
                        {aiCallKeywordFilter.trim().length > 24 ? "..." : ""}
                      </Tag>
                    ) : null}
                  </div>

                  {deferredAiCallLogs.length === 0 ? (
                    <p className="tc-upstream-advice">{t("暂无 AI 调用日志。先发起一次模型请求后再查看。", "No AI call logs yet. Send one model request first.")}</p>
                  ) : (
                    <div className="tc-log-list">
                      {deferredAiCallLogs.map((item) => {
                        const assistantReasoning = item.assistantReasoning?.trim() || "";
                        const assistantResponse = item.assistantResponse?.trim() || "";
                        const displayAssistantResponse =
                          assistantReasoning && assistantReasoning === assistantResponse
                            ? ""
                            : item.assistantResponse || "";
                        const expanded = expandedAiCallLogIdSet.has(item.id);
                        const previewText = summarizeLogPreview(
                          displayAssistantResponse,
                          assistantReasoning,
                          item.userPrompt || "",
                          item.conversationTranscript || ""
                        );

                        return (
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
                              <div className="tc-log-head-actions">
                                <span className="tc-log-time">{formatCnDate(item.createdAt)}</span>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => toggleAiCallLogExpanded(item.id)}
                                >
                                  {expanded ? t("收起详情", "Collapse") : t("展开详情", "Expand")}
                                </Button>
                              </div>
                            </div>
                            <div className="tc-log-subline">
                              <code className="tc-log-path">
                                request={item.requestWireApi} · upstream={item.upstreamWireApi}
                              </code>
                              <span className="tc-log-id">log#{item.id}</span>
                            </div>
                          </div>
                          {expanded ? (
                            <>
                              {item.conversationTranscript?.trim() ? (
                                <div className="tc-log-panels">
                                  <div className="tc-log-panel tc-log-panel-full">
                                    <strong>完整上下文</strong>
                                    <MarkdownLogBlock value={item.conversationTranscript} />
                                  </div>
                                </div>
                              ) : null}
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
                              {assistantReasoning ? (
                                <div className="tc-log-panels">
                                  <div className="tc-log-panel tc-log-panel-full">
                                    <strong>{t("深度思考", "Deep Thinking")}</strong>
                                    <MarkdownLogBlock value={assistantReasoning} />
                                  </div>
                                </div>
                              ) : null}
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
                              {displayAssistantResponse ? (
                                <div className="tc-log-panels">
                                  <div className="tc-log-panel tc-log-panel-full">
                                    <strong>模型回答</strong>
                                    <MarkdownLogBlock value={displayAssistantResponse} />
                                  </div>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="tc-log-preview">
                              {previewText || t("详情已折叠，点击“展开详情”查看完整日志。", "Details collapsed. Click Expand to render the full log.")}
                            </div>
                          )}
                          </article>
                        );
                      })}
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
                    loadingUsage ? (
                      <UsageLoadingSkeleton />
                    ) : (
                      <div className="tc-usage-empty-state">
                        <div className="tc-usage-empty-icon">
                          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                            <rect x="8" y="24" width="12" height="28" rx="3" fill="#e2e8f0" />
                            <rect x="26" y="16" width="12" height="36" rx="3" fill="#cbd5e1" />
                            <rect x="44" y="8" width="12" height="44" rx="3" fill="#94a3b8" />
                          </svg>
                        </div>
                        <p className="tc-usage-empty-title">暂无 Token 用量数据</p>
                        <p className="tc-usage-empty-desc">先发起一次模型请求后再查看。数据将按分钟自动聚合。</p>
                      </div>
                    )
                  ) : (
                    <>
                      <div className="tc-stat-cards-grid">
                        <UsageStatCard variant="requests" value={usageReport.summary.requestCount} delay={0} locale={locale} />
                        <UsageStatCard variant="prompt" value={usageReport.summary.promptTokens} delay={0.08} locale={locale} />
                        <UsageStatCard variant="completion" value={usageReport.summary.completionTokens} delay={0.16} locale={locale} />
                        <UsageStatCard variant="total" value={usageReport.summary.totalTokens} delay={0.24} locale={locale} />
                      </div>

                      {/* 数据刷新时的顶部 loading 条 */}
                      {loadingUsage ? (
                        <div className="tc-usage-refresh-bar">
                          <div className="tc-usage-refresh-bar-inner" />
                        </div>
                      ) : null}

                      <div className="tc-usage-charts">
                        <div className="tc-usage-chart-card tc-usage-chart-wide">
                          <h4>{t("趋势图", "Trend")}（{usagePrimaryMetricMeta.label}）</h4>
                          <p className="tc-usage-chart-note">
                            {t("时间桶", "Time bucket")} {resolvedUsageBucketMinutes} {t("分钟", "min")}，{t("统计", "covering")}
                            {hasCustomUsageDateRange
                              ? ` ${usageDateRange[0]} ${t("至", "to")} ${usageDateRange[1]}`
                              : usageMinutes >= 1440
                                ? ` ${t("最近", "last")} ${(usageMinutes / 1440).toFixed(usageMinutes % 1440 === 0 ? 0 : 1)} ${t("天", "days")}`
                                : ` ${t("最近", "last")} ${usageMinutes} ${t("分钟", "min")}`}
                            {t("的用量趋势", " usage trend.")}
                          </p>
                          {usageTimelineChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usageTimelineChartOption}
                              style={{ width: "100%", height: usageTimelineChartHeight }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">{t("暂无分钟趋势数据。", "No timeline data available.")}</p>
                          )}
                        </div>

                        <div className="tc-usage-chart-card">
                          <h4>Key Top12（{usagePrimaryMetricMeta.shortLabel}）</h4>
                          <p className="tc-usage-chart-note">{t("对比不同本地 Key 的核心指标分布。", "Compare key-level metric distribution.")}</p>
                          {usagePerKeyChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usagePerKeyChartOption}
                              style={{ width: "100%", height: 320 }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">{t("暂无 Key 维度数据。", "No key-level data.")}</p>
                          )}
                        </div>

                        <div className="tc-usage-chart-card">
                          <h4>{t("真实模型 Top10", "Upstream Model Top10")}（{usagePrimaryMetricMeta.shortLabel}）</h4>
                          <p className="tc-usage-chart-note">{t("识别高消耗模型，辅助做策略切换与限流。", "Identify high-consumption models for policy tuning.")}</p>
                          {usagePerModelChartOption ? (
                            <ReactECharts
                              notMerge
                              lazyUpdate
                              option={usagePerModelChartOption}
                              style={{ width: "100%", height: 320 }}
                            />
                          ) : (
                            <p className="tc-upstream-advice">{t("暂无模型维度数据。", "No model-level data.")}</p>
                          )}
                        </div>
                      </div>

                      {/* 饼图分布 */}
                      <div className="tc-usage-charts">
                        {usageReport.perKey.length > 0 ? (
                          <UsagePieChart
                            title={`Key 分布（${usagePrimaryMetricMeta.shortLabel}）`}
                            slices={usageReport.perKey.slice(0, 8).map((item) => ({
                              name: item.keyName,
                              value: pickUsageMetricValue(item, usageMetric)
                            }))}
                            height={260}
                            delay={0.4}
                            EChartsComponent={ReactECharts}
                          />
                        ) : null}
                        {usageReport.perModel.length > 0 ? (
                          <UsagePieChart
                            title={`模型分布（${usagePrimaryMetricMeta.shortLabel}）`}
                            slices={usageReport.perModel.slice(0, 8).map((item) => ({
                              name: item.model,
                              value: pickUsageMetricValue(item, usageMetric)
                            }))}
                            height={260}
                            delay={0.5}
                            EChartsComponent={ReactECharts}
                          />
                        ) : null}
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
                        <CodeBlock value={apiDocExamples.chatCompletions} language="bash" />
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
                        <CodeBlock value={apiDocExamples.responses} language="bash" />
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
                        <CodeBlock value={apiDocExamples.anthropicMessages} language="bash" />
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
                          <CodeBlock value={runtimeApiExamples.queryStatus} language="bash" />
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
                          <CodeBlock value={runtimeApiExamples.switchModel} language="bash" />
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
                          <CodeBlock value={runtimeApiExamples.clearOverride} language="bash" />
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
                          <CodeBlock value={runtimeApiExamples.toggleEnabledById} language="bash" />
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
                          <CodeBlock value={runtimeApiExamples.payloadSchema} language="json" />
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

            <Dialog
              visible={quickExportDialogVisible}
              width="min(92vw, 800px)"
              header={t("导出模型池", "Export Model Pool")}
              cancelBtn={t("关闭", "Close")}
              confirmBtn={t("复制到剪贴板", "Copy to Clipboard")}
              onConfirm={() => void handleQuickCopyModels()}
              onClose={() => setQuickExportDialogVisible(false)}
            >
              <div className="tc-quick-io-content">
                <p className="tc-upstream-advice">
                  {t(
                    "以下 JSON 可保存到文件或粘贴到其他渠道的「导入模型池」中。内部 ID 和 API Key 已移除，可安全分享。",
                    "Save this JSON to a file or paste into another channel's Import Model Pool. Internal IDs and API keys are stripped for safe sharing."
                  )}
                </p>
                <CodeBlock value={quickExportJson} language="json" />
              </div>
            </Dialog>

            <Dialog
              visible={quickImportDialogVisible}
              width="min(92vw, 800px)"
              header={t("导入模型池", "Import Model Pool")}
              cancelBtn={t("取消", "Cancel")}
              confirmBtn={t("追加到现有模型", "Append to Existing")}
              onConfirm={handleQuickImportConfirm}
              onClose={() => setQuickImportDialogVisible(false)}
            >
              <div className="tc-quick-io-content">
                <p className="tc-upstream-advice">
                  {t(
                    "粘贴导出的 JSON，将模型追加到当前渠道模型池末尾。也可直接粘贴模型数组 [{ ... }]。",
                    "Paste exported JSON to append models to the current channel pool. You can also paste a bare model array [{ ... }]."
                  )}
                </p>
                <Textarea
                  placeholder='{"version":1,"models":[...]}\n\nor\n[{"model":"glm-5","name":"GLM-5",...}]'
                  value={quickImportJson}
                  onChange={(value) => setQuickImportJson(value)}
                  autosize
                />
                <div className="tc-quick-io-actions">
                  <Button
                    theme="danger"
                    variant="outline"
                    onClick={handleQuickImportReplace}
                    disabled={!quickImportJson.trim()}
                  >
                    {t("替换全部模型", "Replace All Models")}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              visible={quickExportKeyMappingDialogVisible}
              width="min(92vw, 800px)"
              header={t("导出模型映射", "Export Model Mappings")}
              cancelBtn={t("关闭", "Close")}
              confirmBtn={t("复制到剪贴板", "Copy to Clipboard")}
              onConfirm={() => void handleQuickCopyKeyMappings()}
              onClose={() => setQuickExportKeyMappingDialogVisible(false)}
            >
              <div className="tc-quick-io-content">
                <p className="tc-upstream-advice">
                  {t(
                    "以下 JSON 可粘贴到其他本地 Key 的「导入映射」中。内部映射 ID 已移除；映射级渠道绑定会附带渠道名，导入时优先按渠道名恢复。",
                    "Paste this JSON into another local key's Import Mappings dialog. Internal mapping IDs are removed, and mapping-level upstream bindings include channel names so import can restore them by name first."
                  )}
                </p>
                <CodeBlock value={quickExportKeyMappingJson} language="json" />
              </div>
            </Dialog>

            <Dialog
              visible={quickImportKeyMappingDialogVisible}
              width="min(92vw, 800px)"
              header={t("导入模型映射", "Import Model Mappings")}
              cancelBtn={t("取消", "Cancel")}
              confirmBtn={t("追加到现有映射", "Append to Existing")}
              onConfirm={() => handleQuickImportKeyMappings(false)}
              onClose={() => setQuickImportKeyMappingDialogVisible(false)}
            >
              <div className="tc-quick-io-content">
                <p className="tc-upstream-advice">
                  {t(
                    "粘贴导出的 JSON，将映射追加到当前 Key。也可直接粘贴映射数组 [{ ... }]。导入只更新表单，仍需点击页面底部「保存 Key」。",
                    "Paste exported JSON to append mappings to the current key. You can also paste a bare mapping array [{ ... }]. Import updates only the form, so you still need to click Save Key at the bottom."
                  )}
                </p>
                <Textarea
                  placeholder='{"version":1,"mappings":[...]}\n\nor\n[{"clientModel":"gpt-5.4","targetModel":"glm-5",...}]'
                  value={quickImportKeyMappingJson}
                  onChange={(value) => setQuickImportKeyMappingJson(value)}
                  autosize
                />
                <div className="tc-quick-io-actions">
                  <Button
                    theme="danger"
                    variant="outline"
                    onClick={() => handleQuickImportKeyMappings(true)}
                    disabled={!quickImportKeyMappingJson.trim()}
                  >
                    {t("替换全部映射", "Replace All Mappings")}
                  </Button>
                </div>
              </div>
            </Dialog>
          </Layout.Content>
        </Layout>
      </Layout>
    </div>
  );
}
