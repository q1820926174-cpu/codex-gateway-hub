"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "tdesign-react";
import { useLocale } from "@/components/locale-provider";

// Props type for SecretEntryForm component
// SecretEntryForm 组件的属性类型
type SecretEntryFormProps = {
  // Path to redirect after successful entry
  // 成功进入后重定向的路径
  nextPath: string;
};

// Secret entry form component for gateway authentication
// 用于网关认证的密钥入口表单组件
export function SecretEntryForm({ nextPath }: SecretEntryFormProps) {
  const router = useRouter();
  const { t } = useLocale();
  const errorRef = useRef<HTMLParagraphElement>(null);
  // State for secret input
  // 密钥输入状态
  const [secret, setSecret] = useState("");
  // State for submission loading
  // 提交加载状态
  const [submitting, setSubmitting] = useState(false);
  // State for error messages
  // 错误消息状态
  const [error, setError] = useState("");
  const secretHelpId = "secret-entry-help";
  const secretErrorId = "secret-entry-error";

  // Submit secret for verification
  // 提交密钥进行验证
  async function submitSecret(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = secret.trim();
    // Validate secret is not empty
    // 验证密钥不为空
    if (!trimmed) {
      setError(t("请输入访问暗号。", "Please enter the access secret."));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      // Call secret entry API
      // 调用密钥入口 API
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
        // Handle specific error messages
        // 处理特定的错误消息
        if (backendError.includes("暗号错误")) {
          setError(t("暗号错误，请重试。", "Incorrect secret. Please try again."));
        } else {
          setError(payload.error ?? t(`验证失败 (${response.status})`, `Validation failed (${response.status})`));
        }
        return;
      }

      // Redirect to next path on success
      // 成功后重定向到下一路径
      router.replace(typeof payload.nextPath === "string" ? payload.nextPath : nextPath);
      router.refresh();
    } catch {
      // Handle network errors
      // 处理网络错误
      setError(t("请求失败，请检查网络后重试。", "Request failed. Please check your network and retry."));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  return (
    <div className="tc-secret-page">
      <Card className="tc-secret-card" bordered>
        {/* Form title */}
        {/* 表单标题 */}
        <h1 className="tc-secret-title">{t("请输入网页访问暗号", "Enter Website Access Secret")}</h1>
        <form onSubmit={submitSecret} noValidate>
          {/* Form description */}
          {/* 表单描述 */}
          <p className="tc-secret-tip" id={secretHelpId}>
            {t("已开启入口保护，验证通过后才能进入控制台。", "Entry protection is enabled. Verify first to enter the console.")}
          </p>

          {/* Secret input field */}
          {/* 密钥输入字段 */}
          <label className="tc-secret-field">
            <span>{t("访问暗号", "Access Secret")}</span>
            <Input
              name="access-secret"
              type="password"
              autocomplete="off"
              value={secret}
              onChange={(value) => setSecret(value)}
              placeholder={t("请输入暗号", "Enter secret")}
              aria-describedby={error ? `${secretHelpId} ${secretErrorId}` : secretHelpId}
              aria-invalid={Boolean(error)}
            />
          </label>

          {/* Error message display */}
          {/* 错误消息显示 */}
          {error ? (
            <p
              ref={errorRef}
              id={secretErrorId}
              className="tc-secret-error"
              role="alert"
              aria-live="polite"
              tabIndex={-1}
            >
              {error}
            </p>
          ) : null}

          {/* Submit button */}
          {/* 提交按钮 */}
          <div className="tc-secret-actions">
            <Button type="submit" theme="primary" loading={submitting}>
              {t("进入控制台", "Enter Console")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
