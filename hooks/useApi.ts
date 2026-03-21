"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { keysApi, upstreamsApi, logsApi, usageApi, configApi, promptLabApi } from "@/lib/api";
import type {
  AiCallLogEntry,
  AiCallLogFilterOptions,
  AiCallLogStats,
  ApiLogEntry,
  ChannelsResponse,
  GatewayKey,
  KeysResponse,
  UpstreamChannel,
  UsageReport
} from "@/components/console/types";
import type {
  ConfigSummaryResponse,
  PromptLabReportResponse,
  PromptLabRunSummaryResponse
} from "@/components/console/settings-console-helpers";
import type { RulePreviewResult } from "@/lib/prompt-lab-types";

type CallLogsResponse = {
  items: AiCallLogEntry[];
  models: string[];
  filterOptions: AiCallLogFilterOptions;
  stats: AiCallLogStats;
};

type LogsResponse = {
  items: ApiLogEntry[];
};

function sanitizeQueryParams(params?: Record<string, string>): Record<string, string> | undefined {
  if (!params) {
    return undefined;
  }
  const entries = Object.entries(params)
    .map(([key, value]) => [key, String(value ?? "").trim()] as const)
    .filter(([, value]) => value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

// Query keys for React Query cache management
// React Query 缓存管理的查询键
export const queryKeys = {
  // Query key for all keys list
  // 所有密钥列表的查询键
  keys: ["keys"] as const,
  // Query key for single key by ID
  // 单个密钥的查询键（按 ID）
  key: (id: number) => ["keys", id] as const,
  // Query key for all upstreams list
  // 所有上游列表的查询键
  upstreams: ["upstreams"] as const,
  // Query key for single upstream by ID
  // 单个上游的查询键（按 ID）
  upstream: (id: number) => ["upstreams", id] as const,
  // Query key for logs
  // 日志的查询键
  logs: ["logs"] as const,
  // Query key for call logs
  // 调用日志的查询键
  callLogs: ["call-logs"] as const,
  // Query key for usage report
  // 用量报告的查询键
  usage: ["usage"] as const,
  // Query key for config
  // 配置的查询键
  config: ["config"] as const,
  // Query key for prompt lab run
  // Prompt Lab 运行任务查询键
  promptLabRun: (id: string) => ["prompt-lab", "run", id] as const,
  // Query key for prompt lab report
  // Prompt Lab 报告查询键
  promptLabReport: (id: string) => ["prompt-lab", "report", id] as const
};

// Hook to fetch all gateway keys
// 获取所有网关密钥的 hook
export function useKeys() {
  return useQuery<KeysResponse>({
    queryKey: queryKeys.keys,
    queryFn: () => keysApi.list() as Promise<KeysResponse>
  });
}
// Hook to fetch a single key by ID
// 根据 ID 获取单个密钥的 hook
export function useKey(id: number | null) {
  return useQuery<GatewayKey>({
    queryKey: queryKeys.key(id!),
    queryFn: () => keysApi.get(id!) as Promise<GatewayKey>,
    enabled: id !== null
  });
}
// Hook to create a new key with mutation
// 创建新密钥的 mutation hook
export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: keysApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.keys }); } });
}
// Hook to update an existing key with mutation
// 更新现有密钥的 mutation hook
export function useUpdateKey() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, data }: { id: number; data: unknown }) => keysApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.keys }); } });
}
// Hook to delete a key with mutation
// 删除密钥的 mutation hook
export function useDeleteKey() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: keysApi.delete, onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.keys }); } });
}
// Hook to fetch all upstreams
// 获取所有上游的 hook
export function useUpstreams() {
  return useQuery<ChannelsResponse>({
    queryKey: queryKeys.upstreams,
    queryFn: () => upstreamsApi.list() as Promise<ChannelsResponse>
  });
}
// Hook to fetch a single upstream by ID
// 根据 ID 获取单个上游的 hook
export function useUpstream(id: number | null) {
  return useQuery<UpstreamChannel>({
    queryKey: queryKeys.upstream(id!),
    queryFn: () => upstreamsApi.get(id!) as Promise<UpstreamChannel>,
    enabled: id !== null
  });
}
// Hook to create a new upstream with mutation
// 创建新上游的 mutation hook
export function useCreateUpstream() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: upstreamsApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.upstreams }); } });
}
// Hook to update an existing upstream with mutation
// 更新现有上游的 mutation hook
export function useUpdateUpstream() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, data }: { id: number; data: unknown }) => upstreamsApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.upstreams }); } });
}
// Hook to delete an upstream with mutation
// 删除上游的 mutation hook
export function useDeleteUpstream() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: upstreamsApi.delete, onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.upstreams }); } });
}
// Hook to fetch logs with optional parameters
// 获取日志的 hook（带可选参数）
export function useLogs(params?: Record<string, string>) {
  const normalizedParams = sanitizeQueryParams(params);
  return useQuery<LogsResponse>({
    queryKey: [...queryKeys.logs, normalizedParams],
    queryFn: () => logsApi.getLogs(normalizedParams) as Promise<LogsResponse>
  });
}
// Hook to fetch call logs with optional parameters
// 获取调用日志的 hook（带可选参数）
export function useCallLogs(params?: Record<string, string>) {
  const normalizedParams = sanitizeQueryParams(params);
  return useQuery<CallLogsResponse>({
    queryKey: [...queryKeys.callLogs, normalizedParams],
    queryFn: () => logsApi.getCallLogs(normalizedParams) as Promise<CallLogsResponse>
  });
}
// Hook to fetch usage report with optional parameters
// 获取用量报告的 hook（带可选参数）
export function useUsage(params?: Record<string, string>) {
  const normalizedParams = sanitizeQueryParams(params);
  return useQuery<UsageReport>({
    queryKey: [...queryKeys.usage, normalizedParams],
    queryFn: () => usageApi.getReport(normalizedParams) as Promise<UsageReport>
  });
}
// Hook to fetch gateway config
// 获取网关配置的 hook
export function useConfig() {
  return useQuery<ConfigSummaryResponse>({
    queryKey: queryKeys.config,
    queryFn: () => configApi.getConfig() as Promise<ConfigSummaryResponse>
  });
}

// Hook to create a prompt lab run
// 创建 Prompt Lab 运行任务的 hook
export function useCreatePromptLabRun() {
  return useMutation({ mutationFn: promptLabApi.createRun });
}

// Hook to fetch prompt lab run progress
// 获取 Prompt Lab 任务进度的 hook
export function usePromptLabRun(id: string | null) {
  return useQuery<PromptLabRunSummaryResponse>({
    queryKey: queryKeys.promptLabRun(id ?? ""),
    queryFn: () => promptLabApi.getRun(id!) as Promise<PromptLabRunSummaryResponse>,
    enabled: !!id
  });
}

// Hook to fetch prompt lab report
// 获取 Prompt Lab 标准化报告的 hook
export function usePromptLabReport(id: string | null) {
  return useQuery<PromptLabReportResponse>({
    queryKey: queryKeys.promptLabReport(id ?? ""),
    queryFn: () => promptLabApi.getReport(id!) as Promise<PromptLabReportResponse>,
    enabled: !!id
  });
}

// Hook to preview prompt rule matching
// 预览提示词规则命中的 hook
export function usePromptLabRulePreview() {
  return useMutation<RulePreviewResult, Error, unknown>({
    mutationFn: (data) => promptLabApi.previewRule(data) as Promise<RulePreviewResult>
  });
}
