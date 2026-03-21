import { type ZodTypeAny } from "zod";
import { parseApiContract, resolveApiResponseSchema } from "@/lib/api-contract";

const API_BASE = "";

type FetchJsonOptions<T> = RequestInit & {
  schema?: ZodTypeAny;
};

function mergeJsonHeaders(headers?: HeadersInit) {
  const next = new Headers(headers);
  if (!next.has("content-type")) {
    next.set("Content-Type", "application/json");
  }
  return next;
}

async function readResponseBody(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildErrorMessage(url: string, response: Response, body: unknown) {
  const prefix = `API Error ${response.status} ${response.statusText} for ${url}`;
  if (body && typeof body === "object") {
    const candidate = body as { error?: unknown; message?: unknown; detail?: unknown };
    const message =
      (typeof candidate.error === "string" && candidate.error) ||
      (typeof candidate.message === "string" && candidate.message) ||
      (typeof candidate.detail === "string" && candidate.detail) ||
      "";
    if (message) {
      return `${prefix}: ${message}`;
    }
  }
  if (typeof body === "string" && body.trim()) {
    return `${prefix}: ${body.trim().slice(0, 240)}`;
  }
  return prefix;
}

// Fetch JSON data from API with error handling and optional schema validation
// 从 API  fetch JSON 数据，并在需要时做 schema 校验
async function fetchJson<T>(url: string, options?: FetchJsonOptions<T>): Promise<T> {
  const { schema, headers, ...requestInit } = options ?? {};
  const response = await fetch(`${API_BASE}${url}`, {
    ...requestInit,
    headers: mergeJsonHeaders(headers)
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(url, response, body));
  }

  const resolvedSchema = schema ?? resolveApiResponseSchema(url, requestInit.method);
  if (resolvedSchema) {
    return parseApiContract(resolvedSchema, body, `${requestInit.method ?? "GET"} ${url}`) as T;
  }

  return body as T;
}

// API endpoints for managing gateway keys
// 管理网关密钥的 API 端点
export const keysApi = {
  // List all keys
  // 列出所有密钥
  list: () => fetchJson("/api/keys"),
  // Get a key by ID
  // 根据 ID 获取密钥
  get: (id: number) => fetchJson(`/api/keys/${id}`),
  // Create a new key
  // 创建新密钥
  create: (data: unknown) => fetchJson("/api/keys", { method: "POST", body: JSON.stringify(data) }),
  // Update an existing key
  // 更新现有密钥
  update: (id: number, data: unknown) => fetchJson(`/api/keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  // Delete a key
  // 删除密钥
  delete: (id: number) => fetchJson(`/api/keys/${id}`, { method: "DELETE" }),
  // Switch model for a key
  // 为密钥切换模型
  switchModel: (data: unknown) => fetchJson("/api/keys/switch-model", { method: "POST", body: JSON.stringify(data) })
};

// API endpoints for managing upstream providers
// 管理上游提供商的 API 端点
export const upstreamsApi = {
  // List all upstreams
  // 列出所有上游
  list: () => fetchJson("/api/upstreams"),
  // Get an upstream by ID
  // 根据 ID 获取上游
  get: (id: number) => fetchJson(`/api/upstreams/${id}`),
  // Create a new upstream
  // 创建新上游
  create: (data: unknown) => fetchJson("/api/upstreams", { method: "POST", body: JSON.stringify(data) }),
  // Update an existing upstream
  // 更新现有上游
  update: (id: number, data: unknown) => fetchJson(`/api/upstreams/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  // Delete an upstream
  // 删除上游
  delete: (id: number) => fetchJson(`/api/upstreams/${id}`, { method: "DELETE" }),
  // Test an upstream configuration
  // 测试上游配置
  test: (data: unknown) => fetchJson("/api/upstreams/test", { method: "POST", body: JSON.stringify(data) })
};

// API endpoints for accessing logs
// 访问日志的 API 端点
export const logsApi = {
  // Get logs with optional parameters
  // 获取日志（带可选参数）
  getLogs: (params?: Record<string, string>) => {
    const sp = new URLSearchParams(params).toString();
    return fetchJson(`/api/logs${sp ? `?${sp}` : ""}`);
  },
  // Clear all logs
  // 清除所有日志
  clearLogs: () => fetchJson("/api/logs", { method: "DELETE" }),
  // Get call logs with optional parameters
  // 获取调用日志（带可选参数）
  getCallLogs: (params?: Record<string, string>) => {
    const sp = new URLSearchParams(params).toString();
    return fetchJson(`/api/call-logs${sp ? `?${sp}` : ""}`);
  },
  // Clear all call logs
  // 清除所有调用日志
  clearCallLogs: () => fetchJson("/api/call-logs", { method: "DELETE" })
};

// API endpoints for usage reporting
// 用量报告的 API 端点
export const usageApi = {
  // Get usage report
  // 获取用量报告
  getReport: (params?: Record<string, string>) => {
    const sp = new URLSearchParams(params).toString();
    return fetchJson(`/api/usage${sp ? `?${sp}` : ""}`);
  },
  // Clear usage data
  // 清除用量数据
  clear: () => fetchJson("/api/usage", { method: "DELETE" })
};

// API endpoints for configuration
// 配置相关的 API 端点
export const configApi = {
  // Get gateway configuration
  // 获取网关配置
  getConfig: () => fetchJson("/api/config")
};

// API endpoints for prompt lab
// Prompt Lab 相关 API 端点
export const promptLabApi = {
  // Create a prompt lab run
  // 创建 Prompt Lab 运行任务
  createRun: (data: unknown) => fetchJson("/api/prompt-lab/runs", { method: "POST", body: JSON.stringify(data) }),
  // Query run progress
  // 查询运行进度
  getRun: (id: string) => fetchJson(`/api/prompt-lab/runs/${encodeURIComponent(id)}`),
  // Fetch normalized report
  // 获取标准化报告
  getReport: (id: string) => fetchJson(`/api/prompt-lab/runs/${encodeURIComponent(id)}/report`),
  // Preview rule matching result
  // 预览规则命中结果
  previewRule: (data: unknown) =>
    fetchJson("/api/prompt-lab/rule-preview", { method: "POST", body: JSON.stringify(data) }),
  // Optimize third-party prompt for Codex compatibility
  // 将第三方提示词优化为更适配 Codex 的版本
  optimize: (data: unknown) =>
    fetchJson("/api/prompt-lab/optimize", { method: "POST", body: JSON.stringify(data) })
};
