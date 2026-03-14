"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { keysApi, upstreamsApi, logsApi, usageApi, configApi } from "@/lib/api";

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
  config: ["config"] as const
};

// Hook to fetch all gateway keys
// 获取所有网关密钥的 hook
export function useKeys() {
  return useQuery({ queryKey: queryKeys.keys, queryFn: () => keysApi.list() });
}
// Hook to fetch a single key by ID
// 根据 ID 获取单个密钥的 hook
export function useKey(id: number | null) {
  return useQuery({ queryKey: queryKeys.key(id!), queryFn: () => keysApi.get(id!), enabled: id !== null });
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
  return useQuery({ queryKey: queryKeys.upstreams, queryFn: () => upstreamsApi.list() });
}
// Hook to fetch a single upstream by ID
// 根据 ID 获取单个上游的 hook
export function useUpstream(id: number | null) {
  return useQuery({ queryKey: queryKeys.upstream(id!), queryFn: () => upstreamsApi.get(id!), enabled: id !== null });
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
  return useQuery({ queryKey: [...queryKeys.logs, params], queryFn: () => logsApi.getLogs(params) });
}
// Hook to fetch call logs with optional parameters
// 获取调用日志的 hook（带可选参数）
export function useCallLogs(params?: Record<string, string>) {
  return useQuery({ queryKey: [...queryKeys.callLogs, params], queryFn: () => logsApi.getCallLogs(params) });
}
// Hook to fetch usage report with optional parameters
// 获取用量报告的 hook（带可选参数）
export function useUsage(params?: Record<string, string>) {
  return useQuery({ queryKey: [...queryKeys.usage, params], queryFn: () => usageApi.getReport(params) });
}
// Hook to fetch gateway config
// 获取网关配置的 hook
export function useConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: configApi.getConfig });
}
