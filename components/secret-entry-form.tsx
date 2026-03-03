"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "tdesign-react";
import { useLocale } from "@/components/locale-provider";

type SecretEntryFormProps = {
  nextPath: string;
};

export function SecretEntryForm({ nextPath }: SecretEntryFormProps) {
  const router = useRouter();
  const { t } = useLocale();
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitSecret() {
    const trimmed = secret.trim();
    if (!trimmed) {
      setError(t("请输入访问暗号。", "Please enter the access secret."));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/secret-entry", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          secret: trimmed,
          next: nextPath
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        nextPath?: string;
      };

      if (!response.ok) {
        const backendError = payload.error ?? "";
        if (backendError.includes("暗号错误")) {
          setError(t("暗号错误，请重试。", "Incorrect secret. Please try again."));
        } else {
          setError(payload.error ?? t(`验证失败 (${response.status})`, `Validation failed (${response.status})`));
        }
        return;
      }

      router.replace(typeof payload.nextPath === "string" ? payload.nextPath : nextPath);
      router.refresh();
    } catch {
      setError(t("请求失败，请检查网络后重试。", "Request failed. Please check your network and retry."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tc-secret-page">
      <Card className="tc-secret-card" bordered>
        <h1 className="tc-secret-title">{t("请输入网页访问暗号", "Enter Website Access Secret")}</h1>
        <p className="tc-secret-tip">
          {t("已开启入口保护，验证通过后才能进入控制台。", "Entry protection is enabled. Verify first to enter the console.")}
        </p>

        <label className="tc-secret-field">
          <span>{t("访问暗号", "Access Secret")}</span>
          <Input
            type="password"
            value={secret}
            onChange={(value) => setSecret(value)}
            placeholder={t("请输入暗号", "Enter secret")}
            onEnter={() => void submitSecret()}
          />
        </label>

        {error ? <p className="tc-secret-error">{error}</p> : null}

        <div className="tc-secret-actions">
          <Button theme="primary" loading={submitting} onClick={() => void submitSecret()}>
            {t("进入控制台", "Enter Console")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
