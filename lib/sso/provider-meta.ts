import type { SsoProvider } from "@/lib/sso/session";

type SsoProviderConfigField = {
  key: string;
  label: string;
};

type SsoProviderMeta = {
  key: SsoProvider;
  label: string;
  shortLabel: string;
  mode: "redirect" | "qrcode";
  envVars: string[];
  configFields: SsoProviderConfigField[];
};

export const SSO_PROVIDER_META: SsoProviderMeta[] = [
  {
    key: "github",
    label: "GitHub",
    shortLabel: "GH",
    mode: "redirect",
    envVars: ["SSO_GITHUB_CLIENT_ID", "SSO_GITHUB_CLIENT_SECRET"],
    configFields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" }
    ]
  },
  {
    key: "gitlab",
    label: "GitLab",
    shortLabel: "GL",
    mode: "redirect",
    envVars: ["SSO_GITLAB_CLIENT_ID", "SSO_GITLAB_CLIENT_SECRET"],
    configFields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" }
    ]
  },
  {
    key: "google",
    label: "Google",
    shortLabel: "GO",
    mode: "redirect",
    envVars: ["SSO_GOOGLE_CLIENT_ID", "SSO_GOOGLE_CLIENT_SECRET"],
    configFields: [
      { key: "clientId", label: "Client ID" },
      { key: "clientSecret", label: "Client Secret" }
    ]
  },
  {
    key: "wechat",
    label: "WeChat",
    shortLabel: "WX",
    mode: "qrcode",
    envVars: ["SSO_WECHAT_APP_ID", "SSO_WECHAT_APP_SECRET"],
    configFields: [
      { key: "appId", label: "App ID" },
      { key: "appSecret", label: "App Secret" }
    ]
  }
];
