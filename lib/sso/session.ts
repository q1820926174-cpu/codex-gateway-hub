export const SSO_PROVIDERS = ["github", "gitlab", "google", "wechat"] as const;

export type SsoProvider = (typeof SSO_PROVIDERS)[number];
