// List of supported AI providers
// 支持的 AI 提供商列表
export const PROVIDERS = ["openai", "anthropic", "openrouter", "xai", "deepseek", "glm", "doubao", "custom"] as const;

// Type definition for provider names
// 提供商名称的类型定义
export type ProviderName = (typeof PROVIDERS)[number];

// Default base URLs for each provider (excluding custom)
// 每个提供商的默认基础 URL（不包括自定义）
export const PROVIDER_DEFAULT_BASE_URL: Record<Exclude<ProviderName, "custom">, string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api",
  xai: "https://api.x.ai",
  deepseek: "https://api.deepseek.com",
  glm: "https://open.bigmodel.cn/api/coding/paas/v4",
  doubao: "https://ark.cn-beijing.volces.com/api/coding/v3"
};

// Get default base URL for a given provider
// 获取指定提供商的默认基础 URL
export function defaultBaseUrlForProvider(provider: ProviderName): string | null {
  if (provider === "custom") {
    return null;
  }
  return PROVIDER_DEFAULT_BASE_URL[provider];
}

// Sanitize base URL by trimming whitespace and removing trailing slashes
// 清理基础 URL - 去除空格和尾部斜杠
export function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

// Normalize upstream model code based on provider
// 根据提供商标准化上游模型代码
export function normalizeUpstreamModelCode(provider: string, model: string): string {
  const trimmed = model.trim();
  if (provider === "glm") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}
