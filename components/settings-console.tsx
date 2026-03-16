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
  createCodexExportBundle,
  type CodexApplyPatchToolType,
  type CodexExportBundle
} from "@/lib/codex-export";
import { CodeBlock } from "@/components/code-block";
import {
  parseOverflowModelSelection,
  serializeOverflowModelSelection
} from "@/lib/overflow-model";
import {
  quickExportKeyMappings,
  quickExportModels,
  quickImportKeyMappings,
  quickImportModels
} from "@/lib/quick-import-export";
import { JsonViewer } from "@/components/json-viewer";
import { useLocale } from "@/components/locale-provider";
import type {
  PromptLabFailureCase,
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
import {
  AI_CALL_RANGE_OPTIONS,
  API_DOC_GATEWAY_ENDPOINTS,
  API_DOC_MANAGEMENT_ENDPOINTS,
  CODING_PRESETS,
  DEFAULT_GATEWAY_ORIGIN,
  DOUBAO_THINKING_TYPES,
  EMPTY_AI_CALL_FILTER_OPTIONS,
  EMPTY_AI_CALL_STATS,
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
  UsageMetricKey,
  UsageReport,
  UsageTimelineRow
} from "@/components/console/types";
import {
  generateLocalKey,
  generateMappingId
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
  formatCompatPromptKeywordsInput,
  formatCompatPromptRulesJson,
  formatMinuteLabel,
  formatNumber,
  formatSignedNumber,
  humanizeConsoleErrorMessage,
  inferContextWindowFromModel,
  inspectCompatPromptRules,
  maskLocalKey,
  normalizeAiCallFilterOptions,
  normalizeCompatPromptRule,
  normalizeCompatPromptRules,
  normalizeGlmCodexThinkingThreshold,
  normalizeModelCode,
  normalizeSelectValue,
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
import {
  SettingsCallsPanel,
  SettingsDocsPanel,
  SettingsLogsPanel,
  SettingsRuntimePanel,
  SettingsUsagePanel
} from "@/components/console/settings-console-panels";
import {
  SettingsAccessPanel,
  SettingsExportPanel,
  SettingsPromptPanel,
  SettingsUpstreamPanel
} from "@/components/console/settings-console-editor-panels";

export type { EditorModule } from "@/components/console/types";
export { formatCompactNumber, formatNumber } from "@/components/console/settings-console-helpers";

type SettingsConsoleProps = {
  module?: EditorModule;
};

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
    const ruleCheckIssues = inspectCompatPromptRules(modelPromptRules);

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

  function downloadTextAsFile(fileName: string, content: string, mimeType = "application/json") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function downloadCompatPromptRulesJsonFile(format: "array" | "wrapped" = "wrapped") {
    const normalized = normalizeCompatPromptRules(compatPromptRulesDraft);
    const payload =
      format === "array"
        ? normalized
        : {
            modelPromptRules: normalized
          };
    const stamp = new Date().toISOString().replace(/[:]/g, "-");
    const suffix = format === "array" ? "rules-array" : "rules";
    const fileName = `compat-prompt-${suffix}-${stamp}.json`;
    downloadTextAsFile(fileName, `${JSON.stringify(payload, null, 2)}\n`);
    notifySuccess(
      t(
        "模型规则 JSON 已导出到文件。",
        "Model rules JSON has been exported to a file."
      )
    );
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
  const compatPromptRuleCheckIssues = inspectCompatPromptRules(compatPromptRulesDraft);
  const compatPromptRuleErrorCount = compatPromptRuleCheckIssues.filter(
    (item) => item.level === "error"
  ).length;
  const compatPromptRuleWarnCount = compatPromptRuleCheckIssues.filter(
    (item) => item.level === "warn"
  ).length;
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
  const promptLabCandidateModels = parsePromptLabModelListInput(promptLabCandidateModelsInput);
  const promptLabRunning =
    promptLabRunSummary?.status === "queued" || promptLabRunSummary?.status === "running";
  const promptLabBaselineMetrics =
    promptLabReport?.report.perModel.find(
      (item) => item.model.toLowerCase() === promptLabReport.report.baselineModel.toLowerCase()
    ) ?? null;
  const promptLabThresholds = promptLabReport?.thresholds ?? null;
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
                  compatPromptKeywordsInput={compatPromptKeywordsInput}
                  setCompatPromptKeywordsInput={setCompatPromptKeywordsInput}
                  compatPromptHintInput={compatPromptHintInput}
                  setCompatPromptHintInput={setCompatPromptHintInput}
                  compatPromptRuleCount={compatPromptRuleCount}
                  compatPromptRuleEnabledCount={compatPromptRuleEnabledCount}
                  compatPromptRuleSearch={compatPromptRuleSearch}
                  setCompatPromptRuleSearch={setCompatPromptRuleSearch}
                  addCompatPromptRule={addCompatPromptRule}
                  openCompatPromptRulesFileImporter={openCompatPromptRulesFileImporter}
                  compatPromptRulesFileInputRef={compatPromptRulesFileInputRef}
                  handleCompatPromptRulesFileChange={handleCompatPromptRulesFileChange}
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

              {routeModule === "export" ? (
                <SettingsExportPanel
                  t={t}
                  copyCcSwitchCodexAuthJson={copyCcSwitchCodexAuthJson}
                  loading={loading}
                  keyForm={keyForm}
                  codexAuthJsonPreview={codexAuthJsonPreview}
                  copyCcSwitchCodexConfigToml={copyCcSwitchCodexConfigToml}
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
                  nativeCodexEmptyState={nativeCodexEmptyState}
                  copyCcSwitchClaudeConfigJson={copyCcSwitchClaudeConfigJson}
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
                  apiLogs={apiLogs}
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
                  usageTimelineLimit={usageTimelineLimit}
                  setUsageTimelineLimit={setUsageTimelineLimit}
                  loadUsageReport={loadUsageReport}
                  clearUsageReport={clearUsageReport}
                  loadingUsage={loadingUsage}
                  usageReport={usageReport}
                  locale={locale}
                  usagePrimaryMetricMeta={usagePrimaryMetricMeta}
                  resolvedUsageBucketMinutes={resolvedUsageBucketMinutes}
                  usageTimelineChartOption={usageTimelineChartOption}
                  usageTimelineChartHeight={usageTimelineChartHeight}
                  usagePerKeyChartOption={usagePerKeyChartOption}
                  usagePerModelChartOption={usagePerModelChartOption}
                  ReactECharts={ReactECharts}
                />
              ) : null}

              {routeModule === "docs" ? (
                <SettingsDocsPanel
                  t={t}
                  gatewayV1Endpoint={gatewayV1Endpoint}
                  gatewayOrigin={gatewayOrigin}
                  apiDocExamples={apiDocExamples}
                  copyTextToClipboard={copyTextToClipboard}
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
                />
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
