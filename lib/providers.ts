export const PROVIDERS = ["openai", "openrouter", "xai", "deepseek", "glm", "doubao", "custom"] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export const PROVIDER_DEFAULT_BASE_URL: Record<Exclude<ProviderName, "custom">, string> = {
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai/api",
  xai: "https://api.x.ai",
  deepseek: "https://api.deepseek.com",
  glm: "https://open.bigmodel.cn/api/coding/paas/v4",
  doubao: "https://ark.cn-beijing.volces.com/api/coding/v3"
};

export function defaultBaseUrlForProvider(provider: ProviderName): string | null {
  if (provider === "custom") {
    return null;
  }
  return PROVIDER_DEFAULT_BASE_URL[provider];
}

export function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function normalizeUpstreamModelCode(provider: string, model: string): string {
  const trimmed = model.trim();
  if (provider === "glm") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}
