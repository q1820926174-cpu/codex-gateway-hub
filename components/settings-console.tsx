"use client";

import {
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
import {
  type BulkJsonImportPreview
} from "@/components/console/bulk-json-dialogs";
import {
  createCodexExportBundle,
  type CodexApplyPatchToolType,
  type CodexExportBundle
} from "@/lib/codex-export";
import { CodeBlock } from "@/components/code-block";
import type { ChartDatum } from "@/components/ui/AntVPlots";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import {
  parseOverflowModelSelection,
  serializeOverflowModelSelection
} from "@/lib/overflow-model";
import {
  MAX_COMPAT_PROMPT_RULES,
  MAX_KEY_MODEL_MAPPINGS,
  MAX_UPSTREAM_MODELS,
  quickExportCompatPromptRules,
  quickExportKeyMappings,
  quickExportModels,
  quickImportCompatPromptRules,
  quickImportKeyMappings,
  quickImportModels
} from "@/lib/quick-import-export";
import { useLocale } from "@/components/locale-provider";
import type {
  PromptLabFailureCase,
  PromptOptimizerResult,
  PromptLabRun,
  RulePreviewResult
} from "@/lib/prompt-lab-types";
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
const renderNothing = () => null;
const BulkJsonImportDialog = dynamic(
  () => import("@/components/console/bulk-json-dialogs").then((module) => module.BulkJsonImportDialog),
  { ssr: false, loading: renderNothing }
);
const BulkJsonExportDialog = dynamic(
  () => import("@/components/console/bulk-json-dialogs").then((module) => module.BulkJsonExportDialog),
  { ssr: false, loading: renderNothing }
);
const WorkspaceDashboard = dynamic(
  () => import("@/components/console/workspace-dashboard").then((module) => module.WorkspaceDashboard),
  { loading: renderNothing }
);
const SettingsAccessPanel = dynamic(
  () => import("@/components/console/editor-panels/settings-access-panel").then((module) => module.SettingsAccessPanel),
  { loading: renderNothing }
);
const SettingsPromptPanel = dynamic(
  () => import("@/components/console/editor-panels/settings-prompt-panel").then((module) => module.SettingsPromptPanel),
  { loading: renderNothing }
);
const SettingsExportPanel = dynamic(
  () => import("@/components/console/editor-panels/settings-export-panel").then((module) => module.SettingsExportPanel),
  { loading: renderNothing }
);
const SettingsUpstreamPanel = dynamic(
  () => import("@/components/console/editor-panels/settings-upstream-panel").then((module) => module.SettingsUpstreamPanel),
  { loading: renderNothing }
);
const SettingsLogsPanel = dynamic(
  () => import("@/components/console/panels/settings-logs-panel").then((module) => module.SettingsLogsPanel),
  { loading: renderNothing }
);
const SettingsCallsPanel = dynamic(
  () => import("@/components/console/panels/settings-calls-panel").then((module) => module.SettingsCallsPanel),
  { loading: renderNothing }
);
const SettingsUsagePanel = dynamic(
  () => import("@/components/console/panels/settings-usage-panel").then((module) => module.SettingsUsagePanel),
  { loading: renderNothing }
);
const SettingsDocsPanel = dynamic(
  () => import("@/components/console/panels/settings-docs-panel").then((module) => module.SettingsDocsPanel),
  { loading: renderNothing }
);
const SettingsRuntimePanel = dynamic(
  () => import("@/components/console/panels/settings-runtime-panel").then((module) => module.SettingsRuntimePanel),
  { loading: renderNothing }
);
import {
  AI_CALL_RANGE_OPTIONS,
  API_DOC_GATEWAY_ENDPOINTS,
  API_DOC_MANAGEMENT_ENDPOINTS,
  CODING_PRESETS,
  DEFAULT_GATEWAY_ORIGIN,
  DOUBAO_THINKING_TYPES,
  EMPTY_AI_CALL_FILTER_OPTIONS,
  EMPTY_AI_CALL_STATS,
  EMPTY_USAGE_FILTER_OPTIONS,
  GLM_CODEX_THINKING_THRESHOLDS,
  LOCALE_OPTIONS,
  MODULE_LABEL,
  MODULE_SUMMARY,
  PROVIDERS,
  PROVIDER_DEFAULT_BASE_URL,
  PROVIDER_META,
  UPSTREAM_WIRE_APIS,
  USAGE_METRIC_META,
  USAGE_RANGE_OPTIONS
} from "@/components/console/types";
import type {
  AiCallLogEntry,
  AiCallLogFilterOptions,
  AiCallLogStats,
  ApiLogEntry,
  ChannelFormState,
  ChannelsResponse,
  CodingPreset,
  DoubaoThinkingType,
  EditorModule,
  GatewayKey,
  GlmCodexThinkingThreshold,
  KeyFormState,
  KeyModelMapping,
  KeysResponse,
  ProviderName,
  UpstreamChannel,
  UpstreamModelConfig,
  UpstreamWireApi,
  UsageBucketMode,
  UsageFilterOptions,
  UsageMetricKey,
  UsageReport,
  UsageTimelineRow
} from "@/components/console/types";
import {
  downloadTextAsFile as saveTextAsFile,
  generateLocalKey,
  generateMappingId,
  resolveDownloadFileName
} from "@/lib/console-utils";
import {
  MarkdownLogBlock,
  buildPromptLabHintFromFailure,
  buildRecentDateRange,
  createCompatPromptRuleDraft,
  createEmptyChannelFormState,
  createEmptyKeyFormState,
  createUpstreamModelDraft,
  ensureCompatPromptRuleIdsUnique,
  formatClaudeModelWithContext,
  formatCnDate,
  formatCompactNumber,
  formatCompatPromptExemptionsInput,
  formatCompatPromptKeywordsInput,
  formatCompatPromptRulesJson,
  formatMinuteLabel,
  formatNumber,
  formatSignedNumber,
  humanizeConsoleErrorMessage,
  inferContextWindowFromModel,
  inspectCompatPromptRules,
  isUsageCalendarRange,
  maskLocalKey,
  normalizeAiCallFilterOptions,
  normalizeCompatPromptRule,
  normalizeCompatPromptRules,
  normalizeGlmCodexThinkingThreshold,
  normalizeModelCode,
  normalizeSelectValue,
  parseCompatPromptExemptionsInput,
  parseCompatPromptKeywordsInput,
  parseCompatPromptRulesJson,
  parsePromptLabModelListInput,
  pickUsageMetricValue,
  resolveClaudeMaxOutputTokens,
  resolveCodexTokenBudgets,
  resolveThinkingTokens,
  resolveUsageBucketMinutes,
  sanitizeTomlKey,
  shouldShowDoubaoThinkingType,
  shouldShowGlmThinkingThreshold,
  stringifyCompatPromptRuleForSearch,
  summarizeLogPreview,
  syncChannelFormWithModelPool,
  toBase64Utf8,
  toChannelForm,
  toKeyForm,
  type CompatPromptConfig,
  type CompatPromptRule,
  type ConfigSummaryResponse,
  type PromptLabReportResponse,
  type PromptLabRunSummaryResponse
} from "@/components/console/settings-console-helpers";
import { ActiveFilterSummary } from "@/components/console/filters/ActiveFilterSummary";
import { FilterSection } from "@/components/console/filters/FilterSection";

export type { EditorModule } from "@/components/console/types";
export { formatCompactNumber, formatNumber } from "@/components/console/settings-console-helpers";

type SettingsConsoleProps = {
  module?: EditorModule;
};

type BulkJsonImportTarget = "compatPromptRules" | "upstreamModels" | "keyMappings";

type BulkImportPreviewState<T> = BulkJsonImportPreview & {
  items: T[];
  note: string;
};

type FilterChipTone = "default" | "primary" | "success" | "warning";

type ActiveFilterChip = {
  key: string;
  label: string;
  value: string;
  tone?: FilterChipTone;
  onClear?: () => void;
};

type SavedFilterPreset<T> = {
  id: string;
  name: string;
  value: T;
  updatedAt: string;
};

type SelectorStatusFilter = "all" | "enabled" | "disabled";
type BoolFilter = "all" | "yes" | "no";
type ApiLogStatusFilter = "all" | "success" | "warning" | "error";
type PromptRuleIssueFilter = "all" | "error" | "warn" | "attention" | "clean";

type AiCallFilterPresetValue = {
  limit: number;
  keyId: number | null;
  dateRange: string[];
  keyword: string;
  route: string;
  requestWireApi: string;
  upstreamWireApi: string;
  model: string;
  requestedModel: string;
  clientModel: string;
  stream: "" | "stream" | "non_stream";
  callType: "" | "main" | "vision_fallback";
};

type UsageFilterPresetValue = {
  minutes: number;
  dateRange: string[];
  metric: UsageMetricKey;
  bucketMode: UsageBucketMode;
  keyId: number | null;
  model: string;
  route: string;
  requestWireApi: string;
  upstreamWireApi: string;
  stream: "" | "stream" | "non_stream";
  timelineLimit: number;
};

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function matchesTextSearch(source: Array<string | number | null | undefined>, keyword: string) {
  const normalized = normalizeSearchText(keyword);
  if (!normalized) {
    return true;
  }
  return source
    .filter((item): item is string | number => item !== null && item !== undefined)
    .map((item) => String(item).toLowerCase())
    .some((item) => item.includes(normalized));
}

function ensureOptionVisible(
  options: Array<{ label: string; value: string }>,
  option: { label: string; value: string } | null
) {
  if (!option || options.some((item) => item.value === option.value)) {
    return options;
  }
  return [option, ...options];
}

function cloneKeyFormState(form: KeyFormState): KeyFormState {
  return {
    ...form,
    modelMappings: form.modelMappings.map((item) => ({
      ...item
    }))
  };
}

function serializeKeyFormState(form: KeyFormState) {
  return JSON.stringify({
    ...form,
    upstreamChannelId:
      typeof form.upstreamChannelId === "number" ? form.upstreamChannelId : null,
    contextSwitchThreshold: Number(form.contextSwitchThreshold),
    contextOverflowModel: form.contextOverflowModel ?? "",
    dailyRequestLimit: form.dailyRequestLimit ?? "",
    dailyTokenLimit: form.dailyTokenLimit ?? "",
    modelMappings: form.modelMappings.map((item) => ({
      ...item,
      upstreamChannelId:
        typeof item.upstreamChannelId === "number" ? item.upstreamChannelId : null,
      thinkingType: item.thinkingType ?? null,
      contextSwitchThreshold: Number(item.contextSwitchThreshold),
      contextOverflowModel: item.contextOverflowModel ?? null
    }))
  });
}

function parseOptionalPositiveIntegerInput(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label}必须是大于 0 的整数，或留空表示不限。`);
  }
  return parsed;
}

function readFilterPresets<T>(storageKey: string) {
  if (typeof window === "undefined") {
    return [] as Array<SavedFilterPreset<T>>;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [] as Array<SavedFilterPreset<T>>;
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is SavedFilterPreset<T> =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as SavedFilterPreset<T>).id === "string" &&
            typeof (item as SavedFilterPreset<T>).name === "string"
        )
      : [];
  } catch {
    return [] as Array<SavedFilterPreset<T>>;
  }
}

function writeFilterPresets<T>(storageKey: string, presets: Array<SavedFilterPreset<T>>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(presets));
}

function createFilterPresetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function upsertFilterPreset<T>(
  presets: Array<SavedFilterPreset<T>>,
  name: string,
  value: T
) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return presets;
  }
  const now = new Date().toISOString();
  const nextPreset: SavedFilterPreset<T> = {
    id: createFilterPresetId(),
    name: normalizedName,
    value,
    updatedAt: now
  };
  const existingIndex = presets.findIndex(
    (item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase()
  );
  if (existingIndex >= 0) {
    const cloned = presets.slice();
    cloned[existingIndex] = {
      ...cloned[existingIndex],
      value,
      updatedAt: now
    };
    return cloned.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return [nextPreset, ...presets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const isAccessRoute = routeModule === "access";
  const isPromptRoute = routeModule === "prompt";
  const isExportRoute = routeModule === "export";
  const isUpstreamRoute = routeModule === "upstream";
  const isRuntimeRoute = routeModule === "runtime";
  const isLogsRoute = routeModule === "logs";
  const isCallsRoute = routeModule === "calls";
  const isUsageRoute = routeModule === "usage";
  const shouldBuildKeyViews = isAccessRoute || isExportRoute || isRuntimeRoute;

  function createIdleBulkImportPreview<T>(): BulkImportPreviewState<T> {
    return {
      state: "idle",
      items: [],
      note: "",
      itemCount: 0,
      enabledCount: null,
      appendTotal: 0,
      replaceTotal: 0,
      warnCount: 0,
      errorCount: 0,
      message: "",
      tone: "info"
    };
  }

  function buildBulkImportPreview<T>({
    rawValue,
    currentCount,
    parse,
    getEnabledCount,
    inspectItems,
    limit,
    readyMessage,
    warningMessage,
    errorMessage,
    appendLimitMessage,
    replaceLimitMessage
  }: {
    rawValue: string;
    currentCount: number;
    parse: (value: string) => { ok: true; items: T[]; note: string } | { ok: false; error: string };
    getEnabledCount?: (item: T) => boolean;
    inspectItems?: (items: T[]) => Array<{ level: "warn" | "error"; message: string }>;
    limit: number;
    readyMessage: (note: string) => string;
    warningMessage: (warnCount: number) => string;
    errorMessage: (errorCount: number) => string;
    appendLimitMessage: () => string;
    replaceLimitMessage: () => string;
  }): BulkImportPreviewState<T> {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return createIdleBulkImportPreview<T>();
    }

    const result = parse(trimmed);
    if (!result.ok) {
      return {
        ...createIdleBulkImportPreview<T>(),
        state: "error",
        message: result.error,
        tone: "err"
      };
    }

    const items = result.items;
    const issues = inspectItems ? inspectItems(items) : [];
    const warnCount = issues.filter((item) => item.level === "warn").length;
    const errorCount = issues.filter((item) => item.level === "error").length;
    const enabledCount = getEnabledCount ? items.filter((item) => getEnabledCount(item)).length : null;
    const appendTotal = currentCount + items.length;
    const replaceTotal = items.length;

    if (appendTotal > limit) {
      return {
        state: "ready",
        items,
        note: result.note,
        itemCount: items.length,
        enabledCount,
        appendTotal,
        replaceTotal,
        warnCount,
        errorCount,
        message: appendLimitMessage(),
        tone: "err"
      };
    }

    if (replaceTotal > limit) {
      return {
        state: "ready",
        items,
        note: result.note,
        itemCount: items.length,
        enabledCount,
        appendTotal,
        replaceTotal,
        warnCount,
        errorCount,
        message: replaceLimitMessage(),
        tone: "err"
      };
    }

    if (errorCount > 0) {
      return {
        state: "ready",
        items,
        note: result.note,
        itemCount: items.length,
        enabledCount,
        appendTotal,
        replaceTotal,
        warnCount,
        errorCount,
        message: errorMessage(errorCount),
        tone: "err"
      };
    }

    if (warnCount > 0) {
      return {
        state: "ready",
        items,
        note: result.note,
        itemCount: items.length,
        enabledCount,
        appendTotal,
        replaceTotal,
        warnCount,
        errorCount,
        message: warningMessage(warnCount),
        tone: "warn"
      };
    }

    return {
      state: "ready",
      items,
      note: result.note,
      itemCount: items.length,
      enabledCount,
      appendTotal,
      replaceTotal,
      warnCount,
      errorCount,
      message: readyMessage(result.note),
      tone: "ok"
    };
  }

  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [channels, setChannels] = useState<UpstreamChannel[]>([]);
  const [wireApi, setWireApi] = useState("responses");

  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [keySelectorSearch, setKeySelectorSearch] = useState("");
  const [keySelectorStatusFilter, setKeySelectorStatusFilter] =
    useState<SelectorStatusFilter>("all");
  const [channelSelectorSearch, setChannelSelectorSearch] = useState("");
  const [channelSelectorStatusFilter, setChannelSelectorStatusFilter] =
    useState<SelectorStatusFilter>("all");
  const [channelSelectorProviderFilter, setChannelSelectorProviderFilter] = useState("all");

  const [keyForm, setKeyForm] = useState<KeyFormState>(() => createEmptyKeyFormState());
  const [savedKeyForm, setSavedKeyForm] = useState<KeyFormState>(() => createEmptyKeyFormState());
  const [channelForm, setChannelForm] = useState<ChannelFormState>(() => createEmptyChannelFormState());
  const [keyMappingSearch, setKeyMappingSearch] = useState("");
  const [keyMappingStatusFilter, setKeyMappingStatusFilter] = useState<SelectorStatusFilter>("all");
  const [keyMappingBindingFilter, setKeyMappingBindingFilter] = useState<"all" | "inherit" | "bound">("all");
  const [keyMappingOverflowFilter, setKeyMappingOverflowFilter] = useState<BoolFilter>("all");
  const [channelModelSearch, setChannelModelSearch] = useState("");
  const [channelModelStatusFilter, setChannelModelStatusFilter] =
    useState<SelectorStatusFilter>("all");
  const [channelModelWireApiFilter, setChannelModelWireApiFilter] = useState("all");
  const [channelModelVisionFilter, setChannelModelVisionFilter] = useState<BoolFilter>("all");

  const [quickImportJson, setQuickImportJson] = useState("");
  const [quickImportSource, setQuickImportSource] = useState("");
  const [quickImportDialogVisible, setQuickImportDialogVisible] = useState(false);
  const [quickExportDialogVisible, setQuickExportDialogVisible] = useState(false);
  const [quickImportKeyMappingJson, setQuickImportKeyMappingJson] = useState("");
  const [quickImportKeyMappingSource, setQuickImportKeyMappingSource] = useState("");
  const [quickImportKeyMappingDialogVisible, setQuickImportKeyMappingDialogVisible] =
    useState(false);
  const [quickExportKeyMappingDialogVisible, setQuickExportKeyMappingDialogVisible] =
    useState(false);

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
  const [apiLogKeywordFilter, setApiLogKeywordFilter] = useState("");
  const [apiLogRouteFilter, setApiLogRouteFilter] = useState("");
  const [apiLogMethodFilter, setApiLogMethodFilter] = useState("all");
  const [apiLogStatusFilter, setApiLogStatusFilter] = useState<ApiLogStatusFilter>("all");
  const [apiLogErrorOnly, setApiLogErrorOnly] = useState(false);
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
  const [aiCallPresetName, setAiCallPresetName] = useState("");
  const [aiCallSelectedPresetId, setAiCallSelectedPresetId] = useState("all");
  const [aiCallSavedPresets, setAiCallSavedPresets] = useState<
    Array<SavedFilterPreset<AiCallFilterPresetValue>>
  >(() => readFilterPresets<AiCallFilterPresetValue>("codex-gateway-hub:ai-call-presets"));
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const deferredAiCallLogs = useDeferredValue(aiCallLogs);
  const deferredApiLogs = useDeferredValue(apiLogs);
  const [usageReport, setUsageReport] = useState<UsageReport | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [autoRefreshUsage, setAutoRefreshUsage] = useState(true);
  const [usageMinutes, setUsageMinutes] = useState(180);
  const [usageDateRange, setUsageDateRange] = useState<string[]>([]);
  const [usageMetric, setUsageMetric] = useState<UsageMetricKey>("totalTokens");
  const [usageBucketMode, setUsageBucketMode] = useState<UsageBucketMode>("auto");
  const [usageTimelineLimit, setUsageTimelineLimit] = useState(600);
  const [usageKeyFilter, setUsageKeyFilter] = useState<number | null>(null);
  const [usageModelFilter, setUsageModelFilter] = useState("");
  const [usageRouteFilter, setUsageRouteFilter] = useState("");
  const [usageRequestWireFilter, setUsageRequestWireFilter] = useState("");
  const [usageUpstreamWireFilter, setUsageUpstreamWireFilter] = useState("");
  const [usageStreamFilter, setUsageStreamFilter] = useState<"" | "stream" | "non_stream">("");
  const [usageFilterOptions, setUsageFilterOptions] =
    useState<UsageFilterOptions>(EMPTY_USAGE_FILTER_OPTIONS);
  const [usagePresetName, setUsagePresetName] = useState("");
  const [usageSelectedPresetId, setUsageSelectedPresetId] = useState("all");
  const [usageSavedPresets, setUsageSavedPresets] = useState<
    Array<SavedFilterPreset<UsageFilterPresetValue>>
  >(() => readFilterPresets<UsageFilterPresetValue>("codex-gateway-hub:usage-presets"));

  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingCompatPromptConfig, setSavingCompatPromptConfig] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [testingUpstream, setTestingUpstream] = useState(false);
  const [compatPromptKeywordsInput, setCompatPromptKeywordsInput] = useState("");
  const [compatPromptExemptionsInput, setCompatPromptExemptionsInput] = useState("");
  const [compatPromptHintInput, setCompatPromptHintInput] = useState("");
  const [compatPromptRulesDraft, setCompatPromptRulesDraft] = useState<CompatPromptRule[]>([]);
  const [compatPromptRuleSearch, setCompatPromptRuleSearch] = useState("");
  const [compatPromptRuleStatusFilter, setCompatPromptRuleStatusFilter] =
    useState<SelectorStatusFilter>("all");
  const [compatPromptRuleProviderFilter, setCompatPromptRuleProviderFilter] = useState("all");
  const [compatPromptRuleIssueFilter, setCompatPromptRuleIssueFilter] =
    useState<PromptRuleIssueFilter>("all");
  const [compatPromptRulesJsonInput, setCompatPromptRulesJsonInput] = useState("[]");
  const [showCompatPromptRulesJsonEditor, setShowCompatPromptRulesJsonEditor] = useState(false);
  const [compatPromptRulesImportDialogVisible, setCompatPromptRulesImportDialogVisible] =
    useState(false);
  const [compatPromptRulesExportDialogVisible, setCompatPromptRulesExportDialogVisible] =
    useState(false);
  const [compatPromptRulesQuickImportJson, setCompatPromptRulesQuickImportJson] = useState("");
  const [compatPromptRulesQuickImportSource, setCompatPromptRulesQuickImportSource] =
    useState("");
  const bulkJsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkJsonFileImportTarget, setBulkJsonFileImportTarget] =
    useState<BulkJsonImportTarget | null>(null);
  const [compatPromptDefaults, setCompatPromptDefaults] = useState<CompatPromptConfig | null>(
    null
  );
  const [promptConfigTab, setPromptConfigTab] = useState<"rules" | "lab">("rules");
  const [promptLabMode, setPromptLabMode] = useState<"cli" | "import">("cli");
  const [promptLabBaselineModel, setPromptLabBaselineModel] = useState("gpt-5.4");
  const [promptLabCandidateModelsInput, setPromptLabCandidateModelsInput] = useState(
    "gpt-5.3-codex\ngpt-5.2-codex"
  );
  const [promptLabSuiteId, setPromptLabSuiteId] = useState("tool-accuracy-v1");
  const [promptLabSandbox, setPromptLabSandbox] = useState<
    "read-only" | "workspace-write" | "danger-full-access"
  >("workspace-write");
  const [promptLabImportJsonInput, setPromptLabImportJsonInput] = useState("");
  const [promptLabRunId, setPromptLabRunId] = useState<string | null>(null);
  const [promptLabSubmitting, setPromptLabSubmitting] = useState(false);
  const [promptLabFetchingReport, setPromptLabFetchingReport] = useState(false);
  const [promptLabRunSummary, setPromptLabRunSummary] = useState<PromptLabRunSummaryResponse | null>(
    null
  );
  const [promptLabReport, setPromptLabReport] = useState<PromptLabReportResponse | null>(null);
  const [promptLabLastError, setPromptLabLastError] = useState("");
  const promptLabPollTimerRef = useRef<number | null>(null);
  const promptLabImportFileInputRef = useRef<HTMLInputElement | null>(null);
  const [rulePreviewProviderInput, setRulePreviewProviderInput] = useState("");
  const [rulePreviewUpstreamModelInput, setRulePreviewUpstreamModelInput] = useState("");
  const [rulePreviewClientModelInput, setRulePreviewClientModelInput] = useState("");
  const [rulePreviewLoading, setRulePreviewLoading] = useState(false);
  const [rulePreviewResult, setRulePreviewResult] = useState<RulePreviewResult | null>(null);
  const [showPromptLabRegressionCta, setShowPromptLabRegressionCta] = useState(false);
  const [promptOptimizerProviderInput, setPromptOptimizerProviderInput] = useState("");
  const [promptOptimizerUpstreamModelInput, setPromptOptimizerUpstreamModelInput] = useState("");
  const [promptOptimizerClientModelInput, setPromptOptimizerClientModelInput] = useState("");
  const [promptOptimizerBasePromptInput, setPromptOptimizerBasePromptInput] = useState("");
  const [promptOptimizerFocus, setPromptOptimizerFocus] = useState<
    "balanced" | "tool-calling" | "strict"
  >("balanced");
  const [promptOptimizerPreserveOriginal, setPromptOptimizerPreserveOriginal] = useState(true);
  const [promptOptimizerIssuesInput, setPromptOptimizerIssuesInput] = useState(
    "schema_error\nmissing_tool_call\nincomplete_task"
  );
  const [promptOptimizerRunning, setPromptOptimizerRunning] = useState(false);
  const [promptOptimizerResult, setPromptOptimizerResult] = useState<PromptOptimizerResult | null>(
    null
  );
  const [promptOptimizerError, setPromptOptimizerError] = useState("");

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
  const isKeyDirty = useMemo(
    () => serializeKeyFormState(keyForm) !== serializeKeyFormState(savedKeyForm),
    [keyForm, savedKeyForm]
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
  const filteredKeys = useMemo(
    () =>
      keys.filter((item) => {
        if (keySelectorStatusFilter === "enabled" && !item.enabled) {
          return false;
        }
        if (keySelectorStatusFilter === "disabled" && item.enabled) {
          return false;
        }
        return matchesTextSearch(
          [
            item.name,
            item.localKey,
            item.upstreamChannelName,
            item.provider,
            item.defaultModel,
            item.activeModelOverride
          ],
          keySelectorSearch
        );
      }),
    [keySelectorSearch, keySelectorStatusFilter, keys]
  );
  const filteredChannels = useMemo(
    () =>
      channels.filter((item) => {
        if (channelSelectorStatusFilter === "enabled" && !item.enabled) {
          return false;
        }
        if (channelSelectorStatusFilter === "disabled" && item.enabled) {
          return false;
        }
        if (channelSelectorProviderFilter !== "all" && item.provider !== channelSelectorProviderFilter) {
          return false;
        }
        return matchesTextSearch(
          [item.name, item.provider, item.upstreamBaseUrl, item.defaultModel],
          channelSelectorSearch
        );
      }),
    [channelSelectorProviderFilter, channelSelectorSearch, channelSelectorStatusFilter, channels]
  );

  const keySelectOptions = useMemo(
    () => {
      const filteredOptions = filteredKeys.map((item) => ({
        label: `${item.name} · ${maskLocalKey(item.localKey)}`,
        value: String(item.id)
      }));
      const selectedOption =
        selectedKey && !isNewKey
          ? {
              label: `${selectedKey.name} · ${maskLocalKey(selectedKey.localKey)}`,
              value: String(selectedKey.id)
            }
          : null;
      return [
        { label: `+ ${t("新建本地 Key", "New Local Key")}`, value: "__new__" },
        ...ensureOptionVisible(filteredOptions, selectedOption)
      ];
    },
    [filteredKeys, isNewKey, selectedKey, t]
  );

  const channelSelectOptions = useMemo(
    () => {
      const filteredOptions = filteredChannels.map((item) => ({
        label: `${item.name} · ${PROVIDER_META[item.provider].label} · ${t("模型", "models")}${item.upstreamModels.length}`,
        value: String(item.id)
      }));
      const selectedOption =
        selectedChannel && !isNewChannel
          ? {
              label: `${selectedChannel.name} · ${PROVIDER_META[selectedChannel.provider].label} · ${t("模型", "models")}${selectedChannel.upstreamModels.length}`,
              value: String(selectedChannel.id)
            }
          : null;
      return [
        { label: `+ ${t("新建上游渠道", "New Upstream")}`, value: "__new__" },
        ...ensureOptionVisible(filteredOptions, selectedOption)
      ];
    },
    [filteredChannels, isNewChannel, selectedChannel, t]
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

  const apiLogRouteOptions = useMemo(() => {
    if (!isLogsRoute) {
      return [{ label: t("全部路由", "All Routes"), value: "__all__" }];
    }
    const values = Array.from(
      new Set(
        apiLogs
          .map((item) => item.route?.trim())
          .filter((item): item is string => Boolean(item))
      )
    ).sort((a, b) => a.localeCompare(b));
    return [
      { label: t("全部路由", "All Routes"), value: "__all__" },
      ...values.map((item) => ({ label: item, value: item }))
    ];
  }, [apiLogs, isLogsRoute, t]);

  const apiLogMethodOptions = useMemo(() => {
    if (!isLogsRoute) {
      return [{ label: t("全部方法", "All Methods"), value: "__all__" }];
    }
    const values = Array.from(
      new Set(
        apiLogs
          .map((item) => item.method?.trim().toUpperCase())
          .filter((item): item is string => Boolean(item))
      )
    ).sort((a, b) => a.localeCompare(b));
    return [
      { label: t("全部方法", "All Methods"), value: "__all__" },
      ...values.map((item) => ({ label: item, value: item }))
    ];
  }, [apiLogs, isLogsRoute, t]);

  const filteredApiLogs = useMemo(
    () => {
      if (!isLogsRoute) {
        return [];
      }
      return deferredApiLogs.filter((item) => {
        if (apiLogRouteFilter && apiLogRouteFilter !== "__all__" && item.route !== apiLogRouteFilter) {
          return false;
        }
        if (apiLogMethodFilter !== "all" && item.method.toUpperCase() !== apiLogMethodFilter) {
          return false;
        }
        const statusBucket =
          item.status === null ? "error" : item.status >= 500 ? "error" : item.status >= 400 ? "warning" : "success";
        if (apiLogStatusFilter !== "all" && statusBucket !== apiLogStatusFilter) {
          return false;
        }
        if (apiLogErrorOnly && !item.error) {
          return false;
        }
        return matchesTextSearch(
          [item.id, item.route, item.method, item.path, item.requestBody, item.responseBody, item.error],
          apiLogKeywordFilter
        );
      });
    },
    [
      apiLogErrorOnly,
      apiLogKeywordFilter,
      apiLogMethodFilter,
      apiLogRouteFilter,
      apiLogStatusFilter,
      deferredApiLogs,
      isLogsRoute
    ]
  );

  const aiCallKeyOptions = useMemo(() => {
    if (!isCallsRoute) {
      return [{ label: t("全部 Key", "All Keys"), value: "__all__" }];
    }
    return [
      { label: t("全部 Key", "All Keys"), value: "__all__" },
      ...keys.map((item) => ({
        label: `${item.name} · ${maskLocalKey(item.localKey)}`,
        value: String(item.id)
      }))
    ];
  }, [isCallsRoute, keys, t]);

  const aiCallModelSelectOptions = useMemo(() => {
    if (!isCallsRoute) {
      return [{ label: t("全部模型", "All Models"), value: "__all__" }];
    }
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
  }, [aiCallFilterOptions.upstreamModels, aiCallModelOptions, isCallsRoute, t]);

  const aiCallTypeOptions = useMemo(
    () => [
      { label: t("全部调用", "All Calls"), value: "__all__" },
      { label: t("主调用", "Main Calls"), value: "main" },
      { label: t("辅助视觉", "Vision Fallback"), value: "vision_fallback" }
    ],
    [t]
  );

  const aiCallRouteOptions = useMemo(
    () => {
      if (!isCallsRoute) {
        return [{ label: t("全部路由", "All Routes"), value: "__all__" }];
      }
      return [
        { label: t("全部路由", "All Routes"), value: "__all__" },
        ...aiCallFilterOptions.routes.map((item) => ({
          label: item,
          value: item
        }))
      ];
    },
    [aiCallFilterOptions.routes, isCallsRoute, t]
  );

  const aiCallRequestWireOptions = useMemo(
    () => {
      if (!isCallsRoute) {
        return [{ label: t("全部请求协议", "All Request APIs"), value: "__all__" }];
      }
      return [
        { label: t("全部请求协议", "All Request APIs"), value: "__all__" },
        ...aiCallFilterOptions.requestWireApis.map((item) => ({
          label: item,
          value: item
        }))
      ];
    },
    [aiCallFilterOptions.requestWireApis, isCallsRoute, t]
  );

  const aiCallUpstreamWireOptions = useMemo(
    () => {
      if (!isCallsRoute) {
        return [{ label: t("全部上游协议", "All Upstream APIs"), value: "__all__" }];
      }
      return [
        { label: t("全部上游协议", "All Upstream APIs"), value: "__all__" },
        ...aiCallFilterOptions.upstreamWireApis.map((item) => ({
          label: item,
          value: item
        }))
      ];
    },
    [aiCallFilterOptions.upstreamWireApis, isCallsRoute, t]
  );

  const aiCallRequestedModelOptions = useMemo(
    () => {
      if (!isCallsRoute) {
        return [{ label: t("全部请求模型", "All Requested Models"), value: "__all__" }];
      }
      return [
        { label: t("全部请求模型", "All Requested Models"), value: "__all__" },
        ...aiCallFilterOptions.requestedModels.map((item) => ({
          label: item,
          value: item
        }))
      ];
    },
    [aiCallFilterOptions.requestedModels, isCallsRoute, t]
  );

  const aiCallClientModelOptions = useMemo(
    () => {
      if (!isCallsRoute) {
        return [{ label: t("全部客户端模型", "All Client Models"), value: "__all__" }];
      }
      return [
        { label: t("全部客户端模型", "All Client Models"), value: "__all__" },
        ...aiCallFilterOptions.clientModels.map((item) => ({
          label: item,
          value: item
        }))
      ];
    },
    [aiCallFilterOptions.clientModels, isCallsRoute, t]
  );

  const aiCallStreamOptions = useMemo(
    () => [
      { label: t("全部流式", "All Stream Modes"), value: "__all__" },
      { label: t("仅 stream", "Stream Only"), value: "stream" },
      { label: t("仅非 stream", "Non-stream Only"), value: "non_stream" }
    ],
    [t]
  );
  const usageModelOptions = useMemo(() => {
    if (!isUsageRoute) {
      return [{ label: t("全部真实模型", "All Upstream Models"), value: "__all__" }];
    }
    return [
      { label: t("全部真实模型", "All Upstream Models"), value: "__all__" },
      ...usageFilterOptions.upstreamModels.map((item: string) => ({
        label: item,
        value: item
      }))
    ];
  }, [isUsageRoute, t, usageFilterOptions.upstreamModels]);
  const usageRouteOptions = useMemo(() => {
    if (!isUsageRoute) {
      return [{ label: t("全部路由", "All Routes"), value: "__all__" }];
    }
    return [
      { label: t("全部路由", "All Routes"), value: "__all__" },
      ...usageFilterOptions.routes.map((item: string) => ({
        label: item,
        value: item
      }))
    ];
  }, [isUsageRoute, t, usageFilterOptions.routes]);
  const usageRequestWireOptions = useMemo(() => {
    if (!isUsageRoute) {
      return [{ label: t("全部请求协议", "All Request APIs"), value: "__all__" }];
    }
    return [
      { label: t("全部请求协议", "All Request APIs"), value: "__all__" },
      ...usageFilterOptions.requestWireApis.map((item: string) => ({
        label: item,
        value: item
      }))
    ];
  }, [isUsageRoute, t, usageFilterOptions.requestWireApis]);
  const usageUpstreamWireOptions = useMemo(() => {
    if (!isUsageRoute) {
      return [{ label: t("全部上游协议", "All Upstream APIs"), value: "__all__" }];
    }
    return [
      { label: t("全部上游协议", "All Upstream APIs"), value: "__all__" },
      ...usageFilterOptions.upstreamWireApis.map((item: string) => ({
        label: item,
        value: item
      }))
    ];
  }, [isUsageRoute, t, usageFilterOptions.upstreamWireApis]);
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
  const isTodayUsageRange = hasCustomUsageDateRange && isUsageCalendarRange(usageDateRange, 1);
  const isLast3DaysUsageRange = hasCustomUsageDateRange && isUsageCalendarRange(usageDateRange, 3);
  const isLast7DaysUsageRange = hasCustomUsageDateRange && isUsageCalendarRange(usageDateRange, 7);
  const usageDateFrom = usageDateRange[0] ?? "";
  const usageDateTo = usageDateRange[1] ?? "";
  const usageRangeTagLabel = hasCustomUsageDateRange
    ? isTodayUsageRange
      ? t("范围 今天", "Range Today")
      : isLast3DaysUsageRange
        ? t("范围 近 3 天", "Range Last 3 Days")
        : isLast7DaysUsageRange
          ? t("范围 近 7 天", "Range Last 7 Days")
          : `${t("范围", "Range")} ${usageDateRange[0]} ~ ${usageDateRange[1]}`
    : `${t("窗口", "Window")} ${usageMinutes} ${t("分钟", "minutes")}`;
  const keyMappingVisibleItems = useMemo(() => {
    if (!shouldBuildKeyViews) {
      return [];
    }
    return keyForm.modelMappings.filter((item) => {
      if (keyMappingStatusFilter === "enabled" && !item.enabled) {
        return false;
      }
      if (keyMappingStatusFilter === "disabled" && item.enabled) {
        return false;
      }
      if (keyMappingBindingFilter === "inherit" && item.upstreamChannelId !== null) {
        return false;
      }
      if (keyMappingBindingFilter === "bound" && item.upstreamChannelId === null) {
        return false;
      }
      if (keyMappingOverflowFilter === "yes" && !item.dynamicModelSwitch) {
        return false;
      }
      if (keyMappingOverflowFilter === "no" && item.dynamicModelSwitch) {
        return false;
      }
      const mappingChannel =
        typeof item.upstreamChannelId === "number"
          ? channels.find((channel) => channel.id === item.upstreamChannelId) ?? null
          : selectedChannelForKey;
      return matchesTextSearch(
        [
          item.clientModel,
          item.targetModel,
          mappingChannel?.name,
          item.contextOverflowModel,
          item.thinkingType
        ],
        keyMappingSearch
      );
    });
  }, [
    channels,
    keyForm.modelMappings,
    keyMappingBindingFilter,
    keyMappingOverflowFilter,
    keyMappingSearch,
    keyMappingStatusFilter,
    selectedChannelForKey,
    shouldBuildKeyViews
  ]);
  const channelModelVisibleItems = useMemo(() => {
    if (!isUpstreamRoute) {
      return [];
    }
    return channelForm.upstreamModels.filter((item) => {
      if (channelModelStatusFilter === "enabled" && !item.enabled) {
        return false;
      }
      if (channelModelStatusFilter === "disabled" && item.enabled) {
        return false;
      }
      if (channelModelWireApiFilter !== "all" && item.upstreamWireApi !== channelModelWireApiFilter) {
        return false;
      }
      if (channelModelVisionFilter === "yes" && !item.supportsVision) {
        return false;
      }
      if (channelModelVisionFilter === "no" && item.supportsVision) {
        return false;
      }
      return matchesTextSearch(
        [item.name, item.aliasModel, item.model, item.contextWindow, item.visionModel],
        channelModelSearch
      );
    });
  }, [
    channelForm.upstreamModels,
    channelModelSearch,
    channelModelStatusFilter,
    channelModelVisionFilter,
    channelModelWireApiFilter,
    isUpstreamRoute
  ]);

  const keySelectorFilterChips: ActiveFilterChip[] = [];
  if (keySelectorSearch.trim()) {
    keySelectorFilterChips.push({
      key: "key-search",
      label: t("检索", "Search"),
      value: keySelectorSearch.trim(),
      tone: "primary",
      onClear: () => setKeySelectorSearch("")
    });
  }
  if (keySelectorStatusFilter !== "all") {
    keySelectorFilterChips.push({
      key: "key-status",
      label: t("状态", "Status"),
      value:
        keySelectorStatusFilter === "enabled"
          ? t("启用", "Enabled")
          : t("停用", "Disabled"),
      onClear: () => setKeySelectorStatusFilter("all")
    });
  }

  const channelSelectorFilterChips: ActiveFilterChip[] = [];
  if (channelSelectorSearch.trim()) {
    channelSelectorFilterChips.push({
      key: "channel-search",
      label: t("检索", "Search"),
      value: channelSelectorSearch.trim(),
      tone: "primary",
      onClear: () => setChannelSelectorSearch("")
    });
  }
  if (channelSelectorStatusFilter !== "all") {
    channelSelectorFilterChips.push({
      key: "channel-status",
      label: t("状态", "Status"),
      value:
        channelSelectorStatusFilter === "enabled"
          ? t("启用", "Enabled")
          : t("停用", "Disabled"),
      onClear: () => setChannelSelectorStatusFilter("all")
    });
  }
  if (channelSelectorProviderFilter !== "all") {
    channelSelectorFilterChips.push({
      key: "channel-provider",
      label: t("供应商", "Provider"),
      value: PROVIDER_META[channelSelectorProviderFilter as ProviderName]?.label ?? channelSelectorProviderFilter,
      onClear: () => setChannelSelectorProviderFilter("all")
    });
  }

  const apiLogActiveFilters: ActiveFilterChip[] = [];
  if (apiLogKeywordFilter.trim()) {
    apiLogActiveFilters.push({
      key: "api-keyword",
      label: t("关键词", "Keyword"),
      value: apiLogKeywordFilter.trim(),
      tone: "primary",
      onClear: () => setApiLogKeywordFilter("")
    });
  }
  if (apiLogRouteFilter && apiLogRouteFilter !== "__all__") {
    apiLogActiveFilters.push({
      key: "api-route",
      label: t("路由", "Route"),
      value: apiLogRouteFilter,
      onClear: () => setApiLogRouteFilter("")
    });
  }
  if (apiLogMethodFilter !== "all") {
    apiLogActiveFilters.push({
      key: "api-method",
      label: t("方法", "Method"),
      value: apiLogMethodFilter,
      onClear: () => setApiLogMethodFilter("all")
    });
  }
  if (apiLogStatusFilter !== "all") {
    apiLogActiveFilters.push({
      key: "api-status",
      label: t("状态", "Status"),
      value: apiLogStatusFilter,
      tone: apiLogStatusFilter === "error" ? "warning" : "default",
      onClear: () => setApiLogStatusFilter("all")
    });
  }
  if (apiLogErrorOnly) {
    apiLogActiveFilters.push({
      key: "api-error-only",
      label: t("仅错误", "Errors Only"),
      value: t("已开启", "On"),
      tone: "warning",
      onClear: () => setApiLogErrorOnly(false)
    });
  }

  const aiCallActiveFilters: ActiveFilterChip[] = [];
  if (aiCallKeyFilter) {
    aiCallActiveFilters.push({
      key: "calls-key",
      label: t("Key", "Key"),
      value: keys.find((item) => item.id === aiCallKeyFilter)?.name ?? `#${aiCallKeyFilter}`,
      onClear: () => setAiCallKeyFilter(null)
    });
  }
  if (hasCustomAiCallDateRange) {
    aiCallActiveFilters.push({
      key: "calls-range",
      label: t("时间", "Time"),
      value: `${aiCallDateRange[0]} ~ ${aiCallDateRange[1]}`,
      tone: "primary",
      onClear: () => setAiCallDateRange([])
    });
  }
  if (aiCallKeywordFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-keyword",
      label: t("关键词", "Keyword"),
      value: aiCallKeywordFilter.trim(),
      tone: "primary",
      onClear: () => setAiCallKeywordFilter("")
    });
  }
  if (aiCallRouteFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-route",
      label: t("路由", "Route"),
      value: aiCallRouteFilter,
      onClear: () => setAiCallRouteFilter("")
    });
  }
  if (aiCallRequestWireFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-request-wire",
      label: t("请求协议", "Request API"),
      value: aiCallRequestWireFilter,
      onClear: () => setAiCallRequestWireFilter("")
    });
  }
  if (aiCallUpstreamWireFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-upstream-wire",
      label: t("上游协议", "Upstream API"),
      value: aiCallUpstreamWireFilter,
      onClear: () => setAiCallUpstreamWireFilter("")
    });
  }
  if (aiCallModelFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-model",
      label: t("真实模型", "Upstream Model"),
      value: aiCallModelFilter,
      onClear: () => setAiCallModelFilter("")
    });
  }
  if (aiCallRequestedModelFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-requested-model",
      label: t("请求模型", "Requested Model"),
      value: aiCallRequestedModelFilter,
      onClear: () => setAiCallRequestedModelFilter("")
    });
  }
  if (aiCallClientModelFilter.trim()) {
    aiCallActiveFilters.push({
      key: "calls-client-model",
      label: t("客户端模型", "Client Model"),
      value: aiCallClientModelFilter,
      onClear: () => setAiCallClientModelFilter("")
    });
  }
  if (aiCallStreamFilter) {
    aiCallActiveFilters.push({
      key: "calls-stream",
      label: t("流式", "Stream"),
      value: aiCallStreamFilter === "stream" ? "stream" : "non-stream",
      onClear: () => setAiCallStreamFilter("")
    });
  }
  if (aiCallTypeFilter) {
    aiCallActiveFilters.push({
      key: "calls-type",
      label: t("调用类型", "Call Type"),
      value: aiCallTypeFilter === "main" ? t("主调用", "Main") : t("辅助视觉", "Vision Fallback"),
      tone: aiCallTypeFilter === "vision_fallback" ? "warning" : "default",
      onClear: () => setAiCallTypeFilter("")
    });
  }

  const usageActiveFilters: ActiveFilterChip[] = [];
  if (hasCustomUsageDateRange) {
    usageActiveFilters.push({
      key: "usage-range",
      label: t("时间", "Time"),
      value: `${usageDateRange[0]} ~ ${usageDateRange[1]}`,
      tone: "primary",
      onClear: () => setUsageDateRange([])
    });
  } else if (usageMinutes !== 180) {
    usageActiveFilters.push({
      key: "usage-window",
      label: t("窗口", "Window"),
      value: `${usageMinutes} ${t("分钟", "min")}`,
      onClear: () => setUsageMinutes(180)
    });
  }
  if (usageKeyFilter) {
    usageActiveFilters.push({
      key: "usage-key",
      label: t("Key", "Key"),
      value: keys.find((item) => item.id === usageKeyFilter)?.name ?? `#${usageKeyFilter}`,
      onClear: () => setUsageKeyFilter(null)
    });
  }
  if (usageModelFilter.trim()) {
    usageActiveFilters.push({
      key: "usage-model",
      label: t("真实模型", "Upstream Model"),
      value: usageModelFilter,
      onClear: () => setUsageModelFilter("")
    });
  }
  if (usageRouteFilter.trim()) {
    usageActiveFilters.push({
      key: "usage-route",
      label: t("路由", "Route"),
      value: usageRouteFilter,
      onClear: () => setUsageRouteFilter("")
    });
  }
  if (usageRequestWireFilter.trim()) {
    usageActiveFilters.push({
      key: "usage-request-wire",
      label: t("请求协议", "Request API"),
      value: usageRequestWireFilter,
      onClear: () => setUsageRequestWireFilter("")
    });
  }
  if (usageUpstreamWireFilter.trim()) {
    usageActiveFilters.push({
      key: "usage-upstream-wire",
      label: t("上游协议", "Upstream API"),
      value: usageUpstreamWireFilter,
      onClear: () => setUsageUpstreamWireFilter("")
    });
  }
  if (usageStreamFilter) {
    usageActiveFilters.push({
      key: "usage-stream",
      label: t("流式", "Stream"),
      value: usageStreamFilter === "stream" ? "stream" : "non-stream",
      onClear: () => setUsageStreamFilter("")
    });
  }
  if (usageBucketMode !== "auto") {
    usageActiveFilters.push({
      key: "usage-bucket",
      label: t("时间桶", "Bucket"),
      value: `${usageBucketMode} ${t("分钟", "min")}`,
      onClear: () => setUsageBucketMode("auto")
    });
  }

  const keyMappingActiveFilters: ActiveFilterChip[] = [];
  if (keyMappingSearch.trim()) {
    keyMappingActiveFilters.push({
      key: "mapping-search",
      label: t("检索", "Search"),
      value: keyMappingSearch.trim(),
      tone: "primary",
      onClear: () => setKeyMappingSearch("")
    });
  }
  if (keyMappingStatusFilter !== "all") {
    keyMappingActiveFilters.push({
      key: "mapping-status",
      label: t("状态", "Status"),
      value: keyMappingStatusFilter === "enabled" ? t("启用", "Enabled") : t("停用", "Disabled"),
      onClear: () => setKeyMappingStatusFilter("all")
    });
  }
  if (keyMappingBindingFilter !== "all") {
    keyMappingActiveFilters.push({
      key: "mapping-binding",
      label: t("绑定方式", "Binding"),
      value:
        keyMappingBindingFilter === "inherit"
          ? t("继承 Key 渠道", "Inherit Key Channel")
          : t("独立绑定渠道", "Bound Channel"),
      onClear: () => setKeyMappingBindingFilter("all")
    });
  }
  if (keyMappingOverflowFilter !== "all") {
    keyMappingActiveFilters.push({
      key: "mapping-overflow",
      label: t("溢出切模", "Overflow"),
      value: keyMappingOverflowFilter === "yes" ? t("已开启", "On") : t("未开启", "Off"),
      onClear: () => setKeyMappingOverflowFilter("all")
    });
  }

  const channelModelActiveFilters: ActiveFilterChip[] = [];
  if (channelModelSearch.trim()) {
    channelModelActiveFilters.push({
      key: "channel-model-search",
      label: t("检索", "Search"),
      value: channelModelSearch.trim(),
      tone: "primary",
      onClear: () => setChannelModelSearch("")
    });
  }
  if (channelModelStatusFilter !== "all") {
    channelModelActiveFilters.push({
      key: "channel-model-status",
      label: t("状态", "Status"),
      value:
        channelModelStatusFilter === "enabled" ? t("启用", "Enabled") : t("停用", "Disabled"),
      onClear: () => setChannelModelStatusFilter("all")
    });
  }
  if (channelModelWireApiFilter !== "all") {
    channelModelActiveFilters.push({
      key: "channel-model-wire",
      label: t("协议", "Wire API"),
      value: channelModelWireApiFilter,
      onClear: () => setChannelModelWireApiFilter("all")
    });
  }
  if (channelModelVisionFilter !== "all") {
    channelModelActiveFilters.push({
      key: "channel-model-vision",
      label: t("视觉", "Vision"),
      value:
        channelModelVisionFilter === "yes"
          ? t("原生支持视觉", "Vision Enabled")
          : t("需视觉兜底", "Needs Fallback"),
      onClear: () => setChannelModelVisionFilter("all")
    });
  }

  const usageTimelinePoints = useMemo(() => {
    if (!isUsageRoute) {
      return [];
    }
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
  }, [isUsageRoute, resolvedUsageBucketMinutes, usageReport]);

  // 自适应趋势图高度：数据少时矮，多时高
  const usageTimelineChartHeight = useMemo(() => {
    const count = usageTimelinePoints.length;
    if (count <= 5) return 180;
    if (count <= 20) return 240;
    if (count <= 60) return 300;
    return 360;
  }, [usageTimelinePoints]);

  const usageTimelineChartData = useMemo<ChartDatum[]>(() => {
    if (!isUsageRoute) {
      return [];
    }
    if (!usageTimelinePoints.length) {
      return [];
    }
    return usageTimelinePoints.map((item) => ({
      label: formatMinuteLabel(item.minute),
      value: pickUsageMetricValue(item, usageMetric)
    }));
  }, [isUsageRoute, usageMetric, usagePrimaryMetricMeta, usageTimelinePoints]);

  const usagePerKeyChartData = useMemo<ChartDatum[]>(() => {
    if (!isUsageRoute) {
      return [];
    }
    if (!usageReport || usageReport.perKey.length === 0) {
      return [];
    }
    const topKeys = [...usageReport.perKey]
      .sort(
        (a, b) =>
          pickUsageMetricValue(b, usageMetric) - pickUsageMetricValue(a, usageMetric)
      )
      .slice(0, 12)
      .reverse();

    return topKeys.map((item) => ({
      label: item.keyName,
      value: pickUsageMetricValue(item, usageMetric)
    }));
  }, [isUsageRoute, usageMetric, usagePrimaryMetricMeta, usageReport]);

  const usagePerModelChartData = useMemo<ChartDatum[]>(() => {
    if (!isUsageRoute) {
      return [];
    }
    if (!usageReport || usageReport.perModel.length === 0) {
      return [];
    }
    const topModels = [...usageReport.perModel]
      .sort(
        (a, b) =>
          pickUsageMetricValue(b, usageMetric) - pickUsageMetricValue(a, usageMetric)
      )
      .slice(0, 10)
      .reverse();

    return topModels.map((item) => ({
      label: `${item.model} · ${item.keyName}`,
      value: pickUsageMetricValue(item, usageMetric)
    }));
  }, [isUsageRoute, usageMetric, usagePrimaryMetricMeta, usageReport]);

  const channelModelOptions = useMemo(
    () => {
      if (!isUpstreamRoute) {
        return [];
      }
      return channelForm.upstreamModels.map((item) => ({
        label: item.aliasModel
          ? `${item.name} · ${item.aliasModel} -> ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`
          : `${item.name} · ${item.model}${item.contextWindow ? ` · ctx=${formatNumber(item.contextWindow)}` : ""}`,
        value: item.model
      }));
    },
    [channelForm.upstreamModels, isUpstreamRoute]
  );

  const keyOverflowModelOptions = useMemo(() => {
    if (!shouldBuildKeyViews) {
      return [];
    }
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
  }, [channels, keyForm.contextOverflowModel, keyForm.upstreamChannelId, shouldBuildKeyViews, t]);

  const mappingOverflowModelOptions = useMemo(() => {
    if (!shouldBuildKeyViews) {
      return [];
    }
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
  }, [channels, shouldBuildKeyViews, t]);

  const visionChannelOptions = useMemo(
    () => {
      if (!isUpstreamRoute) {
        return [];
      }
      return [
        { label: "当前渠道", value: "__self__" },
        ...channels
          .filter((item) => item.id !== selectedChannelId)
          .map((item) => ({
            label: `${item.name} · ${PROVIDER_META[item.provider].label}`,
            value: String(item.id)
          }))
      ];
    },
    [channels, isUpstreamRoute, selectedChannelId]
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

  function resetApiLogFilters() {
    setApiLogKeywordFilter("");
    setApiLogRouteFilter("");
    setApiLogMethodFilter("all");
    setApiLogStatusFilter("all");
    setApiLogErrorOnly(false);
  }

  function resetAiCallFilters() {
    setAiCallSelectedPresetId("all");
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

  function buildAiCallFilterPresetValue(): AiCallFilterPresetValue {
    return {
      limit: aiCallLogLimit,
      keyId: aiCallKeyFilter,
      dateRange: aiCallDateRange.slice(0, 2),
      keyword: aiCallKeywordFilter,
      route: aiCallRouteFilter,
      requestWireApi: aiCallRequestWireFilter,
      upstreamWireApi: aiCallUpstreamWireFilter,
      model: aiCallModelFilter,
      requestedModel: aiCallRequestedModelFilter,
      clientModel: aiCallClientModelFilter,
      stream: aiCallStreamFilter,
      callType: aiCallTypeFilter
    };
  }

  function applyAiCallPresetValue(value: AiCallFilterPresetValue) {
    setAiCallLogLimit(value.limit);
    setAiCallKeyFilter(value.keyId);
    setAiCallDateRange(value.dateRange.slice(0, 2));
    setAiCallKeywordFilter(value.keyword);
    setAiCallRouteFilter(value.route);
    setAiCallRequestWireFilter(value.requestWireApi);
    setAiCallUpstreamWireFilter(value.upstreamWireApi);
    setAiCallModelFilter(value.model);
    setAiCallRequestedModelFilter(value.requestedModel);
    setAiCallClientModelFilter(value.clientModel);
    setAiCallStreamFilter(value.stream);
    setAiCallTypeFilter(value.callType);
  }

  function saveAiCallPreset() {
    const nextName =
      aiCallPresetName.trim() ||
      `${t("调用视图", "Call View")} ${new Date().toLocaleTimeString(locale === "en-US" ? "en-US" : "zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      })}`;
    const nextPresets = upsertFilterPreset(
      aiCallSavedPresets,
      nextName,
      buildAiCallFilterPresetValue()
    );
    setAiCallSavedPresets(nextPresets);
    const selectedPreset =
      nextPresets.find((item) => item.name.trim().toLowerCase() === nextName.trim().toLowerCase()) ??
      null;
    setAiCallSelectedPresetId(selectedPreset?.id ?? "all");
    setAiCallPresetName(nextName);
    notifySuccess(t("调用日志筛选视图已保存。", "AI call filter view saved."));
  }

  function applyAiCallPresetById(id: string) {
    setAiCallSelectedPresetId(id);
    if (id === "all") {
      return;
    }
    const preset = aiCallSavedPresets.find((item) => item.id === id);
    if (!preset) {
      return;
    }
    applyAiCallPresetValue(preset.value);
    setAiCallPresetName(preset.name);
    notifySuccess(t("已应用调用日志筛选视图。", "AI call filter view applied."));
  }

  function deleteAiCallPreset() {
    if (aiCallSelectedPresetId === "all") {
      return;
    }
    const nextPresets = aiCallSavedPresets.filter((item) => item.id !== aiCallSelectedPresetId);
    setAiCallSavedPresets(nextPresets);
    setAiCallSelectedPresetId("all");
    notifySuccess(t("已删除调用日志筛选视图。", "AI call filter view deleted."));
  }

  function resetUsageFilters() {
    setUsageSelectedPresetId("all");
    setUsageMinutes(180);
    setUsageDateRange([]);
    setUsageMetric("totalTokens");
    setUsageBucketMode("auto");
    setUsageKeyFilter(null);
    setUsageModelFilter("");
    setUsageRouteFilter("");
    setUsageRequestWireFilter("");
    setUsageUpstreamWireFilter("");
    setUsageStreamFilter("");
    setUsageTimelineLimit(600);
  }

  function buildUsageFilterPresetValue(): UsageFilterPresetValue {
    return {
      minutes: usageMinutes,
      dateRange: usageDateRange.slice(0, 2),
      metric: usageMetric,
      bucketMode: usageBucketMode,
      keyId: usageKeyFilter,
      model: usageModelFilter,
      route: usageRouteFilter,
      requestWireApi: usageRequestWireFilter,
      upstreamWireApi: usageUpstreamWireFilter,
      stream: usageStreamFilter,
      timelineLimit: usageTimelineLimit
    };
  }

  function applyUsagePresetValue(value: UsageFilterPresetValue) {
    setUsageMinutes(value.minutes);
    setUsageDateRange(value.dateRange.slice(0, 2));
    setUsageMetric(value.metric);
    setUsageBucketMode(value.bucketMode);
    setUsageKeyFilter(value.keyId);
    setUsageModelFilter(value.model);
    setUsageRouteFilter(value.route);
    setUsageRequestWireFilter(value.requestWireApi);
    setUsageUpstreamWireFilter(value.upstreamWireApi);
    setUsageStreamFilter(value.stream);
    setUsageTimelineLimit(value.timelineLimit);
  }

  function saveUsagePreset() {
    const nextName =
      usagePresetName.trim() ||
      `${t("用量视图", "Usage View")} ${new Date().toLocaleTimeString(locale === "en-US" ? "en-US" : "zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      })}`;
    const nextPresets = upsertFilterPreset(
      usageSavedPresets,
      nextName,
      buildUsageFilterPresetValue()
    );
    setUsageSavedPresets(nextPresets);
    const selectedPreset =
      nextPresets.find((item) => item.name.trim().toLowerCase() === nextName.trim().toLowerCase()) ??
      null;
    setUsageSelectedPresetId(selectedPreset?.id ?? "all");
    setUsagePresetName(nextName);
    notifySuccess(t("用量筛选视图已保存。", "Usage filter view saved."));
  }

  function applyUsagePresetById(id: string) {
    setUsageSelectedPresetId(id);
    if (id === "all") {
      return;
    }
    const preset = usageSavedPresets.find((item) => item.id === id);
    if (!preset) {
      return;
    }
    applyUsagePresetValue(preset.value);
    setUsagePresetName(preset.name);
    notifySuccess(t("已应用用量筛选视图。", "Usage filter view applied."));
  }

  function deleteUsagePreset() {
    if (usageSelectedPresetId === "all") {
      return;
    }
    const nextPresets = usageSavedPresets.filter((item) => item.id !== usageSelectedPresetId);
    setUsageSavedPresets(nextPresets);
    setUsageSelectedPresetId("all");
    notifySuccess(t("已删除用量筛选视图。", "Usage filter view deleted."));
  }

  function resetKeyMappingFilters() {
    setKeyMappingSearch("");
    setKeyMappingStatusFilter("all");
    setKeyMappingBindingFilter("all");
    setKeyMappingOverflowFilter("all");
  }

  function resetChannelModelFilters() {
    setChannelModelSearch("");
    setChannelModelStatusFilter("all");
    setChannelModelWireApiFilter("all");
    setChannelModelVisionFilter("all");
  }

  function resetPromptRuleFilters() {
    setCompatPromptRuleSearch("");
    setCompatPromptRuleStatusFilter("all");
    setCompatPromptRuleProviderFilter("all");
    setCompatPromptRuleIssueFilter("all");
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
    writeFilterPresets("codex-gateway-hub:ai-call-presets", aiCallSavedPresets);
  }, [aiCallSavedPresets]);

  useEffect(() => {
    writeFilterPresets("codex-gateway-hub:usage-presets", usageSavedPresets);
  }, [usageSavedPresets]);

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
    if (routeModule !== "access" || !isKeyDirty) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isKeyDirty, routeModule]);

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
    usageModelFilter,
    usageRouteFilter,
    usageRequestWireFilter,
    usageUpstreamWireFilter,
    usageStreamFilter,
    usageDateFrom,
    usageDateTo
  ]);

  useEffect(() => {
    return () => {
      if (promptLabPollTimerRef.current !== null) {
        window.clearInterval(promptLabPollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (routeModule !== "prompt" && promptLabPollTimerRef.current !== null) {
      window.clearInterval(promptLabPollTimerRef.current);
      promptLabPollTimerRef.current = null;
    }
  }, [routeModule]);

  function notifySuccess(content: string) {
    MessagePlugin.success(content);
  }

  function notifyError(content: string) {
    MessagePlugin.error(humanizeConsoleErrorMessage(content));
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
    setCompatPromptExemptionsInput(
      formatCompatPromptExemptionsInput(config.modelPromptExemptions ?? [])
    );
    setCompatPromptHintInput(config.chineseReplyHint);
    setCompatPromptRulesDraft(normalizedRules);
    setCompatPromptRuleSearch("");
    setCompatPromptRulesJsonInput(formatCompatPromptRulesJson(normalizedRules));
    setShowPromptLabRegressionCta(false);
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

  function buildCompatPromptRulesExportJson(format: "array" | "wrapped" = "wrapped") {
    if (format === "array") {
      return `${formatCompatPromptRulesJson(normalizeCompatPromptRules(compatPromptRulesDraft))}\n`;
    }
    return `${quickExportCompatPromptRules(normalizeCompatPromptRules(compatPromptRulesDraft))}\n`;
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
    if (mergedRules.length > MAX_COMPAT_PROMPT_RULES) {
      notifyError(
        t(
          `模型规则最多 ${MAX_COMPAT_PROMPT_RULES} 条。`,
          `Model prompt rules are limited to ${MAX_COMPAT_PROMPT_RULES}.`
        )
      );
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

  function handleOpenCompatPromptRulesImportDialog() {
    setCompatPromptRulesQuickImportJson("");
    setCompatPromptRulesQuickImportSource("");
    setCompatPromptRulesImportDialogVisible(true);
  }

  function handleOpenCompatPromptRulesExportDialog() {
    setCompatPromptRulesExportDialogVisible(true);
  }

  function handleCompatPromptRulesQuickImportJsonChange(value: string) {
    setCompatPromptRulesQuickImportJson(value);
    setCompatPromptRulesQuickImportSource(
      value.trim() ? t("当前来源：手动粘贴", "Current source: Manual Paste") : ""
    );
  }

  function clearBulkJsonImportDraft(target: BulkJsonImportTarget) {
    if (target === "compatPromptRules") {
      setCompatPromptRulesQuickImportJson("");
      setCompatPromptRulesQuickImportSource("");
      return;
    }
    if (target === "upstreamModels") {
      setQuickImportJson("");
      setQuickImportSource("");
      return;
    }
    setQuickImportKeyMappingJson("");
    setQuickImportKeyMappingSource("");
  }

  function applyBulkJsonImportDraft(
    target: BulkJsonImportTarget,
    text: string,
    sourceLabel: string
  ) {
    if (target === "compatPromptRules") {
      setCompatPromptRulesQuickImportJson(text);
      setCompatPromptRulesQuickImportSource(sourceLabel);
      setCompatPromptRulesImportDialogVisible(true);
      return;
    }
    if (target === "upstreamModels") {
      setQuickImportJson(text);
      setQuickImportSource(sourceLabel);
      setQuickImportDialogVisible(true);
      return;
    }
    setQuickImportKeyMappingJson(text);
    setQuickImportKeyMappingSource(sourceLabel);
    setQuickImportKeyMappingDialogVisible(true);
  }

  function openBulkJsonFileImporter(target: BulkJsonImportTarget) {
    const input = bulkJsonFileInputRef.current;
    if (!input) {
      notifyError(t("导入控件不可用。", "Import control unavailable."));
      return;
    }
    setBulkJsonFileImportTarget(target);
    input.value = "";
    input.click();
  }

  async function loadBulkJsonFromClipboard(target: BulkJsonImportTarget) {
    if (!navigator.clipboard?.readText) {
      notifyError(
        t(
          "当前浏览器不支持读取剪贴板。",
          "Clipboard read is not supported in this browser."
        )
      );
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        notifyError(t("剪贴板内容为空。", "Clipboard content is empty."));
        return;
      }
      applyBulkJsonImportDraft(target, text, t("当前来源：剪贴板", "Current source: Clipboard"));
      notifySuccess(
        t("已从剪贴板载入 JSON。", "Loaded JSON from clipboard.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t(
              "读取剪贴板失败，请检查浏览器权限。",
              "Failed to read clipboard. Please check browser permissions."
            )
      );
    }
  }

  async function loadCompatPromptRulesFromClipboardToDraft() {
    await loadBulkJsonFromClipboard("compatPromptRules");
  }

  async function copyCompatPromptRulesToClipboard(format: "array" | "wrapped" = "wrapped") {
    await copyTextToClipboard(
      buildCompatPromptRulesExportJson(format),
      t("模型规则 JSON 已复制到剪贴板。", "Model rules JSON copied to clipboard.")
    );
  }

  function openCompatPromptRulesFileImporter() {
    openBulkJsonFileImporter("compatPromptRules");
  }

  async function handleBulkJsonFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const target = bulkJsonFileImportTarget;
      if (!target) {
        notifyError(t("导入目标不可用。", "Import target is unavailable."));
        return;
      }
      applyBulkJsonImportDraft(
        target,
        text,
        t(`当前来源：${file.name}`, `Current source: ${file.name}`)
      );
      notifySuccess(
        t(
          `已载入 ${file.name}，确认后即可导入。`,
          `Loaded ${file.name}. Review and import when ready.`
        )
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("读取导入文件失败。", "Failed to read import file.")
      );
    } finally {
      setBulkJsonFileImportTarget(null);
    }
  }

  function applyCompatPromptRulesQuickImport(mode: "append" | "replace") {
    try {
      const result = quickImportCompatPromptRules(compatPromptRulesQuickImportJson);
      if (!result.ok) {
        throw new Error(result.error);
      }
      const nextRules = normalizeCompatPromptRules(result.rules);
      applyImportedCompatPromptRules(
        nextRules,
        mode,
        compatPromptRulesQuickImportSource || t("当前来源：手动输入 JSON", "Current source: Manual JSON")
      );
      setCompatPromptRulesImportDialogVisible(false);
      setCompatPromptRulesQuickImportJson("");
      setCompatPromptRulesQuickImportSource("");
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
    const modelPromptExemptions = parseCompatPromptExemptionsInput(compatPromptExemptionsInput);
    const chineseReplyHint = compatPromptHintInput.trim();
    const modelPromptRules = normalizeCompatPromptRules(compatPromptRulesDraft);
    const ruleCheckIssues = inspectCompatPromptRules(modelPromptRules);

    if (!agentsMdKeywords.length) {
      notifyError(t("至少保留一个 AGENTS 关键词。", "Keep at least one AGENTS keyword."));
      return;
    }
    if (!chineseReplyHint) {
      notifyError(t("默认提示词不能为空。", "Default hint cannot be empty."));
      return;
    }
    if (modelPromptExemptions.length > 128) {
      notifyError(
        t(
          "提示词豁免名单最多 128 条。",
          "Prompt exemption list is limited to 128 entries."
        )
      );
      return;
    }
    if (modelPromptRules.length > MAX_COMPAT_PROMPT_RULES) {
      notifyError(
        t(
          `模型规则最多 ${MAX_COMPAT_PROMPT_RULES} 条。`,
          `Model prompt rules are limited to ${MAX_COMPAT_PROMPT_RULES}.`
        )
      );
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
    const blockingIssues = ruleCheckIssues.filter((item) => item.level === "error");
    if (blockingIssues.length > 0) {
      notifyError(
        t(
          `保存前请先修复规则冲突：${blockingIssues[0].message}`,
          `Please resolve rule conflicts before saving: ${blockingIssues[0].message}`
        )
      );
      return;
    }
    const warningIssues = ruleCheckIssues.filter((item) => item.level === "warn");
    if (warningIssues.length > 0) {
      notifyInfo(
        t(
          `保存提示：发现 ${warningIssues.length} 条规则覆盖风险，请在 Prompt Lab 做回归验证。`,
          `Save notice: ${warningIssues.length} broad-match risks found. Please run Prompt Lab regression.`
        )
      );
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
            modelPromptExemptions,
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
      setShowPromptLabRegressionCta(true);
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

  async function loadKeys(preferredSelectedId?: number | null) {
    const response = await fetch("/api/keys", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`加载本地 Key 失败 (${response.status})`);
    }
    const data = (await response.json()) as KeysResponse;
    setKeys(data.items);
    setWireApi(data.wireApi);

    if (data.items.length === 0) {
      const emptyDraft = createEmptyKeyFormState(generateLocalKey());
      setSelectedKeyId(null);
      setKeyForm(emptyDraft);
      setSavedKeyForm(cloneKeyFormState(emptyDraft));
      return;
    }

    const nextSelectedId =
      typeof preferredSelectedId === "number" &&
      data.items.some((item) => item.id === preferredSelectedId)
        ? preferredSelectedId
        : selectedKeyId !== null && data.items.some((item) => item.id === selectedKeyId)
          ? selectedKeyId
          : data.items[0].id;
    const key = data.items.find((item) => item.id === nextSelectedId) ?? data.items[0];
    const nextForm = toKeyForm(key);
    setSelectedKeyId(key.id);
    setKeyForm(nextForm);
    setSavedKeyForm(cloneKeyFormState(nextForm));
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
      if (usageModelFilter.trim()) {
        params.set("model", usageModelFilter.trim());
      }
      if (usageRouteFilter.trim()) {
        params.set("route", usageRouteFilter.trim());
      }
      if (usageRequestWireFilter.trim()) {
        params.set("requestWireApi", usageRequestWireFilter.trim());
      }
      if (usageUpstreamWireFilter.trim()) {
        params.set("upstreamWireApi", usageUpstreamWireFilter.trim());
      }
      if (usageStreamFilter === "stream") {
        params.set("stream", "true");
      } else if (usageStreamFilter === "non_stream") {
        params.set("stream", "false");
      }
      const response = await fetch(`/api/usage?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `加载用量报表失败 (${response.status})`);
      }
      const body = (await response.json()) as UsageReport;
      setUsageReport(body);
      setUsageFilterOptions(body.filterOptions ?? EMPTY_USAGE_FILTER_OPTIONS);
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
              timeline: [],
              filterOptions: EMPTY_USAGE_FILTER_OPTIONS
            }
          : prev
      );
      setUsageFilterOptions(EMPTY_USAGE_FILTER_OPTIONS);
      notifySuccess("用量记录已清空。");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "清空用量报表失败");
    } finally {
      setLoadingUsage(false);
    }
  }

  function confirmDiscardKeyDraft(message: string) {
    if (!isKeyDirty) {
      return true;
    }
    return window.confirm(message);
  }

  function restoreKeyDraft() {
    setKeyForm(cloneKeyFormState(savedKeyForm));
    notifyInfo(
      selectedKey
        ? t("已恢复到最近一次保存的 Key 内容。", "Restored to the latest saved key state.")
        : t("已恢复到当前新建草稿的初始状态。", "Restored to the initial new-key draft.")
    );
  }

  async function refreshKeyWorkspace() {
    if (
      routeModule === "access" &&
      !confirmDiscardKeyDraft(
        t(
          "刷新会覆盖当前未保存的 Key 草稿，确认继续吗？",
          "Refreshing now will overwrite the current unsaved key draft. Continue?"
        )
      )
    ) {
      return;
    }
    await bootstrap();
  }

  function createNewKeyDraft() {
    if (
      !confirmDiscardKeyDraft(
        t(
          "当前 Key 草稿还有未保存修改。继续新建会丢失这些内容，确认继续吗？",
          "You have unsaved key changes. Creating a new key now will discard them. Continue?"
        )
      )
    ) {
      return;
    }
    const emptyDraft = createEmptyKeyFormState(generateLocalKey());
    setSelectedKeyId(null);
    setKeyForm(emptyDraft);
    setSavedKeyForm(cloneKeyFormState(emptyDraft));
  }

  function openExistingKeyById(id: number) {
    if (selectedKeyId === id) {
      return;
    }
    if (
      !confirmDiscardKeyDraft(
        t(
          "当前 Key 草稿还有未保存修改。切换 Key 会丢失这些内容，确认继续吗？",
          "You have unsaved key changes. Switching keys now will discard them. Continue?"
        )
      )
    ) {
      return;
    }
    const key = keys.find((item) => item.id === id);
    if (!key) {
      return;
    }
    const nextForm = toKeyForm(key);
    setSelectedKeyId(key.id);
    setKeyForm(nextForm);
    setSavedKeyForm(cloneKeyFormState(nextForm));
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
    const creatingNewKey = isNewKey;
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
      const dailyRequestLimit = parseOptionalPositiveIntegerInput(
        keyForm.dailyRequestLimit,
        "每日请求上限"
      );
      const dailyTokenLimit = parseOptionalPositiveIntegerInput(
        keyForm.dailyTokenLimit,
        "每日 Token 上限"
      );
      for (let index = 0; index < keyForm.modelMappings.length; index += 1) {
        const m = keyForm.modelMappings[index];
        if (!m.clientModel.trim()) {
          throw new Error(
            `映射 #${index + 1} 缺少客户端模型名。请填写后再保存，或删除这条映射。`
          );
        }
        if (!m.targetModel.trim()) {
          throw new Error(
            `映射 #${index + 1} 缺少内部模型名。请填写后再保存，或删除这条映射。`
          );
        }
        if (m.dynamicModelSwitch && !(m.contextOverflowModel?.trim())) {
          throw new Error(`映射「${m.clientModel}」启用了动态切模但未设置溢出模型。`);
        }
      }
      const seenClientModels = new Map<string, number>();
      keyForm.modelMappings.forEach((item, index) => {
        const normalizedClientModel = item.clientModel.trim().toLowerCase();
        const previousIndex = seenClientModels.get(normalizedClientModel);
        if (previousIndex !== undefined) {
          throw new Error(
            `映射 #${previousIndex + 1} 与 #${index + 1} 使用了重复的客户端模型名「${item.clientModel.trim()}」。`
          );
        }
        seenClientModels.set(normalizedClientModel, index);
      });
      const modelMappings = keyForm.modelMappings.map((item) => ({
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
        }));

      const payload = {
        name: keyForm.name.trim(),
        localKey: keyForm.localKey.trim(),
        upstreamChannelId: keyForm.upstreamChannelId,
        modelMappings,
        dynamicModelSwitch: keyForm.dynamicModelSwitch,
        contextSwitchThreshold: Number(keyForm.contextSwitchThreshold),
        contextOverflowModel: overflowModel || undefined,
        dailyRequestLimit,
        dailyTokenLimit,
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

      const body = (await response.json().catch(() => ({}))) as GatewayKey & { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `保存失败 (${response.status})`);
      }

      await loadKeys(body.id);
      notifySuccess(
        creatingNewKey
          ? t("本地 Key 创建成功，已停留在刚创建的结果上。", "Local key created and kept selected.")
          : t("本地 Key 已更新。", "Local key updated.")
      );
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

  async function copyTextToClipboard(text: string, successMessage?: string) {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(successMessage ?? t("内容已复制。", "Copied."));
    } catch {
      notifyError(t("复制失败，请检查浏览器权限。", "Copy failed. Please check browser permissions."));
    }
  }

  function downloadTextSnippet(fileName: string, content: string, successMessage: string) {
    saveTextAsFile(fileName, content);
    notifySuccess(successMessage);
  }

  function downloadCompatPromptRulesJsonFile(format: "array" | "wrapped" = "wrapped") {
    const fileName =
      format === "array" ? "model-prompt-rules.array.json" : "model-prompt-rules.json";
    downloadTextSnippet(
      fileName,
      buildCompatPromptRulesExportJson(format),
      t(
        "模型规则 JSON 已导出到文件。",
        "Model rules JSON has been exported to a file."
      )
    );
  }

  function downloadUpstreamModelsJsonFile() {
    downloadTextSnippet(
      "model-pool.json",
      upstreamModelsExportPreviewJson,
      t("模型池 JSON 已导出到文件。", "Model pool JSON has been exported to a file.")
    );
  }

  function downloadKeyMappingsJsonFile() {
    downloadTextSnippet(
      "model-mappings.json",
      keyMappingsExportPreviewJson,
      t("模型映射 JSON 已导出到文件。", "Model mappings JSON has been exported to a file.")
    );
  }

  function downloadNativeCodexBundleFile(
    fileKey: keyof CodexExportBundle["files"],
    fallbackFileName: string,
    successMessage: string,
    failureMessage: string
  ) {
    const file = nativeCodexExportBundle?.files[fileKey];
    if (!file) {
      notifyError(failureMessage);
      return;
    }
    downloadTextSnippet(
      resolveDownloadFileName(file.targetPath, fallbackFileName),
      file.content,
      successMessage
    );
  }

  function downloadApiDocExample(
    exampleKey: "chatCompletions" | "responses" | "anthropicMessages"
  ) {
    const descriptor = {
      chatCompletions: {
        fileName: "chat-completions.sh",
        content: apiDocExamples.chatCompletions,
        success: t("chat/completions 示例已下载。", "chat/completions example downloaded.")
      },
      responses: {
        fileName: "responses.sh",
        content: apiDocExamples.responses,
        success: t("responses 示例已下载。", "responses example downloaded.")
      },
      anthropicMessages: {
        fileName: "messages.sh",
        content: apiDocExamples.anthropicMessages,
        success: t("messages 示例已下载。", "messages example downloaded.")
      }
    }[exampleKey];
    downloadTextSnippet(descriptor.fileName, descriptor.content, descriptor.success);
  }

  function downloadRuntimeApiExample(
    exampleKey:
      | "queryStatus"
      | "switchModel"
      | "clearOverride"
      | "toggleEnabledById"
      | "payloadSchema"
  ) {
    const descriptor = {
      queryStatus: {
        fileName: "runtime-query.sh",
        content: runtimeApiExamples.queryStatus,
        success: t("运行时查询命令已下载。", "Runtime query command downloaded.")
      },
      switchModel: {
        fileName: "runtime-switch.sh",
        content: runtimeApiExamples.switchModel,
        success: t("运行时切换命令已下载。", "Runtime switch command downloaded.")
      },
      clearOverride: {
        fileName: "runtime-clear-override.sh",
        content: runtimeApiExamples.clearOverride,
        success: t("清空覆盖命令已下载。", "Clear-override command downloaded.")
      },
      toggleEnabledById: {
        fileName: "runtime-toggle-key.sh",
        content: runtimeApiExamples.toggleEnabledById,
        success: t("Key 启停命令已下载。", "Key toggle command downloaded.")
      },
      payloadSchema: {
        fileName: "runtime-payload.json",
        content: runtimeApiExamples.payloadSchema,
        success: t("运行时 payload 已下载。", "Runtime payload downloaded.")
      }
    }[exampleKey];
    downloadTextSnippet(descriptor.fileName, descriptor.content, descriptor.success);
  }

  function clearPromptLabPollingTimer() {
    if (promptLabPollTimerRef.current !== null) {
      window.clearInterval(promptLabPollTimerRef.current);
      promptLabPollTimerRef.current = null;
    }
  }

  function collectPromptLabRegressionCandidatesFromRules() {
    const output: string[] = [];
    const seen = new Set<string>();
    for (const rule of compatPromptRulesDraft) {
      if (!rule.enabled) {
        continue;
      }
      const tokens = rule.upstreamModelPattern
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      for (const token of tokens) {
        const lower = token.toLowerCase();
        if (
          lower === "*" ||
          lower === "all" ||
          lower === "any" ||
          token.includes("*") ||
          token.includes("?")
        ) {
          continue;
        }
        if (seen.has(lower)) {
          continue;
        }
        seen.add(lower);
        output.push(token);
        if (output.length >= 12) {
          return output;
        }
      }
    }
    return output;
  }

  async function fetchPromptLabRunSummary(runId: string, silent = false) {
    if (!runId.trim()) {
      return null;
    }
    const response = await fetch(`/api/prompt-lab/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store"
    });
    const body = (await response.json().catch(() => ({}))) as PromptLabRunSummaryResponse & {
      error?: string;
    };
    if (!response.ok) {
      if (!silent) {
        throw new Error(body.error ?? `Prompt Lab 查询失败 (${response.status})`);
      }
      return null;
    }
    setPromptLabRunSummary(body);
    if (body.status === "succeeded") {
      clearPromptLabPollingTimer();
      if (promptLabReport?.runId !== body.id) {
        void fetchPromptLabReport(body.id, true);
      }
    } else if (body.status === "failed") {
      clearPromptLabPollingTimer();
    }
    return body;
  }

  async function fetchPromptLabReport(runId: string, silent = false) {
    if (!runId.trim()) {
      return null;
    }
    if (!silent) {
      setPromptLabFetchingReport(true);
    }
    try {
      const response = await fetch(`/api/prompt-lab/runs/${encodeURIComponent(runId)}/report`, {
        cache: "no-store"
      });
      const body = (await response.json().catch(() => ({}))) as PromptLabReportResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Prompt Lab 报告拉取失败 (${response.status})`);
      }
      setPromptLabReport(body);
      return body;
    } catch (error) {
      if (!silent) {
        throw error;
      }
      return null;
    } finally {
      if (!silent) {
        setPromptLabFetchingReport(false);
      }
    }
  }

  function startPromptLabPolling(runId: string) {
    clearPromptLabPollingTimer();
    promptLabPollTimerRef.current = window.setInterval(() => {
      void fetchPromptLabRunSummary(runId, true);
    }, 2000);
  }

  async function runPromptLab() {
    setPromptLabSubmitting(true);
    setPromptLabLastError("");
    setShowPromptLabRegressionCta(false);
    try {
      const baselineModel = promptLabBaselineModel.trim() || "gpt-5.4";
      const candidateModels = parsePromptLabModelListInput(promptLabCandidateModelsInput);
      const payload: Record<string, unknown> = {
        mode: promptLabMode,
        baselineModel,
        candidateModels,
        suiteId: promptLabSuiteId.trim() || "tool-accuracy-v1",
        sandbox: promptLabSandbox
      };

      if (promptLabMode === "import") {
        if (!promptLabImportJsonInput.trim()) {
          throw new Error("请先粘贴 report.json 内容。");
        }
        try {
          payload.reportJson = JSON.parse(promptLabImportJsonInput);
        } catch {
          throw new Error("report.json 解析失败，请检查 JSON 格式。");
        }
      }

      const response = await fetch("/api/prompt-lab/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => ({}))) as {
        runId?: string;
        status?: PromptLabRun["status"];
        error?: string;
      };
      if (!response.ok || !body.runId) {
        throw new Error(body.error ?? `Prompt Lab 启动失败 (${response.status})`);
      }

      setPromptLabRunId(body.runId);
      setPromptLabReport(null);
      await fetchPromptLabRunSummary(body.runId);
      if (body.status === "queued" || body.status === "running") {
        startPromptLabPolling(body.runId);
        notifyInfo(t("Prompt Lab 已启动，正在执行。", "Prompt Lab started and is running."));
      } else {
        await fetchPromptLabReport(body.runId, true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Prompt Lab 运行失败";
      setPromptLabLastError(message);
      notifyError(message);
    } finally {
      setPromptLabSubmitting(false);
    }
  }

  function openPromptLabImportFilePicker() {
    const input = promptLabImportFileInputRef.current;
    if (!input) {
      notifyError("导入控件不可用。");
      return;
    }
    input.value = "";
    input.click();
  }

  async function handlePromptLabImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      JSON.parse(text);
      setPromptLabImportJsonInput(text);
      notifySuccess(
        t(
          `已加载报告文件：${file.name}`,
          `Loaded report file: ${file.name}`
        )
      );
    } catch {
      notifyError(t("报告文件不是合法 JSON。", "Report file is not valid JSON."));
    }
  }

  async function previewCompatPromptRuleMatch() {
    setRulePreviewLoading(true);
    try {
      const response = await fetch("/api/prompt-lab/rule-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: rulePreviewProviderInput,
          upstreamModel: rulePreviewUpstreamModelInput,
          clientModel: rulePreviewClientModelInput
        })
      });
      const body = (await response.json().catch(() => ({}))) as RulePreviewResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `规则预览失败 (${response.status})`);
      }
      setRulePreviewResult(body);
      notifyInfo(
        body.hintSource === "rule"
          ? t("已命中模型规则。", "Matched model-specific rule.")
          : body.hintSource === "exempt"
            ? t("已命中豁免名单，本次不会注入提示词。", "Matched exemption list. No prompt will be injected.")
            : t("未命中规则，回落默认提示词。", "No rule matched. Fallback to default hint.")
      );
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "规则预览失败");
    } finally {
      setRulePreviewLoading(false);
    }
  }

  function applyFailureCaseAsCompatRule(item: PromptLabFailureCase) {
    const nextHint = buildPromptLabHintFromFailure(item);
    addCompatPromptRule({
      upstreamModelPattern: item.model,
      hint: nextHint
    });
    setPromptConfigTab("rules");
    notifySuccess(
      t(
        `已根据 ${item.model} 失败样例创建规则草稿。`,
        `Rule draft created from ${item.model} failure case.`
      )
    );
  }

  async function runPromptLabRegressionFromCurrentRules() {
    const candidates = collectPromptLabRegressionCandidatesFromRules();
    if (!candidates.length) {
      notifyError(t("当前没有可回归测试的具体模型规则。", "No specific model rules to run regression."));
      return;
    }
    setPromptLabCandidateModelsInput(candidates.join("\n"));
    setPromptConfigTab("lab");
    setPromptLabMode("cli");
    await runPromptLab();
  }

  function parsePromptOptimizerIssuesInput(value: string) {
    const output: string[] = [];
    const seen = new Set<string>();
    for (const item of value.split(/[\r\n,]+/)) {
      const normalized = item.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
      if (output.length >= 32) {
        break;
      }
    }
    return output;
  }

  async function runPromptOptimizer() {
    setPromptOptimizerRunning(true);
    setPromptOptimizerError("");
    try {
      const observedIssues = parsePromptOptimizerIssuesInput(promptOptimizerIssuesInput);
      const basePrompt = promptOptimizerBasePromptInput.trim() || compatPromptHintInput.trim();

      const payload: Record<string, unknown> = {
        provider: promptOptimizerProviderInput.trim(),
        upstreamModel: promptOptimizerUpstreamModelInput.trim(),
        clientModel: promptOptimizerClientModelInput.trim(),
        basePrompt,
        focus: promptOptimizerFocus,
        preserveOriginal: promptOptimizerPreserveOriginal,
        observedIssues
      };
      if (promptLabReport?.report?.failures?.length) {
        payload.reportJson = {
          report: {
            failures: promptLabReport.report.failures
          }
        };
      }

      const response = await fetch("/api/prompt-lab/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => ({}))) as PromptOptimizerResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `提示词优化失败 (${response.status})`);
      }
      setPromptOptimizerResult(body);
      notifySuccess(t("提示词优化完成。", "Prompt optimization completed."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "提示词优化失败";
      setPromptOptimizerError(message);
      notifyError(message);
    } finally {
      setPromptOptimizerRunning(false);
    }
  }

  function applyPromptOptimizerToDefaultHint() {
    if (!promptOptimizerResult) {
      notifyError(t("请先执行一次提示词优化。", "Run prompt optimization first."));
      return;
    }
    setCompatPromptHintInput(promptOptimizerResult.optimizedPrompt);
    notifySuccess(t("已应用到默认提示词草稿。", "Applied to default prompt draft."));
  }

  function applyPromptOptimizerAsModelRule() {
    if (!promptOptimizerResult) {
      notifyError(t("请先执行一次提示词优化。", "Run prompt optimization first."));
      return;
    }
    const suggestedRule = promptOptimizerResult.suggestedRule;
    addCompatPromptRule({
      id: suggestedRule.id,
      provider: suggestedRule.provider,
      upstreamModelPattern: suggestedRule.upstreamModelPattern,
      hint: suggestedRule.hint
    });
    notifySuccess(t("已创建模型规则草稿。", "Model rule draft created."));
  }

  async function copyPromptOptimizerResult() {
    if (!promptOptimizerResult) {
      notifyError(t("请先执行一次提示词优化。", "Run prompt optimization first."));
      return;
    }
    await copyTextToClipboard(
      promptOptimizerResult.optimizedPrompt,
      t("优化后的提示词已复制。", "Optimized prompt copied.")
    );
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
    setQuickExportDialogVisible(true);
  }

  async function handleQuickCopyModels() {
    await copyTextToClipboard(
      upstreamModelsExportPreviewJson,
      t("模型池已复制到剪贴板。", "Model pool copied to clipboard.")
    );
  }

  function handleQuickExportKeyMappings() {
    setQuickExportKeyMappingDialogVisible(true);
  }

  async function handleQuickCopyKeyMappings() {
    await copyTextToClipboard(
      keyMappingsExportPreviewJson,
      t("模型映射已复制到剪贴板。", "Model mappings copied to clipboard.")
    );
  }

  function handleOpenQuickImportDialog() {
    setQuickImportJson("");
    setQuickImportSource("");
    setQuickImportDialogVisible(true);
  }

  function handleOpenQuickImportKeyMappingDialog() {
    setQuickImportKeyMappingJson("");
    setQuickImportKeyMappingSource("");
    setQuickImportKeyMappingDialogVisible(true);
  }

  function handleQuickImportJsonChange(value: string) {
    setQuickImportJson(value);
    setQuickImportSource(
      value.trim() ? t("当前来源：手动粘贴", "Current source: Manual Paste") : ""
    );
  }

  function handleQuickImportKeyMappingJsonChange(value: string) {
    setQuickImportKeyMappingJson(value);
    setQuickImportKeyMappingSource(
      value.trim() ? t("当前来源：手动粘贴", "Current source: Manual Paste") : ""
    );
  }

  async function loadUpstreamModelsFromClipboardToDraft() {
    await loadBulkJsonFromClipboard("upstreamModels");
  }

  async function loadKeyMappingsFromClipboardToDraft() {
    await loadBulkJsonFromClipboard("keyMappings");
  }

  function openUpstreamModelsFileImporter() {
    openBulkJsonFileImporter("upstreamModels");
  }

  function openKeyMappingsFileImporter() {
    openBulkJsonFileImporter("keyMappings");
  }

  function handleQuickImportConfirm() {
    const result = quickImportModels(quickImportJson);
    if (!result.ok) {
      notifyError(result.error);
      return;
    }
    if (channelForm.upstreamModels.length + result.models.length > MAX_UPSTREAM_MODELS) {
      notifyError(
        t(
          `追加后将超过 ${MAX_UPSTREAM_MODELS} 个模型上限，请减少导入数量或改为覆盖导入。`,
          `Appending would exceed the ${MAX_UPSTREAM_MODELS}-model limit. Reduce the import size or use replace.`
        )
      );
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
    setQuickImportJson("");
    setQuickImportSource("");
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
    setQuickImportJson("");
    setQuickImportSource("");
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

    if (!replaceAll && keyForm.modelMappings.length + incoming.length > MAX_KEY_MODEL_MAPPINGS) {
      notifyError(
        t(
          `追加后将超过 ${MAX_KEY_MODEL_MAPPINGS} 条映射上限，请减少导入数量或改为覆盖导入。`,
          `Appending would exceed the ${MAX_KEY_MODEL_MAPPINGS}-mapping limit. Reduce the import size or use replace.`
        )
      );
      return;
    }

    setKeyForm((prev) => ({
      ...prev,
      modelMappings: replaceAll ? incoming : [...prev.modelMappings, ...incoming]
    }));
    setQuickImportKeyMappingDialogVisible(false);
    setQuickImportKeyMappingJson("");
    setQuickImportKeyMappingSource("");
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
      if (
        next !== routeModule &&
        routeModule === "access" &&
        !confirmDiscardKeyDraft(
          t(
            "离开「基础接入」前还有未保存的 Key 草稿。继续跳转会丢失这些内容，确认继续吗？",
            "You have unsaved key changes in Access. Leaving now will discard them. Continue?"
          )
        )
      ) {
        return;
      }
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

  function buildCcSwitchUsageScript() {
    return `({
  request: {
    url: "{{baseUrl}}/v1/usage",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}",
      "User-Agent": "cc-switch/1.0"
    }
  },
  extractor: function(response) {
    if (!response || response.success !== true) {
      return {
        isValid: false,
        invalidMessage:
          (response && (response.error || response.message)) || "Usage query failed"
      };
    }
    if (Array.isArray(response.data) && response.data.length > 0) {
      return response.data;
    }
    return {
      isValid: false,
      invalidMessage: "No usage data available."
    };
  }
})`;
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
      enabled: "true",
      usageEnabled: "true",
      usageScript: toBase64Utf8(buildCcSwitchUsageScript()),
      usageBaseUrl: origin,
      usageAutoInterval: "60"
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
      enabled: "true",
      usageEnabled: "true",
      usageScript: toBase64Utf8(buildCcSwitchUsageScript()),
      usageBaseUrl: origin,
      usageAutoInterval: "60"
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

  function downloadCcSwitchCodexAuthJson() {
    try {
      const authJson = JSON.stringify(buildCcSwitchCodexAuthJson(), null, 2);
      downloadTextSnippet(
        "auth.json",
        authJson,
        t("Codex auth.json 已下载。", "Codex auth.json downloaded.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("下载 Codex auth.json 失败", "Failed to download Codex auth.json")
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

  function downloadCcSwitchCodexConfigToml() {
    try {
      const toml = buildCcSwitchCodexConfigToml();
      downloadTextSnippet(
        "config.toml",
        toml,
        t("Codex config.toml 已下载。", "Codex config.toml downloaded.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("下载 Codex config.toml 失败", "Failed to download Codex config.toml")
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

  function downloadCcSwitchClaudeConfigJson() {
    try {
      const configJson = JSON.stringify(buildCcSwitchClaudeInlineConfig(), null, 2);
      downloadTextSnippet(
        "claude-config.json",
        configJson,
        t("Claude Code 配置已下载。", "Claude Code config downloaded.")
      );
    } catch (err) {
      notifyError(
        err instanceof Error
          ? err.message
          : t("下载 Claude Code 配置失败", "Failed to download Claude Code config")
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
  const compatPromptExemptionCount =
    parseCompatPromptExemptionsInput(compatPromptExemptionsInput).length;
  const compatPromptHintLength = compatPromptHintInput.trim().length;
  const compatPromptRuleCount = compatPromptRulesDraft.length;
  const compatPromptRuleEnabledCount = useMemo(() => {
    if (!isPromptRoute) {
      return 0;
    }
    return compatPromptRulesDraft.filter((item) => item.enabled).length;
  }, [compatPromptRulesDraft, isPromptRoute]);
  const compatPromptRuleCheckIssues = useMemo(
    () => (isPromptRoute ? inspectCompatPromptRules(compatPromptRulesDraft) : []),
    [compatPromptRulesDraft, isPromptRoute]
  );
  const compatPromptRuleErrorCount = useMemo(
    () => compatPromptRuleCheckIssues.filter((item) => item.level === "error").length,
    [compatPromptRuleCheckIssues]
  );
  const compatPromptRuleWarnCount = useMemo(
    () => compatPromptRuleCheckIssues.filter((item) => item.level === "warn").length,
    [compatPromptRuleCheckIssues]
  );
  const compatPromptRuleIssueMap = useMemo(
    () =>
      compatPromptRuleCheckIssues.reduce((map, issue) => {
        issue.relatedIndexes.forEach((index) => {
          const prev = map.get(index);
          if (issue.level === "error" || !prev) {
            map.set(index, issue.level);
          }
        });
        return map;
      }, new Map<number, "warn" | "error">()),
    [compatPromptRuleCheckIssues]
  );
  const compatPromptRuleProviderOptions = useMemo(() => {
    if (!isPromptRoute) {
      return [];
    }
    return Array.from(
      new Set(
        compatPromptRulesDraft
          .map((item) => item.provider.trim())
          .filter(Boolean)
          .map((item) => item.toLowerCase())
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [compatPromptRulesDraft, isPromptRoute]);
  const compatPromptRuleSearchKeyword = compatPromptRuleSearch.trim().toLowerCase();
  const compatPromptRuleVisibleItems = useMemo(() => {
    if (!isPromptRoute) {
      return [];
    }
    return compatPromptRulesDraft
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule, index }) => {
        if (
          compatPromptRuleSearchKeyword &&
          !stringifyCompatPromptRuleForSearch(rule).includes(compatPromptRuleSearchKeyword)
        ) {
          return false;
        }
        if (compatPromptRuleStatusFilter === "enabled" && !rule.enabled) {
          return false;
        }
        if (compatPromptRuleStatusFilter === "disabled" && rule.enabled) {
          return false;
        }
        if (
          compatPromptRuleProviderFilter !== "all" &&
          rule.provider.trim().toLowerCase() !== compatPromptRuleProviderFilter
        ) {
          return false;
        }
        const issueLevel = compatPromptRuleIssueMap.get(index) ?? null;
        if (compatPromptRuleIssueFilter === "error" && issueLevel !== "error") {
          return false;
        }
        if (compatPromptRuleIssueFilter === "warn" && issueLevel !== "warn") {
          return false;
        }
        if (compatPromptRuleIssueFilter === "attention" && !issueLevel) {
          return false;
        }
        if (compatPromptRuleIssueFilter === "clean" && issueLevel) {
          return false;
        }
        return true;
      });
  }, [
    compatPromptRuleIssueFilter,
    compatPromptRuleIssueMap,
    compatPromptRuleProviderFilter,
    compatPromptRuleSearchKeyword,
    compatPromptRuleStatusFilter,
    compatPromptRulesDraft,
    isPromptRoute
  ]);
  const compatPromptRuleActiveFilters: ActiveFilterChip[] = [];
  if (compatPromptRuleSearch.trim()) {
    compatPromptRuleActiveFilters.push({
      key: "prompt-search",
      label: t("检索", "Search"),
      value: compatPromptRuleSearch.trim(),
      tone: "primary",
      onClear: () => setCompatPromptRuleSearch("")
    });
  }
  if (compatPromptRuleStatusFilter !== "all") {
    compatPromptRuleActiveFilters.push({
      key: "prompt-status",
      label: t("状态", "Status"),
      value:
        compatPromptRuleStatusFilter === "enabled"
          ? t("启用", "Enabled")
          : t("停用", "Disabled"),
      onClear: () => setCompatPromptRuleStatusFilter("all")
    });
  }
  if (compatPromptRuleProviderFilter !== "all") {
    compatPromptRuleActiveFilters.push({
      key: "prompt-provider",
      label: t("供应商", "Provider"),
      value: compatPromptRuleProviderFilter,
      onClear: () => setCompatPromptRuleProviderFilter("all")
    });
  }
  if (compatPromptRuleIssueFilter !== "all") {
    compatPromptRuleActiveFilters.push({
      key: "prompt-issue",
      label: t("风险", "Risk"),
      value:
        compatPromptRuleIssueFilter === "error"
          ? t("仅错误", "Errors Only")
          : compatPromptRuleIssueFilter === "warn"
            ? t("仅警告", "Warnings Only")
            : compatPromptRuleIssueFilter === "attention"
              ? t("全部风险项", "Attention Items")
              : t("仅干净规则", "Clean Rules"),
      tone: compatPromptRuleIssueFilter === "error" ? "warning" : "default",
      onClear: () => setCompatPromptRuleIssueFilter("all")
    });
  }
  const compatPromptUpstreamModelSuggestions = useMemo(() => {
    if (!isPromptRoute) {
      return [];
    }
    return Array.from(
      new Set(
        channels
          .flatMap((channel) => channel.upstreamModels)
          .map((model) => model.model.trim())
          .filter(Boolean)
      )
    )
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 16);
  }, [channels, isPromptRoute]);
  const upstreamModelsExportPreviewJson = useMemo(
    () => quickExportModels(channelForm.upstreamModels),
    [channelForm.upstreamModels]
  );
  const keyMappingsExportPreviewJson = useMemo(
    () =>
      quickExportKeyMappings(
        keyForm.modelMappings,
        (channelId) => channels.find((item) => item.id === channelId)?.name ?? null
      ),
    [channels, keyForm.modelMappings]
  );
  const compatPromptRulesExportPreviewJson = useMemo(
    () =>
      compatPromptRulesExportDialogVisible
        ? quickExportCompatPromptRules(normalizeCompatPromptRules(compatPromptRulesDraft))
        : "",
    [compatPromptRulesDraft, compatPromptRulesExportDialogVisible]
  );
  const compatPromptRulesQuickImportPreview = useMemo(() => {
    if (!compatPromptRulesImportDialogVisible) {
      return createIdleBulkImportPreview<CompatPromptRule>();
    }
    return buildBulkImportPreview<CompatPromptRule>({
      rawValue: compatPromptRulesQuickImportJson,
      currentCount: compatPromptRuleCount,
      parse: (value) => {
        const result = quickImportCompatPromptRules(value);
        return result.ok
          ? { ok: true, items: normalizeCompatPromptRules(result.rules), note: result.note }
          : { ok: false, error: result.error };
      },
      getEnabledCount: (item) => item.enabled,
      inspectItems: (items) =>
        inspectCompatPromptRules(items).map((issue) => ({
          level: issue.level,
          message: issue.message
        })),
      limit: MAX_COMPAT_PROMPT_RULES,
      readyMessage: () =>
        t(
          "JSON 结构校验通过，可以直接追加或覆盖导入。",
          "JSON validation passed. You can append or replace directly."
        ),
      warningMessage: (warnCount) =>
        t(
          `发现 ${warnCount} 条宽匹配告警，建议导入后抽样检查命中结果。`,
          `${warnCount} broad-match warnings detected. Review matched results after import.`
        ),
      errorMessage: (errorCount) =>
        t(
          `发现 ${errorCount} 条规则冲突风险，建议导入后尽快修正并保存前做回归验证。`,
          `${errorCount} rule conflict risks detected. Import is allowed, but you should fix them and run regression checks before saving.`
        ),
      appendLimitMessage: () =>
        t(
          "追加后将超过 128 条规则上限，请减少导入数量或改为覆盖导入。",
          "Appending would exceed the 128-rule limit. Reduce the import size or use replace."
        ),
      replaceLimitMessage: () =>
        t(
          "覆盖后仍会超过 128 条规则上限，请减少导入数量。",
          "Replacing would still exceed the 128-rule limit. Reduce the import size."
        )
    });
  }, [
    compatPromptRuleCount,
    compatPromptRulesImportDialogVisible,
    compatPromptRulesQuickImportJson,
    t
  ]);
  const upstreamModelsQuickImportPreview = useMemo(() => {
    if (!quickImportDialogVisible) {
      return createIdleBulkImportPreview<Omit<UpstreamModelConfig, "id">>();
    }
    return buildBulkImportPreview<Omit<UpstreamModelConfig, "id">>({
      rawValue: quickImportJson,
      currentCount: channelForm.upstreamModels.length,
      parse: (value) => {
        const result = quickImportModels(value);
        return result.ok
          ? { ok: true, items: result.models, note: result.note }
          : { ok: false, error: result.error };
      },
      getEnabledCount: (item) => item.enabled,
      limit: MAX_UPSTREAM_MODELS,
      readyMessage: (note) => note,
      warningMessage: (warnCount) =>
        t(
          `发现 ${warnCount} 条模型池告警，请导入后手动核对。`,
          `${warnCount} model-pool warnings detected. Review imported items after import.`
        ),
      errorMessage: (errorCount) =>
        t(
          `发现 ${errorCount} 条模型池错误，请修正后再导入。`,
          `${errorCount} model-pool errors detected. Fix them before import.`
        ),
      appendLimitMessage: () =>
        t(
          "追加后将超过 64 个模型上限，请减少导入数量或改为覆盖导入。",
          "Appending would exceed the 64-model limit. Reduce the import size or use replace."
        ),
      replaceLimitMessage: () =>
        t(
          "覆盖后仍会超过 64 个模型上限，请减少导入数量。",
          "Replacing would still exceed the 64-model limit. Reduce the import size."
        )
    });
  }, [channelForm.upstreamModels.length, quickImportDialogVisible, quickImportJson, t]);
  const keyMappingsQuickImportPreview = useMemo(() => {
    if (!quickImportKeyMappingDialogVisible) {
      return createIdleBulkImportPreview<KeyModelMapping>();
    }
    return buildBulkImportPreview({
      rawValue: quickImportKeyMappingJson,
      currentCount: keyForm.modelMappings.length,
      parse: (value) => {
        const result = quickImportKeyMappings(value);
        return result.ok
          ? { ok: true, items: result.mappings, note: result.note }
          : { ok: false, error: result.error };
      },
      getEnabledCount: (item) => item.enabled,
      inspectItems: (items) =>
        items.flatMap((item) => {
          const issues: Array<{ level: "warn" | "error"; message: string }> = [];
          const mappingBinding = resolveImportedChannelBinding(
            item.upstreamChannelName,
            item.upstreamChannelId
          );
          const overflowBinding = resolveImportedChannelBinding(
            item.contextOverflowChannelName,
            item.contextOverflowChannelId
          );
          if (mappingBinding.requested && !mappingBinding.resolved) {
            issues.push({
              level: "warn",
              message: `Mapping channel binding for ${item.clientModel} will fall back to key inheritance.`
            });
          }
          if (item.contextOverflowModel && overflowBinding.requested && !overflowBinding.resolved) {
            issues.push({
              level: "warn",
              message: `Overflow channel binding for ${item.clientModel} will keep only the model name.`
            });
          }
          return issues;
        }),
      limit: MAX_KEY_MODEL_MAPPINGS,
      readyMessage: (note) => note,
      warningMessage: (warnCount) =>
        t(
          `发现 ${warnCount} 条映射告警，请导入后手动核对。`,
          `${warnCount} mapping warnings detected. Review imported items after import.`
        ),
      errorMessage: (errorCount) =>
        t(
          `发现 ${errorCount} 条映射错误，请修正后再导入。`,
          `${errorCount} mapping errors detected. Fix them before import.`
        ),
      appendLimitMessage: () =>
        t(
          "追加后将超过 128 条映射上限，请减少导入数量或改为覆盖导入。",
          "Appending would exceed the 128-mapping limit. Reduce the import size or use replace."
        ),
      replaceLimitMessage: () =>
        t(
          "覆盖后仍会超过 128 条映射上限，请减少导入数量。",
          "Replacing would still exceed the 128-mapping limit. Reduce the import size."
        )
    });
  }, [
    channels,
    keyForm.modelMappings.length,
    quickImportKeyMappingDialogVisible,
    quickImportKeyMappingJson,
    t
  ]);
  const compatPromptRulesAppendDisabled =
    compatPromptRulesQuickImportPreview.state !== "ready" ||
    compatPromptRulesQuickImportPreview.appendTotal > MAX_COMPAT_PROMPT_RULES;
  const compatPromptRulesReplaceDisabled =
    compatPromptRulesQuickImportPreview.state !== "ready" ||
    compatPromptRulesQuickImportPreview.replaceTotal > MAX_COMPAT_PROMPT_RULES;
  const upstreamModelsAppendDisabled =
    upstreamModelsQuickImportPreview.state !== "ready" ||
    upstreamModelsQuickImportPreview.appendTotal > MAX_UPSTREAM_MODELS;
  const upstreamModelsReplaceDisabled =
    upstreamModelsQuickImportPreview.state !== "ready" ||
    upstreamModelsQuickImportPreview.replaceTotal > MAX_UPSTREAM_MODELS;
  const keyMappingsAppendDisabled =
    keyMappingsQuickImportPreview.state !== "ready" ||
    keyMappingsQuickImportPreview.appendTotal > MAX_KEY_MODEL_MAPPINGS;
  const keyMappingsReplaceDisabled =
    keyMappingsQuickImportPreview.state !== "ready" ||
    keyMappingsQuickImportPreview.replaceTotal > MAX_KEY_MODEL_MAPPINGS;
  const bulkDialogLabels = useMemo(
    () => ({
      close: t("关闭", "Close"),
      clear: t("清空", "Clear"),
      loadClipboard: t("从剪贴板读取", "Load from Clipboard"),
      chooseFile: t("选择 JSON 文件", "Choose JSON File"),
      importCount: t("导入", "Import"),
      enabledCount: t("启用", "Enabled"),
      afterAppend: t("追加后", "After Append"),
      afterReplace: t("覆盖后", "After Replace"),
      warnings: t("警告", "Warnings"),
      errors: t("错误", "Errors")
    }),
    [t]
  );
  const promptLabCandidateModels = useMemo(() => {
    if (!isPromptRoute) {
      return [];
    }
    return parsePromptLabModelListInput(promptLabCandidateModelsInput);
  }, [isPromptRoute, promptLabCandidateModelsInput]);
  const promptLabRunning =
    promptLabRunSummary?.status === "queued" || promptLabRunSummary?.status === "running";
  const promptLabBaselineMetrics =
    promptLabReport?.report.perModel.find(
      (item) => item.model.toLowerCase() === promptLabReport.report.baselineModel.toLowerCase()
    ) ?? null;
  const promptLabThresholds = promptLabReport?.thresholds ?? null;
  const promptOptimizerSuggestedRulePreview = promptOptimizerResult
    ? JSON.stringify(promptOptimizerResult.suggestedRule, null, 2)
    : "";
  const routeModuleTitle = t(MODULE_LABEL[routeModule].zh, MODULE_LABEL[routeModule].en);
  const routeModuleSummary = t(MODULE_SUMMARY[routeModule].zh, MODULE_SUMMARY[routeModule].en);
  const routeModuleIcon =
    routeModule === "dashboard" ? <LayoutDashboard size={18} /> :
    routeModule === "access" ? <User size={18} /> :
    routeModule === "prompt" ? <Code2 size={18} /> :
    routeModule === "export" ? <FileOutput size={18} /> :
    routeModule === "upstream" ? <Globe size={18} /> :
    routeModule === "runtime" ? <ArrowUpDown size={18} /> :
    routeModule === "logs" ? <FileText size={18} /> :
    routeModule === "calls" ? <Activity size={18} /> :
    routeModule === "usage" ? <Database size={18} /> :
    <BookOpen size={18} />;
  const moduleHeroMetrics =
    routeModule === "dashboard"
      ? [
          {
            id: "hero-keys",
            label: t("启用 Key", "Enabled Keys"),
            value: `${enabledKeyCount}/${keys.length}`,
            note: t("本地 Key 工作中", "Local keys online")
          },
          {
            id: "hero-upstreams",
            label: t("启用渠道", "Enabled Upstreams"),
            value: `${enabledChannelCount}/${channels.length}`,
            note: t("可用上游连接", "Healthy upstreams")
          },
          {
            id: "hero-requests",
            label: t("请求总量", "Request Volume"),
            value: formatNumber(usageReport?.summary.requestCount ?? 0),
            note: t("最近统计窗口", "Current reporting window")
          },
          {
            id: "hero-tokens",
            label: t("Token 总量", "Token Volume"),
            value: formatCompactNumber(usageReport?.summary.totalTokens ?? 0),
            note: t("已聚合消耗", "Aggregated usage")
          }
        ]
      : routeModule === "upstream"
        ? [
            {
              id: "hero-channel-total",
              label: t("渠道总数", "Total Upstreams"),
              value: formatNumber(channels.length),
              note: t("当前工作区配置", "Workspace configured")
            },
            {
              id: "hero-channel-provider",
              label: t("当前供应商", "Current Provider"),
              value: PROVIDER_META[channelForm.provider].label,
              note: selectedChannel ? selectedChannel.name : t("新建草稿", "New draft")
            },
            {
              id: "hero-channel-models",
              label: t("可见模型", "Visible Models"),
              value: `${channelModelVisibleItems.length}/${channelForm.upstreamModels.length}`,
              note: t("按筛选后的模型池", "Filtered model pool")
            },
            {
              id: "hero-channel-status",
              label: t("当前状态", "Current Status"),
              value: selectedChannel
                ? selectedChannel.enabled
                  ? t("已启用", "Enabled")
                  : t("已停用", "Disabled")
                : t("新建草稿", "New draft"),
              note: t("保存后立即生效", "Applies after saving")
            }
          ]
        : routeModule === "prompt"
          ? [
              {
                id: "hero-prompt-rules",
                label: t("规则总数", "Rules"),
                value: formatNumber(compatPromptRuleCount),
                note: t("当前提示词规则", "Current prompt rules")
              },
              {
                id: "hero-prompt-enabled",
                label: t("启用规则", "Enabled"),
                value: formatNumber(compatPromptRuleEnabledCount),
                note: t("正在参与匹配", "Actively matching")
              },
              {
                id: "hero-prompt-keywords",
                label: t("AGENTS 关键词", "AGENTS Keywords"),
                value: formatNumber(compatPromptKeywordCount),
                note: t("入口识别用", "Used for detection")
              },
              {
                id: "hero-prompt-defaults",
                label: t("默认配置", "Defaults"),
                value: compatPromptDefaults ? t("就绪", "Ready") : t("加载中", "Loading"),
                note: t("网关注入策略", "Gateway injection policy")
              }
            ]
          : routeModule === "logs"
            ? [
                {
                  id: "hero-logs-loaded",
                  label: t("已加载", "Loaded"),
                  value: formatNumber(apiLogs.length),
                  note: t("最近抓取日志", "Fetched recently")
                },
                {
                  id: "hero-logs-matched",
                  label: t("筛选命中", "Matched"),
                  value: formatNumber(filteredApiLogs.length),
                  note: t("当前条件结果", "Filtered results")
                },
                {
                  id: "hero-logs-errors",
                  label: t("异常记录", "Errors"),
                  value: formatNumber(
                    filteredApiLogs.filter(
                      (item) => item.error || item.status === null || item.status >= 400
                    ).length
                  ),
                  note: t("便于快速排障", "Fast issue triage")
                },
                {
                  id: "hero-logs-refresh",
                  label: t("自动刷新", "Auto Refresh"),
                  value: autoRefreshLogs ? t("开启", "On") : t("关闭", "Off"),
                  note: t("日志轮询状态", "Polling status")
                }
              ]
            : routeModule === "calls"
              ? [
                  {
                    id: "hero-calls-current",
                    label: t("当前日志", "Current Logs"),
                    value: formatNumber(aiCallLogs.length),
                    note: t("本次载入结果", "Loaded entries")
                  },
                  {
                    id: "hero-calls-matched",
                    label: t("匹配结果", "Matched"),
                    value: formatNumber(aiCallStats.matched),
                    note: t("满足筛选条件", "Matches filters")
                  },
                  {
                    id: "hero-calls-vision",
                    label: t("辅助视觉", "Vision Fallback"),
                    value: formatNumber(aiCallStats.visionFallback),
                    note: t("跨模型视觉调用", "Cross-model vision calls")
                  },
                  {
                    id: "hero-calls-refresh",
                    label: t("自动刷新", "Auto Refresh"),
                    value: autoRefreshAiCallLogs ? t("开启", "On") : t("关闭", "Off"),
                    note: t("调用日志轮询", "Call log polling")
                  }
                ]
              : routeModule === "usage"
                ? [
                    {
                      id: "hero-usage-requests",
                      label: t("请求总量", "Requests"),
                      value: formatNumber(usageReport?.summary.requestCount ?? 0),
                      note: t("当前报表窗口", "Current report window")
                    },
                    {
                      id: "hero-usage-tokens",
                      label: t("Token 总量", "Total Tokens"),
                      value: formatCompactNumber(usageReport?.summary.totalTokens ?? 0),
                      note: t("总消耗", "Aggregated usage")
                    },
                    {
                      id: "hero-usage-keys",
                      label: t("活跃 Key", "Active Keys"),
                      value: formatNumber(usageReport?.summary.uniqueKeys ?? 0),
                      note: t("有请求的本地 Key", "Keys with traffic")
                    },
                    {
                      id: "hero-usage-window",
                      label: t("统计窗口", "Window"),
                      value: usageRangeTagLabel,
                      note: t("可随时切换", "Adjustable range")
                    }
                  ]
                : routeModule === "docs"
                  ? [
                      {
                        id: "hero-docs-gateway",
                        label: t("网关路由", "Gateway Routes"),
                        value: formatNumber(API_DOC_GATEWAY_ENDPOINTS.length),
                        note: t("兼容 OpenAI 风格", "OpenAI-style routes")
                      },
                      {
                        id: "hero-docs-management",
                        label: t("管理路由", "Management Routes"),
                        value: formatNumber(API_DOC_MANAGEMENT_ENDPOINTS.length),
                        note: t("控制台管理接口", "Console management APIs")
                      },
                      {
                        id: "hero-docs-auth",
                        label: t("鉴权方式", "Auth Modes"),
                        value: "2",
                        note: "Authorization / x-api-key"
                      },
                      {
                        id: "hero-docs-base",
                        label: t("基础路径", "Base Path"),
                        value: "/v1",
                        note: t("复制后即可接入", "Ready to integrate")
                      }
                    ]
                  : [
                      {
                        id: "hero-key-total",
                        label: t("本地 Key", "Local Keys"),
                        value: formatNumber(keys.length),
                        note: t("工作区全部 Key", "All workspace keys")
                      },
                      {
                        id: "hero-key-enabled",
                        label: t("启用中", "Enabled"),
                        value: formatNumber(enabledKeyCount),
                        note: t("当前可接入", "Ready to serve")
                      },
                      {
                        id: "hero-key-mappings",
                        label: t("可见映射", "Visible Mappings"),
                        value: `${keyMappingVisibleItems.length}/${keyForm.modelMappings.length}`,
                        note: t("按筛选后的结果", "Filtered mappings")
                      },
                      {
                        id: "hero-key-state",
                        label: t("草稿状态", "Draft State"),
                        value: isNewKey
                          ? t("新建草稿", "New draft")
                          : isKeyDirty
                            ? t("待保存", "Unsaved")
                            : t("已同步", "Synced"),
                        note: routeModule === "runtime"
                          ? t("运行时切换不会改写原模型", "Runtime switch does not overwrite defaults")
                          : routeModule === "export"
                            ? t("导出前可先确认绑定配置", "Verify bindings before export")
                        : t("保存后更新接入行为", "Access behavior updates after saving")
                      }
                    ];
  return (
    <div className="tc-console">
      <a className="tc-skip-link" href="#legacy-console-main">
        {t("跳到主内容", "Skip to main content")}
      </a>
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
            theme="dark"
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

        <main id="legacy-console-main" className="tc-main" tabIndex={-1}>
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
              <Button
                variant="text"
                shape="circle"
                icon={<UserCircle size={18} />}
                aria-label={t("用户菜单", "User menu")}
              />
            </div>
          </Layout.Header>

          <Layout.Content className="tc-content">
            <section className="tc-console-hero">
              <div className="tc-console-hero-head">
                <div className="tc-console-hero-copy">
                  <div className="tc-console-hero-kicker">
                    <span className="tc-console-hero-icon">{routeModuleIcon}</span>
                    <span>{t("Gateway Workspace", "Gateway Workspace")}</span>
                  </div>
                  <h1>{routeModuleTitle}</h1>
                  <p>{routeModuleSummary}</p>
                </div>
                <aside className="tc-console-hero-context">
                  <span>{t("Gateway Endpoint", "Gateway Endpoint")}</span>
                  <code>{gatewayV1Endpoint}</code>
                  <small>
                    {t("当前语言", "Current locale")}: {locale === "zh-CN" ? "简体中文" : "English"}
                  </small>
                </aside>
              </div>

              <div className="tc-console-hero-metrics">
                {moduleHeroMetrics.map((item) => (
                  <article key={item.id} className="tc-console-hero-metric">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.note}</small>
                  </article>
                ))}
              </div>
            </section>

            <Card className="tc-panel tc-panel-shell" bordered>
              <div className="tc-toolbar">
                {routeModule === "logs" ? (
                  <div className="tc-toolbar-left">
                    <span className="tc-label">{t("请求日志", "Request Logs")}</span>
                    <Tag variant="light-outline">
                      {t("命中", "Matched")} {filteredApiLogs.length} / {apiLogs.length}
                    </Tag>
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
                    <Tag variant="light-outline">exemptions={compatPromptExemptionCount}</Tag>
                    <Tag variant="light-outline">hint_chars={compatPromptHintLength}</Tag>
                    <Tag variant="light-outline">rules={compatPromptRuleCount}</Tag>
                    <Tag variant="light-outline">enabled={compatPromptRuleEnabledCount}</Tag>
                    <Tag variant="light-outline">
                      {t("可见", "Visible")} {compatPromptRuleVisibleItems.length}
                    </Tag>
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
                    <Tag variant="light-outline">
                      {t("命中", "Matched")} {filteredChannels.length}/{channels.length}
                    </Tag>
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
                    <Tag variant="light-outline">
                      {t("命中", "Matched")} {filteredKeys.length}/{keys.length}
                    </Tag>
                    {routeModule === "access" ? (
                      savingKey ? (
                        <Tag theme="warning" variant="light-outline">
                          {t("保存中", "Saving")}
                        </Tag>
                      ) : isNewKey ? (
                        <Tag theme={isKeyDirty ? "warning" : "default"} variant="light-outline">
                          {isKeyDirty
                            ? t("新建未保存", "New Draft Unsaved")
                            : t("新建草稿", "New Draft")}
                        </Tag>
                      ) : isKeyDirty ? (
                        <Tag theme="warning" variant="light-outline">
                          {t("草稿未保存", "Unsaved Draft")}
                        </Tag>
                      ) : (
                        <Tag theme="success" variant="light-outline">
                          {t("草稿已同步", "Draft Synced")}
                        </Tag>
                      )
                    ) : null}
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
                        onClick={() => void refreshKeyWorkspace()}
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

              {routeModule === "upstream" ? (
                <FilterSection
                  title={t("渠道检索与筛选", "Channel Finder")}
                  subtitle={t(
                    "像企业后台一样先缩小范围，再进入具体渠道编辑。",
                    "Narrow down the channel list before jumping into a specific channel."
                  )}
                >
                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group tc-log-field-wide">
                      <label className="tc-field">
                        <span>{t("关键词", "Keyword")}</span>
                        <Input
                          value={channelSelectorSearch}
                          onChange={(value) => setChannelSelectorSearch(value)}
                          placeholder={t("搜索渠道名 / Provider / Base URL / 默认模型", "Search name / provider / base URL / default model")}
                          clearable
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("状态", "Status")}</span>
                        <Select
                          value={channelSelectorStatusFilter}
                          options={[
                            { label: t("全部状态", "All Status"), value: "all" },
                            { label: t("启用", "Enabled"), value: "enabled" },
                            { label: t("停用", "Disabled"), value: "disabled" }
                          ]}
                          style={{ width: 170 }}
                          onChange={(value) =>
                            setChannelSelectorStatusFilter(
                              normalizeSelectValue(value) as SelectorStatusFilter
                            )
                          }
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("供应商", "Provider")}</span>
                        <Select
                          value={channelSelectorProviderFilter}
                          options={[
                            { label: t("全部供应商", "All Providers"), value: "all" },
                            ...PROVIDERS.map((item) => ({
                              label: PROVIDER_META[item].label,
                              value: item
                            }))
                          ]}
                          style={{ width: 180 }}
                          onChange={(value) => setChannelSelectorProviderFilter(normalizeSelectValue(value))}
                        />
                      </label>
                    </div>
                  </div>
                  <ActiveFilterSummary
                    items={channelSelectorFilterChips}
                    onClearAll={() => {
                      setChannelSelectorSearch("");
                      setChannelSelectorStatusFilter("all");
                      setChannelSelectorProviderFilter("all");
                    }}
                  />
                </FilterSection>
              ) : routeModule === "access" || routeModule === "export" || routeModule === "runtime" ? (
                <FilterSection
                  title={t("Key 检索与筛选", "Key Finder")}
                  subtitle={t(
                    "先按名称、状态和渠道范围定位目标 Key，再进入接入、导出或运行时操作。",
                    "Locate the right key by name and status before editing access, export, or runtime settings."
                  )}
                >
                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group tc-log-field-wide">
                      <label className="tc-field">
                        <span>{t("关键词", "Keyword")}</span>
                        <Input
                          value={keySelectorSearch}
                          onChange={(value) => setKeySelectorSearch(value)}
                          placeholder={t("搜索 Key 名称 / 本地 Key / 渠道 / 默认模型", "Search key name / local key / channel / default model")}
                          clearable
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("状态", "Status")}</span>
                        <Select
                          value={keySelectorStatusFilter}
                          options={[
                            { label: t("全部状态", "All Status"), value: "all" },
                            { label: t("启用", "Enabled"), value: "enabled" },
                            { label: t("停用", "Disabled"), value: "disabled" }
                          ]}
                          style={{ width: 170 }}
                          onChange={(value) =>
                            setKeySelectorStatusFilter(
                              normalizeSelectValue(value) as SelectorStatusFilter
                            )
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <ActiveFilterSummary
                    items={keySelectorFilterChips}
                    onClearAll={() => {
                      setKeySelectorSearch("");
                      setKeySelectorStatusFilter("all");
                    }}
                  />
                </FilterSection>
              ) : null}

              <div className="tc-meta-row">
                <Tag variant="light-outline">wire_api={wireApi}</Tag>
                {routeModule === "logs" ? (
                  <>
                    <Tag variant="light-outline">logs={filteredApiLogs.length}</Tag>
                    <Tag variant="light-outline">loaded={apiLogs.length}</Tag>
                    <Tag variant="light-outline">
                      latest={formatCnDate(filteredApiLogs[0]?.createdAt ?? "")}
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
                    <Tag variant="light-outline">exemptions={compatPromptExemptionCount}</Tag>
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
                    <Tag variant="light-outline">
                      models={channelModelVisibleItems.length}/{channelForm.upstreamModels.length}
                    </Tag>
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
                      mappings={keyMappingVisibleItems.length}/{keyForm.modelMappings.length}
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
                  usageMinutes={usageMinutes}
                  setUsageMinutes={setUsageMinutes}
                  usageDateRange={usageDateRange}
                  setUsageDateRange={setUsageDateRange}
                  t={t}
                  enabledKeyCount={enabledKeyCount}
                  enabledChannelCount={enabledChannelCount}
                  gatewayV1Endpoint={gatewayV1Endpoint}
                />
              ) : routeModule === "access" ? (
                <SettingsAccessPanel
                  t={t}
                  keyForm={keyForm}
                  setKeyForm={setKeyForm}
                  keyBindChannelOptions={keyBindChannelOptions}
                  normalizeSelectValue={normalizeSelectValue}
                  copyLocalKey={copyLocalKey}
                  addKeyModelMapping={addKeyModelMapping}
                  handleQuickExportKeyMappings={handleQuickExportKeyMappings}
                  handleQuickCopyKeyMappings={handleQuickCopyKeyMappings}
                  handleOpenQuickImportKeyMappingDialog={handleOpenQuickImportKeyMappingDialog}
                  resolveMappingChannel={resolveMappingChannel}
                  findChannelModelProfile={findChannelModelProfile}
                  formatDoubaoThinkingTypeLabel={formatDoubaoThinkingTypeLabel}
                  updateKeyModelMapping={updateKeyModelMapping}
                  removeKeyModelMapping={removeKeyModelMapping}
                  mappingBindChannelOptions={mappingBindChannelOptions}
                  formatGlmThinkingThresholdLabel={formatGlmThinkingThresholdLabel}
                  updateBoundChannelGlmThinkingThreshold={updateBoundChannelGlmThinkingThreshold}
                  loading={loading}
                  savingKey={savingKey}
                  savingChannel={savingChannel}
                  keyOverflowModelOptions={keyOverflowModelOptions}
                  mappingOverflowModelOptions={mappingOverflowModelOptions}
                  selectedChannelForKey={selectedChannelForKey}
                  keyMappingSearch={keyMappingSearch}
                  setKeyMappingSearch={setKeyMappingSearch}
                  keyMappingStatusFilter={keyMappingStatusFilter}
                  setKeyMappingStatusFilter={setKeyMappingStatusFilter}
                  keyMappingBindingFilter={keyMappingBindingFilter}
                  setKeyMappingBindingFilter={setKeyMappingBindingFilter}
                  keyMappingOverflowFilter={keyMappingOverflowFilter}
                  setKeyMappingOverflowFilter={setKeyMappingOverflowFilter}
                  keyMappingVisibleItems={keyMappingVisibleItems}
                  keyMappingActiveFilters={keyMappingActiveFilters}
                  resetKeyMappingFilters={resetKeyMappingFilters}
                  isNewKey={isNewKey}
                  handleMenuRoute={handleMenuRoute}
                  generateLocalKey={generateLocalKey}
                />
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
                <SettingsPromptPanel
                  t={t}
                  normalizeSelectValue={normalizeSelectValue}
                  compatPromptKeywordsInput={compatPromptKeywordsInput}
                  setCompatPromptKeywordsInput={setCompatPromptKeywordsInput}
                  compatPromptExemptionsInput={compatPromptExemptionsInput}
                  setCompatPromptExemptionsInput={setCompatPromptExemptionsInput}
                  compatPromptExemptionCount={compatPromptExemptionCount}
                  compatPromptHintInput={compatPromptHintInput}
                  setCompatPromptHintInput={setCompatPromptHintInput}
                  compatPromptRuleCount={compatPromptRuleCount}
                  compatPromptRuleEnabledCount={compatPromptRuleEnabledCount}
                  compatPromptRuleSearch={compatPromptRuleSearch}
                  setCompatPromptRuleSearch={setCompatPromptRuleSearch}
                  compatPromptRuleStatusFilter={compatPromptRuleStatusFilter}
                  setCompatPromptRuleStatusFilter={setCompatPromptRuleStatusFilter}
                  compatPromptRuleProviderFilter={compatPromptRuleProviderFilter}
                  setCompatPromptRuleProviderFilter={setCompatPromptRuleProviderFilter}
                  compatPromptRuleProviderOptions={compatPromptRuleProviderOptions}
                  compatPromptRuleIssueFilter={compatPromptRuleIssueFilter}
                  setCompatPromptRuleIssueFilter={setCompatPromptRuleIssueFilter}
                  compatPromptRuleActiveFilters={compatPromptRuleActiveFilters}
                  resetPromptRuleFilters={resetPromptRuleFilters}
                  addCompatPromptRule={addCompatPromptRule}
                  handleOpenCompatPromptRulesImportDialog={handleOpenCompatPromptRulesImportDialog}
                  handleOpenCompatPromptRulesExportDialog={handleOpenCompatPromptRulesExportDialog}
                  compatPromptUpstreamModelSuggestions={compatPromptUpstreamModelSuggestions}
                  compatPromptRuleVisibleItems={compatPromptRuleVisibleItems}
                  duplicateCompatPromptRule={duplicateCompatPromptRule}
                  removeCompatPromptRule={removeCompatPromptRule}
                  updateCompatPromptRule={updateCompatPromptRule}
                  setShowCompatPromptRulesJsonEditor={setShowCompatPromptRulesJsonEditor}
                  showCompatPromptRulesJsonEditor={showCompatPromptRulesJsonEditor}
                  compatPromptRulesJsonInput={compatPromptRulesJsonInput}
                  setCompatPromptRulesJsonInput={setCompatPromptRulesJsonInput}
                  exportCompatPromptRulesToJsonDraft={exportCompatPromptRulesToJsonDraft}
                  importCompatPromptRulesFromJsonDraft={importCompatPromptRulesFromJsonDraft}
                  savingCompatPromptConfig={savingCompatPromptConfig}
                  saveGatewayCompatPromptConfig={saveGatewayCompatPromptConfig}
                  loading={loading}
                  compatPromptDefaults={compatPromptDefaults}
                  applyCompatPromptConfig={applyCompatPromptConfig}
                />
              ) : null}

              {routeModule === "prompt" ? (
                <section className="tc-section">
                  <h3>{t("第三方模型提示词优化工具", "Third-Party Prompt Optimizer")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "输入第三方模型信息和基础提示词，自动生成更适配 Codex 的约束版本。你可以直接应用为默认提示词，或一键生成为模型规则草稿。",
                      "Provide model metadata and a base prompt to generate a Codex-compatible optimized hint. You can apply it as the default hint or create a model-rule draft in one click."
                    )}
                  </p>

                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("供应商（可选）", "Provider (optional)")}</span>
                      <Input
                        value={promptOptimizerProviderInput}
                        onChange={(value) => setPromptOptimizerProviderInput(value)}
                        clearable
                        placeholder={t("如 openai / anthropic / glm", "e.g. openai / anthropic / glm")}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("上游真实模型（可选）", "Upstream Model (optional)")}</span>
                      <Input
                        value={promptOptimizerUpstreamModelInput}
                        onChange={(value) => setPromptOptimizerUpstreamModelInput(value)}
                        clearable
                        placeholder={t("如 glm-5 / claude-3-7-sonnet", "e.g. glm-5 / claude-3-7-sonnet")}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("客户端模型名（可选）", "Client Model (optional)")}</span>
                      <Input
                        value={promptOptimizerClientModelInput}
                        onChange={(value) => setPromptOptimizerClientModelInput(value)}
                        clearable
                        placeholder={t("如 gpt-5.4 / gpt-4.1-mini", "e.g. gpt-5.4 / gpt-4.1-mini")}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("优化策略", "Optimization Focus")}</span>
                      <Select
                        value={promptOptimizerFocus}
                        options={[
                          { label: t("平衡模式", "Balanced"), value: "balanced" },
                          { label: t("工具调用优先", "Tool Calling First"), value: "tool-calling" },
                          { label: t("严格模式", "Strict"), value: "strict" }
                        ]}
                        style={{ width: 220 }}
                        onChange={(value) => {
                          const next = normalizeSelectValue(value);
                          if (
                            next === "balanced" ||
                            next === "tool-calling" ||
                            next === "strict"
                          ) {
                            setPromptOptimizerFocus(next);
                          }
                        }}
                      />
                    </label>

                    <label className="tc-switchline">
                      <span>{t("保留原始业务提示词", "Preserve Original Prompt")}</span>
                      <Switch
                        value={promptOptimizerPreserveOriginal}
                        onChange={(value) => setPromptOptimizerPreserveOriginal(Boolean(value))}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("观测问题标签（每行一个）", "Observed Issues (one per line)")}</span>
                      <Textarea
                        value={promptOptimizerIssuesInput}
                        onChange={(value) => setPromptOptimizerIssuesInput(value)}
                        autosize={{ minRows: 4, maxRows: 10 }}
                        placeholder={"schema_error\nmissing_tool_call\nfake_patch"}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("基础提示词", "Base Prompt")}</span>
                      <Textarea
                        value={promptOptimizerBasePromptInput}
                        onChange={(value) => setPromptOptimizerBasePromptInput(value)}
                        autosize={{ minRows: 8, maxRows: 14 }}
                        placeholder={t(
                          "留空时自动使用当前“默认提示词正文”作为优化输入。",
                          "Leave empty to use the current default prompt body as optimization input."
                        )}
                      />
                    </label>
                  </div>

                  <div className="tc-actions-row">
                    <Button
                      theme="primary"
                      loading={promptOptimizerRunning}
                      onClick={() => void runPromptOptimizer()}
                    >
                      {t("优化提示词", "Optimize Prompt")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={applyPromptOptimizerToDefaultHint}
                      disabled={!promptOptimizerResult}
                    >
                      {t("应用到默认提示词", "Apply to Default Hint")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={applyPromptOptimizerAsModelRule}
                      disabled={!promptOptimizerResult}
                    >
                      {t("生成为模型规则", "Create Model Rule")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void copyPromptOptimizerResult()}
                      disabled={!promptOptimizerResult}
                    >
                      {t("复制优化结果", "Copy Optimized Prompt")}
                    </Button>
                  </div>

                  {promptOptimizerError ? (
                    <p className="tc-upstream-advice">{promptOptimizerError}</p>
                  ) : null}

                  {promptOptimizerResult ? (
                    <>
                      <div className="tc-actions-row">
                        <Tag variant="light-outline">
                          family={promptOptimizerResult.profile.family}
                        </Tag>
                        <Tag variant="light-outline">
                          issue_tags={promptOptimizerResult.issueTags.length}
                        </Tag>
                        <Tag variant="light-outline">
                          est_tokens={promptOptimizerResult.metrics.estimatedTokens}
                        </Tag>
                        <Tag variant="light-outline">
                          source_failures={promptOptimizerResult.metrics.sourceFailureCount}
                        </Tag>
                      </div>

                      <CodeBlock
                        value={promptOptimizerResult.optimizedPrompt}
                        language="markdown"
                        maxHeight={360}
                      />

                      <p className="tc-upstream-advice">
                        {t(
                          "建议规则草稿（可直接用于模型规则导入）：",
                          "Suggested rule draft (ready for model-rule import):"
                        )}
                      </p>
                      <CodeBlock value={promptOptimizerSuggestedRulePreview} language="json" maxHeight={220} />
                    </>
                  ) : null}
                </section>
              ) : null}

              {routeModule === "export" ? (
                <SettingsExportPanel
                  t={t}
                  copyCcSwitchCodexAuthJson={copyCcSwitchCodexAuthJson}
                  downloadCcSwitchCodexAuthJson={downloadCcSwitchCodexAuthJson}
                  loading={loading}
                  keyForm={keyForm}
                  codexAuthJsonPreview={codexAuthJsonPreview}
                  copyCcSwitchCodexConfigToml={copyCcSwitchCodexConfigToml}
                  downloadCcSwitchCodexConfigToml={downloadCcSwitchCodexConfigToml}
                  codexConfigTomlPreview={codexConfigTomlPreview}
                  nativeCodexApplyPatchToolType={nativeCodexApplyPatchToolType}
                  setNativeCodexApplyPatchToolType={setNativeCodexApplyPatchToolType}
                  normalizeSelectValue={normalizeSelectValue}
                  nativeCodexExportBundle={nativeCodexExportBundle}
                  nativeCodexSelectedModelProfile={nativeCodexSelectedModelProfile}
                  selectedKey={selectedKey}
                  selectedChannelForKey={selectedChannelForKey}
                  formatGlmThinkingThresholdLabel={formatGlmThinkingThresholdLabel}
                  selectedKeyId={selectedKeyId}
                  copyNativeCodexBundleFile={copyNativeCodexBundleFile}
                  downloadNativeCodexBundleFile={downloadNativeCodexBundleFile}
                  nativeCodexEmptyState={nativeCodexEmptyState}
                  copyCcSwitchClaudeConfigJson={copyCcSwitchClaudeConfigJson}
                  downloadCcSwitchClaudeConfigJson={downloadCcSwitchClaudeConfigJson}
                  claudeConfigPreview={claudeConfigPreview}
                  openCcSwitchCodexImport={openCcSwitchCodexImport}
                  openCcSwitchClaudeImport={openCcSwitchClaudeImport}
                  copyCcSwitchCodexDeepLink={copyCcSwitchCodexDeepLink}
                  copyCcSwitchCodexContextPatch={copyCcSwitchCodexContextPatch}
                  copyCcSwitchClaudeDeepLink={copyCcSwitchClaudeDeepLink}
                  copyCcSwitchClaudeThinkingPatch={copyCcSwitchClaudeThinkingPatch}
                />
              ) : null}

              {routeModule === "upstream" ? (
                <SettingsUpstreamPanel
                  t={t}
                  applyCodingPreset={applyCodingPreset}
                  addUpstreamModel={addUpstreamModel}
                  handleQuickExportModels={handleQuickExportModels}
                  handleQuickCopyModels={handleQuickCopyModels}
                  handleOpenQuickImportDialog={handleOpenQuickImportDialog}
                  channelForm={channelForm}
                  setChannelForm={setChannelForm}
                  applyProviderPreset={applyProviderPreset}
                  normalizeSelectValue={normalizeSelectValue}
                  selectedChannel={selectedChannel}
                  isNewChannel={isNewChannel}
                  setChannelDefaultModel={setChannelDefaultModel}
                  channelModelOptions={channelModelOptions}
                  updateUpstreamModel={updateUpstreamModel}
                  formatGlmThinkingThresholdLabel={formatGlmThinkingThresholdLabel}
                  removeUpstreamModel={removeUpstreamModel}
                  testingUpstream={testingUpstream}
                  testingModelId={testingModelId}
                  testUpstreamModel={testUpstreamModel}
                  savingChannel={savingChannel}
                  loading={loading}
                  visionChannelOptions={visionChannelOptions}
                  resolveVisionModelOptions={resolveVisionModelOptions}
                  testPrompt={testPrompt}
                  setTestPrompt={setTestPrompt}
                  channelModelSearch={channelModelSearch}
                  setChannelModelSearch={setChannelModelSearch}
                  channelModelStatusFilter={channelModelStatusFilter}
                  setChannelModelStatusFilter={setChannelModelStatusFilter}
                  channelModelWireApiFilter={channelModelWireApiFilter}
                  setChannelModelWireApiFilter={setChannelModelWireApiFilter}
                  channelModelVisionFilter={channelModelVisionFilter}
                  setChannelModelVisionFilter={setChannelModelVisionFilter}
                  channelModelVisibleItems={channelModelVisibleItems}
                  channelModelActiveFilters={channelModelActiveFilters}
                  resetChannelModelFilters={resetChannelModelFilters}
                />
              ) : null}

              {routeModule === "logs" ? (
                <SettingsLogsPanel
                  t={t}
                  autoRefreshLogs={autoRefreshLogs}
                  setAutoRefreshLogs={setAutoRefreshLogs}
                  logLimit={logLimit}
                  setLogLimit={setLogLimit}
                  normalizeSelectValue={normalizeSelectValue}
                  clearApiLogs={clearApiLogs}
                  loadingLogs={loadingLogs}
                  apiLogs={filteredApiLogs}
                  loadedApiLogCount={apiLogs.length}
                  apiLogKeywordFilter={apiLogKeywordFilter}
                  setApiLogKeywordFilter={setApiLogKeywordFilter}
                  apiLogRouteFilter={apiLogRouteFilter}
                  apiLogRouteOptions={apiLogRouteOptions}
                  setApiLogRouteFilter={setApiLogRouteFilter}
                  apiLogMethodFilter={apiLogMethodFilter}
                  apiLogMethodOptions={apiLogMethodOptions}
                  setApiLogMethodFilter={setApiLogMethodFilter}
                  apiLogStatusFilter={apiLogStatusFilter}
                  setApiLogStatusFilter={setApiLogStatusFilter}
                  apiLogErrorOnly={apiLogErrorOnly}
                  setApiLogErrorOnly={setApiLogErrorOnly}
                  apiLogActiveFilters={apiLogActiveFilters}
                  resetApiLogFilters={resetApiLogFilters}
                  statusClassName={statusClassName}
                  statusTheme={statusTheme}
                />
              ) : null}

              {routeModule === "calls" ? (
                <SettingsCallsPanel
                  t={t}
                  autoRefreshAiCallLogs={autoRefreshAiCallLogs}
                  setAutoRefreshAiCallLogs={setAutoRefreshAiCallLogs}
                  aiCallLogLimit={aiCallLogLimit}
                  setAiCallLogLimit={setAiCallLogLimit}
                  normalizeSelectValue={normalizeSelectValue}
                  aiCallKeyFilter={aiCallKeyFilter}
                  aiCallKeyOptions={aiCallKeyOptions}
                  setAiCallKeyFilter={setAiCallKeyFilter}
                  aiCallModelFilter={aiCallModelFilter}
                  aiCallModelSelectOptions={aiCallModelSelectOptions}
                  setAiCallModelFilter={setAiCallModelFilter}
                  aiCallTypeFilter={aiCallTypeFilter}
                  aiCallTypeOptions={aiCallTypeOptions}
                  setAiCallTypeFilter={setAiCallTypeFilter}
                  aiCallDateRange={aiCallDateRange}
                  setAiCallDateRange={setAiCallDateRange}
                  aiCallKeywordFilter={aiCallKeywordFilter}
                  setAiCallKeywordFilter={setAiCallKeywordFilter}
                  aiCallRouteFilter={aiCallRouteFilter}
                  aiCallRouteOptions={aiCallRouteOptions}
                  setAiCallRouteFilter={setAiCallRouteFilter}
                  aiCallRequestWireFilter={aiCallRequestWireFilter}
                  aiCallRequestWireOptions={aiCallRequestWireOptions}
                  setAiCallRequestWireFilter={setAiCallRequestWireFilter}
                  aiCallUpstreamWireFilter={aiCallUpstreamWireFilter}
                  aiCallUpstreamWireOptions={aiCallUpstreamWireOptions}
                  setAiCallUpstreamWireFilter={setAiCallUpstreamWireFilter}
                  aiCallRequestedModelFilter={aiCallRequestedModelFilter}
                  aiCallRequestedModelOptions={aiCallRequestedModelOptions}
                  setAiCallRequestedModelFilter={setAiCallRequestedModelFilter}
                  aiCallClientModelFilter={aiCallClientModelFilter}
                  aiCallClientModelOptions={aiCallClientModelOptions}
                  setAiCallClientModelFilter={setAiCallClientModelFilter}
                  aiCallStreamFilter={aiCallStreamFilter}
                  aiCallStreamOptions={aiCallStreamOptions}
                  setAiCallStreamFilter={setAiCallStreamFilter}
                  applyAiCallQuickRange={applyAiCallQuickRange}
                  hasCustomAiCallDateRange={hasCustomAiCallDateRange}
                  expandVisibleAiCallLogs={expandVisibleAiCallLogs}
                  collapseVisibleAiCallLogs={collapseVisibleAiCallLogs}
                  expandedAiCallLogIds={expandedAiCallLogIds}
                  resetAiCallFilters={resetAiCallFilters}
                  clearAiCallLogs={clearAiCallLogs}
                  loadingAiCallLogs={loadingAiCallLogs}
                  aiCallStats={aiCallStats}
                  deferredAiCallLogs={deferredAiCallLogs}
                  aiCallActiveFilters={aiCallActiveFilters}
                  aiCallSavedPresets={aiCallSavedPresets}
                  aiCallSelectedPresetId={aiCallSelectedPresetId}
                  applyAiCallPresetById={applyAiCallPresetById}
                  saveAiCallPreset={saveAiCallPreset}
                  deleteAiCallPreset={deleteAiCallPreset}
                  expandedAiCallLogIdSet={expandedAiCallLogIdSet}
                  toggleAiCallLogExpanded={toggleAiCallLogExpanded}
                  setPreviewImage={setPreviewImage}
                />
              ) : null}

              {routeModule === "usage" ? (
                <SettingsUsagePanel
                  t={t}
                  normalizeSelectValue={normalizeSelectValue}
                  hasCustomUsageDateRange={hasCustomUsageDateRange}
                  usageMinutes={usageMinutes}
                  setUsageMinutes={setUsageMinutes}
                  setUsageDateRange={setUsageDateRange}
                  autoRefreshUsage={autoRefreshUsage}
                  setAutoRefreshUsage={setAutoRefreshUsage}
                  usageDateRange={usageDateRange}
                  usageMetric={usageMetric}
                  setUsageMetric={setUsageMetric}
                  usageBucketMode={usageBucketMode}
                  setUsageBucketMode={setUsageBucketMode}
                  usageKeyFilter={usageKeyFilter}
                  usageKeyOptions={usageKeyOptions}
                  setUsageKeyFilter={setUsageKeyFilter}
                  usageModelFilter={usageModelFilter}
                  usageModelOptions={usageModelOptions}
                  setUsageModelFilter={setUsageModelFilter}
                  usageRouteFilter={usageRouteFilter}
                  usageRouteOptions={usageRouteOptions}
                  setUsageRouteFilter={setUsageRouteFilter}
                  usageRequestWireFilter={usageRequestWireFilter}
                  usageRequestWireOptions={usageRequestWireOptions}
                  setUsageRequestWireFilter={setUsageRequestWireFilter}
                  usageUpstreamWireFilter={usageUpstreamWireFilter}
                  usageUpstreamWireOptions={usageUpstreamWireOptions}
                  setUsageUpstreamWireFilter={setUsageUpstreamWireFilter}
                  usageStreamFilter={usageStreamFilter}
                  usageStreamOptions={aiCallStreamOptions}
                  setUsageStreamFilter={setUsageStreamFilter}
                  usageTimelineLimit={usageTimelineLimit}
                  setUsageTimelineLimit={setUsageTimelineLimit}
                  loadUsageReport={loadUsageReport}
                  clearUsageReport={clearUsageReport}
                  resetUsageFilters={resetUsageFilters}
                  loadingUsage={loadingUsage}
                  usageReport={usageReport}
                  locale={locale}
                  usageActiveFilters={usageActiveFilters}
                  usageSavedPresets={usageSavedPresets}
                  usageSelectedPresetId={usageSelectedPresetId}
                  applyUsagePresetById={applyUsagePresetById}
                  saveUsagePreset={saveUsagePreset}
                  deleteUsagePreset={deleteUsagePreset}
                  usagePrimaryMetricMeta={usagePrimaryMetricMeta}
                  resolvedUsageBucketMinutes={resolvedUsageBucketMinutes}
                  usageTimelineChartData={usageTimelineChartData}
                  usageTimelineChartHeight={usageTimelineChartHeight}
                  usagePerKeyChartData={usagePerKeyChartData}
                  usagePerModelChartData={usagePerModelChartData}
                />
              ) : null}

              {routeModule === "docs" ? (
                <SettingsDocsPanel
                  t={t}
                  gatewayV1Endpoint={gatewayV1Endpoint}
                  gatewayOrigin={gatewayOrigin}
                  apiDocExamples={apiDocExamples}
                  copyTextToClipboard={copyTextToClipboard}
                  downloadApiDocExample={downloadApiDocExample}
                />
              ) : null}

              {routeModule === "runtime" ? (
                <SettingsRuntimePanel
                  t={t}
                  selectedKey={selectedKey}
                  runtimeModel={runtimeModel}
                  setRuntimeModel={setRuntimeModel}
                  syncDefaultModel={syncDefaultModel}
                  setSyncDefaultModel={setSyncDefaultModel}
                  switchingModel={switchingModel}
                  switchModel={switchModel}
                  loading={loading}
                  runtimeSwitchEndpoint={runtimeSwitchEndpoint}
                  runtimeApiExamples={runtimeApiExamples}
                  copyTextToClipboard={copyTextToClipboard}
                  downloadRuntimeApiExample={downloadRuntimeApiExample}
                />
              ) : null}
              {routeModule === "access" ? (
                <footer className="tc-footer-actions">
                  <div className="tc-footer-meta">
                    <p className={`tc-tip ${isKeyDirty ? "warn" : "ok"}`}>
                      {isNewKey
                        ? isKeyDirty
                          ? t(
                              "当前是新建 Key 草稿。保存前切换、刷新或离开页面时都会先提醒，避免新增内容直接消失。",
                              "This is a new key draft. Switching, refreshing, or leaving will now warn you first so new content does not disappear."
                            )
                          : t(
                              "当前是新建 Key 草稿。先补全名称、渠道和映射后再创建，页面会继续停留在刚创建成功的 Key 上。",
                              "This is a new key draft. Fill in the name, upstream, and mappings first, then create it. The page will stay on the newly created key afterward."
                            )
                        : isKeyDirty
                          ? t(
                              "当前 Key 还有未保存修改。你可以先保存，也可以点“恢复已保存”撤回这次编辑。",
                              "This key has unsaved changes. Save them now, or use Restore Saved to roll back this edit."
                            )
                          : t(
                              "当前草稿已与已保存数据同步。新增映射若未填完整，保存时会直接提示，不会再被静默丢弃。",
                              "The draft matches the saved data. Incomplete mappings are now blocked with a clear prompt instead of being silently dropped."
                            )}
                    </p>
                  </div>
                  {isKeyDirty ? (
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={restoreKeyDraft}
                      disabled={savingKey || loading}
                    >
                      {isNewKey ? t("重置草稿", "Reset Draft") : t("恢复已保存", "Restore Saved")}
                    </Button>
                  ) : null}
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

            <HiddenFileInput
              ref={bulkJsonFileInputRef}
              accept=".json,application/json"
              onChange={(event) => void handleBulkJsonFileChange(event)}
            />

            {compatPromptRulesImportDialogVisible ? (
              <BulkJsonImportDialog
                visible={compatPromptRulesImportDialogVisible}
                title={t("批量导入模型规则", "Bulk Import Model Rules")}
                description={t(
                  "先粘贴 JSON，或直接从剪贴板 / 文件载入；确认摘要后再决定追加还是覆盖。导入只更新当前草稿，仍需点击页面底部“保存提示词配置”才会生效。",
                  "Paste JSON first, or load it from the clipboard / a file; then choose append or replace after reviewing the summary. Import only updates the current draft, so you still need to click Save Prompt Config at the bottom."
                )}
                placeholder='{"modelPromptRules":[...]}\n\nor\n[{"id":"rule-1","upstreamModelPattern":"gpt-4.1-mini","hint":"..."}]'
                value={compatPromptRulesQuickImportJson}
                sourceLabel={compatPromptRulesQuickImportSource}
                idleHint={t(
                  "支持规则数组，或包含 modelPromptRules / compatPromptConfig.modelPromptRules 的对象。",
                  "Supports either a rules array, or an object containing modelPromptRules / compatPromptConfig.modelPromptRules."
                )}
                labels={bulkDialogLabels}
                preview={compatPromptRulesQuickImportPreview}
                appendLabel={t("追加到当前规则", "Append to Current Rules")}
                replaceLabel={t("覆盖当前规则", "Replace Current Rules")}
                appendDisabled={compatPromptRulesAppendDisabled}
                replaceDisabled={compatPromptRulesReplaceDisabled}
                onChange={handleCompatPromptRulesQuickImportJsonChange}
                onClose={() => setCompatPromptRulesImportDialogVisible(false)}
                onClear={() => clearBulkJsonImportDraft("compatPromptRules")}
                onLoadClipboard={() => void loadCompatPromptRulesFromClipboardToDraft()}
                onChooseFile={() => openCompatPromptRulesFileImporter()}
                onAppend={() => applyCompatPromptRulesQuickImport("append")}
                onReplace={() => applyCompatPromptRulesQuickImport("replace")}
              />
            ) : null}

            {compatPromptRulesExportDialogVisible ? (
              <BulkJsonExportDialog
                visible={compatPromptRulesExportDialogVisible}
                title={t("批量导出模型规则", "Bulk Export Model Rules")}
                description={t(
                  "导出使用标准对象格式 `{ modelPromptRules: [...] }`，可直接用于剪贴板分享、文件备份，或回填到导入弹窗中。",
                  "Export uses the standard `{ modelPromptRules: [...] }` object format, which is ready for clipboard sharing, file backup, or round-tripping into the import dialog."
                )}
                preview={compatPromptRulesExportPreviewJson}
                stats={[
                  { label: t("当前", "Current"), value: compatPromptRuleCount },
                  { label: t("启用", "Enabled"), value: compatPromptRuleEnabledCount }
                ]}
                closeLabel={t("关闭", "Close")}
                copyLabel={t("复制到剪贴板", "Copy to Clipboard")}
                downloadLabel={t("下载 JSON 文件", "Download JSON File")}
                onClose={() => setCompatPromptRulesExportDialogVisible(false)}
                onCopy={() => void copyCompatPromptRulesToClipboard("wrapped")}
                onDownload={() => downloadCompatPromptRulesJsonFile("wrapped")}
              />
            ) : null}

            {quickExportDialogVisible ? (
              <BulkJsonExportDialog
                visible={quickExportDialogVisible}
                title={t("批量导出模型池", "Bulk Export Model Pool")}
                description={t(
                  "以下 JSON 可保存到文件或粘贴到其他渠道的「批量导入」中。内部 ID 和 API Key 已移除，可安全分享。",
                  "Save this JSON to a file or paste it into another channel's Bulk Import dialog. Internal IDs and API keys are stripped for safe sharing."
                )}
                preview={upstreamModelsExportPreviewJson}
                stats={[
                  { label: t("当前", "Current"), value: channelForm.upstreamModels.length },
                  {
                    label: t("启用", "Enabled"),
                    value: channelForm.upstreamModels.filter((item) => item.enabled).length
                  }
                ]}
                closeLabel={t("关闭", "Close")}
                copyLabel={t("复制到剪贴板", "Copy to Clipboard")}
                downloadLabel={t("下载 JSON 文件", "Download JSON File")}
                onClose={() => setQuickExportDialogVisible(false)}
                onCopy={() => void handleQuickCopyModels()}
                onDownload={downloadUpstreamModelsJsonFile}
              />
            ) : null}

            {quickImportDialogVisible ? (
              <BulkJsonImportDialog
                visible={quickImportDialogVisible}
                title={t("批量导入模型池", "Bulk Import Model Pool")}
                description={t(
                  "先粘贴 JSON，或直接从剪贴板 / 文件载入；确认摘要后再决定追加还是覆盖。导入只更新当前草稿，仍需点击页面底部“保存渠道”才会生效。",
                  "Paste JSON first, or load it from the clipboard / a file; then choose append or replace after reviewing the summary. Import only updates the current draft, so you still need to click Save Upstream at the bottom."
                )}
                placeholder='{"version":1,"models":[...]}\n\nor\n[{"model":"glm-5","name":"GLM-5",...}]'
                value={quickImportJson}
                sourceLabel={quickImportSource}
                idleHint={t(
                  "支持模型快照 `{ models: [...] }`，也支持直接粘贴模型数组。",
                  "Supports model snapshots in `{ models: [...] }`, or a bare model array."
                )}
                labels={bulkDialogLabels}
                preview={upstreamModelsQuickImportPreview}
                appendLabel={t("追加到当前模型池", "Append to Current Model Pool")}
                replaceLabel={t("覆盖当前模型池", "Replace Current Model Pool")}
                appendDisabled={upstreamModelsAppendDisabled}
                replaceDisabled={upstreamModelsReplaceDisabled}
                onChange={handleQuickImportJsonChange}
                onClose={() => setQuickImportDialogVisible(false)}
                onClear={() => clearBulkJsonImportDraft("upstreamModels")}
                onLoadClipboard={() => void loadUpstreamModelsFromClipboardToDraft()}
                onChooseFile={openUpstreamModelsFileImporter}
                onAppend={handleQuickImportConfirm}
                onReplace={handleQuickImportReplace}
              />
            ) : null}

            {quickExportKeyMappingDialogVisible ? (
              <BulkJsonExportDialog
                visible={quickExportKeyMappingDialogVisible}
                title={t("批量导出模型映射", "Bulk Export Model Mappings")}
                description={t(
                  "以下 JSON 可粘贴到其他本地 Key 的「批量导入」中。内部映射 ID 已移除；映射级渠道绑定会附带渠道名，导入时优先按渠道名恢复。",
                  "Paste this JSON into another local key's Bulk Import dialog. Internal mapping IDs are removed, and mapping-level upstream bindings include channel names so import can restore them by name first."
                )}
                preview={keyMappingsExportPreviewJson}
                stats={[
                  { label: t("当前", "Current"), value: keyForm.modelMappings.length },
                  {
                    label: t("启用", "Enabled"),
                    value: keyForm.modelMappings.filter((item) => item.enabled).length
                  }
                ]}
                closeLabel={t("关闭", "Close")}
                copyLabel={t("复制到剪贴板", "Copy to Clipboard")}
                downloadLabel={t("下载 JSON 文件", "Download JSON File")}
                onClose={() => setQuickExportKeyMappingDialogVisible(false)}
                onCopy={() => void handleQuickCopyKeyMappings()}
                onDownload={downloadKeyMappingsJsonFile}
              />
            ) : null}

            {quickImportKeyMappingDialogVisible ? (
              <BulkJsonImportDialog
                visible={quickImportKeyMappingDialogVisible}
                title={t("批量导入模型映射", "Bulk Import Model Mappings")}
                description={t(
                  "先粘贴 JSON，或直接从剪贴板 / 文件载入；确认摘要后再决定追加还是覆盖。导入只更新当前草稿，仍需点击页面底部“保存 Key”才会生效。",
                  "Paste JSON first, or load it from the clipboard / a file; then choose append or replace after reviewing the summary. Import only updates the current draft, so you still need to click Save Key at the bottom."
                )}
                placeholder='{"version":1,"mappings":[...]}\n\nor\n[{"clientModel":"gpt-5.4","targetModel":"glm-5",...}]'
                value={quickImportKeyMappingJson}
                sourceLabel={quickImportKeyMappingSource}
                idleHint={t(
                  "支持映射快照 `{ mappings: [...] }`，也支持直接粘贴映射数组。",
                  "Supports mapping snapshots in `{ mappings: [...] }`, or a bare mapping array."
                )}
                labels={bulkDialogLabels}
                preview={keyMappingsQuickImportPreview}
                appendLabel={t("追加到当前映射", "Append to Current Mappings")}
                replaceLabel={t("覆盖当前映射", "Replace Current Mappings")}
                appendDisabled={keyMappingsAppendDisabled}
                replaceDisabled={keyMappingsReplaceDisabled}
                onChange={handleQuickImportKeyMappingJsonChange}
                onClose={() => setQuickImportKeyMappingDialogVisible(false)}
                onClear={() => clearBulkJsonImportDraft("keyMappings")}
                onLoadClipboard={() => void loadKeyMappingsFromClipboardToDraft()}
                onChooseFile={openKeyMappingsFileImporter}
                onAppend={() => handleQuickImportKeyMappings(false)}
                onReplace={() => handleQuickImportKeyMappings(true)}
              />
            ) : null}
          </Layout.Content>
        </main>
      </Layout>
    </div>
  );
}
