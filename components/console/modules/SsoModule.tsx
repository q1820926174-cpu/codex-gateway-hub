"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Button, DialogPlugin, Input, MessagePlugin, Switch, Tag } from "tdesign-react";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { WorkspaceHero } from "@/components/console/workspace-hero";
import { humanizeConsoleErrorMessage } from "@/components/console/settings-console-helpers";
import { MODULE_SUMMARY } from "@/components/console/types";
import { SSO_PROVIDER_META } from "@/lib/sso/provider-meta";
import type { SsoProvider } from "@/lib/sso/session";

type SsoProviderStatus = {
  enabled: boolean;
  configured: boolean;
  source: "runtime" | "env";
  details: Record<string, boolean>;
};

type SsoStatusPayload = Partial<Record<SsoProvider, Partial<Record<string, unknown>>>>;
type SsoStatusMap = Record<SsoProvider, SsoProviderStatus>;

const RECOMMENDED_PROVIDER: SsoProvider = "github";

function localeKey(locale: string): "zh" | "en" {
  return locale === "en-US" ? "en" : "zh";
}

function createEmptySsoStatusMap(): SsoStatusMap {
  return SSO_PROVIDER_META.reduce(
    (acc, provider) => {
      acc[provider.key] = { enabled: false, configured: false, source: "env", details: {} };
      return acc;
    },
    {} as SsoStatusMap
  );
}

function normalizeSsoProviderStatus(
  payload: Partial<Record<string, unknown>> | undefined,
  provider: (typeof SSO_PROVIDER_META)[number]
): SsoProviderStatus {
  return {
    enabled: Boolean(payload?.enabled),
    configured: Boolean(payload?.configured),
    source: payload?.source === "runtime" ? "runtime" : "env",
    details: provider.configFields.reduce<Record<string, boolean>>((acc, field) => {
      acc[field.key] = Boolean(payload?.[field.key]);
      return acc;
    }, {})
  };
}

function sortProviders(a: SsoProviderStatus, b: SsoProviderStatus) {
  const weight = (s: SsoProviderStatus) => {
    if (s.enabled) return 0;
    if (s.configured) return 1;
    return 2;
  };
  return weight(a) - weight(b);
}

export function SsoModule() {
  const { t, locale } = useLocale();
  const [origin, setOrigin] = useState("");
  const [statusMap, setStatusMap] = useState<SsoStatusMap>(() => createEmptySsoStatusMap());
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [togglingProvider, setTogglingProvider] = useState<SsoProvider | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<SsoProvider | null>(RECOMMENDED_PROVIDER);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const applySsoStatus = useEffectEvent((payload?: SsoStatusPayload | null) => {
    if (!payload) { setStatusMap(createEmptySsoStatusMap()); return; }
    setStatusMap(
      SSO_PROVIDER_META.reduce((acc, provider) => {
        acc[provider.key] = normalizeSsoProviderStatus(payload[provider.key], provider);
        return acc;
      }, {} as SsoStatusMap)
    );
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingStatus(true);
      try {
        const res = await fetch("/api/sso/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load SSO status (${res.status})`);
        const data = (await res.json().catch(() => ({}))) as SsoStatusPayload;
        if (!cancelled) applySsoStatus(data);
      } catch {
        if (!cancelled) applySsoStatus(null);
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function loadSsoStatus(notifyFailure = false) {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/sso/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load SSO status (${res.status})`);
      const data = (await res.json().catch(() => ({}))) as SsoStatusPayload;
      applySsoStatus(data);
    } catch (error) {
      applySsoStatus(null);
      if (notifyFailure) {
        MessagePlugin.error(humanizeConsoleErrorMessage(error instanceof Error ? error.message : "Failed to load SSO status."));
      }
    } finally {
      setLoadingStatus(false);
    }
  }

  async function verifyActionSecret(secret: string) {
    const res = await fetch("/api/secret-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, next: "/console/sso" })
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Access secret verification failed (${res.status})`);
    }
  }

  const confirmPasswordAction = useEffectEvent((options: { header: string; body: string; confirmText: string }) =>
    new Promise<string | null>((resolve) => {
      let settled = false;
      let secretValue = "";
      const finish = (value: string | null) => { if (settled) return; settled = true; dialog.hide(); resolve(value); };
      const dialog = DialogPlugin.confirm({
        header: options.header,
        theme: "warning",
        confirmBtn: options.confirmText,
        cancelBtn: t("取消", "Cancel"),
        body: (
          <div className="tc-form-grid">
            <p className="tc-upstream-advice tc-field-wide">{options.body}</p>
            <label className="tc-field tc-field-wide">
              <span>{t("访问暗号", "Access Secret")}</span>
              <Input type="password" placeholder={t("请输入当前控制台访问暗号", "Enter the current console access secret")} onChange={(v) => { secretValue = v; }} />
            </label>
          </div>
        ),
        onConfirm: () => finish(secretValue),
        onCancel: () => finish(null),
        onClose: () => finish(null)
      });
    })
  );

  const toggleSsoProvider = useEffectEvent(async (provider: SsoProvider, nextEnabled: boolean) => {
    const meta = SSO_PROVIDER_META.find((p) => p.key === provider);
    if (!meta) return;
    const secret = await confirmPasswordAction({
      header: nextEnabled ? t(`启用 ${meta.label} SSO`, `Enable ${meta.label} SSO`) : t(`停用 ${meta.label} SSO`, `Disable ${meta.label} SSO`),
      body: nextEnabled
        ? t(`输入暗号后，将开启 ${meta.label} 单点登录。`, `Enter the secret to enable ${meta.label} SSO.`)
        : t(`输入暗号后，将停用 ${meta.label} 单点登录。`, `Enter the secret to disable ${meta.label} SSO.`),
      confirmText: nextEnabled ? t("启用", "Enable") : t("停用", "Disable")
    });
    if (secret === null) return;
    setTogglingProvider(provider);
    try {
      await verifyActionSecret(secret.trim());
      const res = await fetch(`/api/sso/${provider}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: nextEnabled }) });
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(p.error ?? (nextEnabled ? t(`启用 ${meta.label} SSO 失败`, `Failed to enable ${meta.label} SSO`) : t(`停用 ${meta.label} SSO 失败`, `Failed to disable ${meta.label} SSO`)) + ` (${res.status})`);
      }
      await loadSsoStatus();
      MessagePlugin.success(nextEnabled ? t(`${meta.label} 单点登录已启用。`, `${meta.label} SSO enabled.`) : t(`${meta.label} 单点登录已停用。`, `${meta.label} SSO disabled.`));
    } catch (error) {
      MessagePlugin.error(humanizeConsoleErrorMessage(error instanceof Error ? error.message : "Failed."));
    } finally {
      setTogglingProvider(null);
    }
  });

  const providerCards = useMemo(
    () => [...SSO_PROVIDER_META].sort((a, b) => sortProviders(statusMap[a.key], statusMap[b.key]) || a.label.localeCompare(b.label, "zh-CN")),
    [statusMap]
  );
  const enabledCount = providerCards.filter((p) => statusMap[p.key].enabled).length;
  const configuredCount = providerCards.filter((p) => statusMap[p.key].configured).length;
  const unconfiguredCount = providerCards.length - configuredCount;
  const noConfiguredProviders = configuredCount === 0;
  const recommendedProvider = providerCards.find((p) => p.key === RECOMMENDED_PROVIDER) ?? providerCards[0];

  const renderProviderDetails = (provider: (typeof SSO_PROVIDER_META)[number]) => {
    const status = statusMap[provider.key];
    const callbackUrl = origin ? `${origin}/api/sso/${provider.key}/callback` : `/api/sso/${provider.key}/callback`;
    return (
      <div className="tc-sso-details">
        <div className="tc-sso-details-grid">
          <div className="tc-sso-checklist" role="list">
            {provider.configFields.map((field, index) => {
              const done = Boolean(status.details[field.key]);
              return (
                <div key={field.key} className={`tc-sso-checklist-item ${done ? "is-complete" : "is-pending"}`}>
                  <span className="tc-sso-checklist-num">{index + 1}</span>
                  <div>
                    <strong>{provider.envVars[index] ?? field.label}</strong>
                    <p>{done ? t("已检测到配置", "Detected") : t("等待补齐", "Pending")}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="tc-sso-meta">
            <div><span>{t("回调地址", "Callback URL")}</span><code>{callbackUrl}</code></div>
            <div><span>{t("环境变量", "Environment Variables")}</span><p>{provider.envVars.join(", ")}</p></div>
            <div><span>{t("来源", "Source")}</span><p>{status.source === "runtime" ? t("运行时", "Runtime") : t("环境变量", "Environment")}</p></div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="tc-overview-zone">
      <WorkspaceHero
        title={t("单点登录 (SSO)", "Single Sign-On (SSO)")}
        subtitle={t("配置第三方 OAuth Provider，让用户通过 GitHub、GitLab 等账号直接登录控制台。", "Configure OAuth providers so users can sign in with GitHub, GitLab, or other accounts.")}
        stats={[
          { id: "enabled", label: t("已启用", "Enabled"), value: String(enabledCount), tone: "success" },
          { id: "configured", label: t("已配置", "Configured"), value: String(configuredCount), tone: "accent" },
          { id: "missing", label: t("待补齐", "Need setup"), value: String(unconfiguredCount), tone: "warning" }
        ]}
        actions={[
          { id: "refresh", label: t("刷新状态", "Refresh Status"), note: t("重新拉取所有 provider 状态", "Reload provider status"), onClick: () => { void loadSsoStatus(true); }, disabled: loadingStatus || Boolean(togglingProvider) },
          { id: "access", label: t("返回接入", "Open Access"), note: MODULE_SUMMARY.access[localeKey(locale)], href: "/console/access" }
        ]}
      />

      <section className="tc-section">
        <div className="tc-sso-section-head">
          <div>
            <h3>{t("Provider 状态", "Provider Status")}</h3>
            <p className="tc-upstream-advice">{t("按 provider 查看配置完成度与启用状态。补齐环境变量后即可打开开关。", "Review each provider's setup completeness and enablement.")}</p>
          </div>
          {!loadingStatus && noConfiguredProviders ? (
            <Tag theme="warning" variant="light-outline">{t(`建议优先配置 ${recommendedProvider.label}`, `Start with ${recommendedProvider.label}`)}</Tag>
          ) : null}
        </div>

        {loadingStatus ? (
          <div className="tc-sso-grid" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="tc-sso-card is-skeleton">
                <div className="tc-sso-sk" style={{ width: 140, height: 18 }} />
                <div className="tc-sso-sk" style={{ width: "100%", height: 8 }} />
                <div className="tc-sso-sk" style={{ width: "60%", height: 14 }} />
              </div>
            ))}
          </div>
        ) : noConfiguredProviders ? (
          <div className="tc-sso-card" role="status">
            <strong>{t("当前还没有可用的 SSO Provider", "No SSO provider is ready yet")}</strong>
            <p className="tc-upstream-advice">{t(`${recommendedProvider.label} 通常是最快完成接入的选项。`, `${recommendedProvider.label} is usually the fastest to set up.`)}</p>
            <div>
              <Button theme="primary" variant="outline" size="small" onClick={() => setExpandedProvider(recommendedProvider.key)}>
                {t(`查看 ${recommendedProvider.label} 配置`, `Review ${recommendedProvider.label}`)}
              </Button>
            </div>
          </div>
        ) : (
          <div className="tc-sso-grid">
            {providerCards.map((provider) => {
              const status = statusMap[provider.key];
              const done = provider.configFields.filter((f) => status.details[f.key]).length;
              const pct = Math.round((done / provider.configFields.length) * 100);
              const isToggling = togglingProvider === provider.key;
              const isExpanded = expandedProvider === provider.key;
              return (
                <article key={provider.key} className={`tc-sso-card ${status.enabled ? "is-enabled" : ""} ${!status.configured ? "is-unconfigured" : ""} ${isExpanded ? "is-expanded" : ""}`}>
                  <div className="tc-sso-card-head">
                    <div className="tc-sso-card-title">
                      <span className="tc-secret-sso-provider-badge">{provider.shortLabel}</span>
                      <div>
                        <strong>{provider.label}</strong>
                        <p>{provider.mode === "qrcode" ? t("扫码登录", "QR login") : t("跳转授权", "OAuth redirect")}</p>
                      </div>
                    </div>
                    <div className="tc-sso-card-controls">
                      <Tag theme={status.enabled ? "success" : status.configured ? "primary" : "warning"} variant="light-outline">
                        {status.enabled ? t("已启用", "Enabled") : status.configured ? t("待启用", "Ready") : t("待配置", "Needs setup")}
                      </Tag>
                      <Switch value={status.enabled} disabled={!status.configured || loadingStatus || Boolean(togglingProvider)} loading={isToggling} size="large" onChange={(v) => { void toggleSsoProvider(provider.key, Boolean(v)); }} />
                    </div>
                  </div>

                  <div className="tc-sso-progress">
                    <div className="tc-sso-progress-head">
                      <strong>{t("配置完成度", "Setup progress")}</strong>
                      <span>{done} / {provider.configFields.length}</span>
                    </div>
                    <div className="tc-sso-progress-track" aria-hidden>
                      <span className="tc-sso-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {!status.configured ? (
                    <div className="tc-sso-note">
                      <ShieldAlert size={16} />
                      <span>{t(`还缺少：${provider.envVars.join(", ")}`, `Missing: ${provider.envVars.join(", ")}`)}</span>
                    </div>
                  ) : null}

                  <button type="button" className="tc-sso-expand-btn" onClick={() => setExpandedProvider((c) => c === provider.key ? null : provider.key)} aria-expanded={isExpanded} aria-controls={`sso-details-${provider.key}`}>
                    <span>{isExpanded ? t("收起详情", "Hide details") : t("查看配置详情", "View setup details")}</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>

                  {isExpanded ? <div id={`sso-details-${provider.key}`}>{renderProviderDetails(provider)}</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
