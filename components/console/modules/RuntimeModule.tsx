"use client";

import { Button, Input, Checkbox, Tag } from "tdesign-react";
import { CodeBlock } from "@/components/code-block";
import { useLocale } from "@/components/locale-provider";
import { copyTextToClipboard } from "@/lib/console-utils";
import type { GatewayKey } from "@/components/console/types";

type RuntimeModuleProps = {
  selectedKey: GatewayKey | null;
  runtimeModel: string;
  syncDefaultModel: boolean;
  switchingModel: boolean;
  loading: boolean;
  runtimeSwitchEndpoint: string;
  runtimeApiExamples: {
    queryStatus: string;
    switchModel: string;
    clearOverride: string;
    toggleEnabledById: string;
    payloadSchema: string;
  };
  onRuntimeModelChange: (value: string) => void;
  onSyncDefaultModelChange: (checked: boolean) => void;
  onSwitchModel: (clear: boolean) => void;
};

export function RuntimeModule({
  selectedKey,
  runtimeModel,
  syncDefaultModel,
  switchingModel,
  loading,
  runtimeSwitchEndpoint,
  runtimeApiExamples,
  onRuntimeModelChange,
  onSyncDefaultModelChange,
  onSwitchModel
}: RuntimeModuleProps) {
  const { t } = useLocale();

  if (!selectedKey) {
    return (
      <section className="tc-section">
        <h3>{t("运行时调度", "Runtime")}</h3>
        <p className="tc-tip err">
          {t("请先创建并保存一个本地 Key。", "Create and save a local key first.")}
        </p>
      </section>
    );
  }

  const apiDocPanels = [
    { title: t("查询当前运行时状态（GET）", "Query Runtime Status (GET)"), content: runtimeApiExamples.queryStatus, language: "bash", full: true },
    { title: t("设置运行时覆盖模型（POST）", "Set Runtime Override (POST)"), content: runtimeApiExamples.switchModel, language: "bash" },
    { title: t("清空运行时覆盖（POST）", "Clear Runtime Override (POST)"), content: runtimeApiExamples.clearOverride, language: "bash" },
    { title: t("按 Key ID 启停（POST）", "Enable/Disable by Key ID (POST)"), content: runtimeApiExamples.toggleEnabledById, language: "bash" },
    { title: t("POST 参数结构", "POST Payload"), content: runtimeApiExamples.payloadSchema, language: "json" }
  ];

  return (
    <section className="tc-section">
      <h3>{t("运行时调度", "Runtime")}</h3>

      <div className="tc-meta-row">
        <Tag variant="light-outline">{t("当前默认模型", "Default Model")}: {selectedKey.defaultModel}</Tag>
        <Tag variant="light-outline">{t("绑定渠道", "Bound Upstream")}: {selectedKey.upstreamChannelName ?? "-"}</Tag>
      </div>

      <div className="tc-form-grid">
        <label className="tc-field tc-field-wide">
          <span>{t("运行时覆盖模型", "Runtime Override Model")}</span>
          <Input
            value={runtimeModel}
            onChange={onRuntimeModelChange}
            placeholder={t("如：gpt-4.1 / glm-4-plus", "e.g. gpt-4.1 / glm-4-plus")}
            clearable
          />
        </label>
        <label className="tc-checkline">
          <Checkbox checked={syncDefaultModel} onChange={onSyncDefaultModelChange}>
            {t("切换时同步更新默认模型", "Update default model together")}
          </Checkbox>
        </label>
      </div>

      <div className="tc-actions-row">
        <Button theme="primary" loading={switchingModel} onClick={() => onSwitchModel(false)} disabled={loading}>
          {t("应用运行时切换", "Apply Runtime Switch")}
        </Button>
        <Button theme="danger" variant="outline" onClick={() => onSwitchModel(true)} disabled={switchingModel || loading}>
          {t("清空覆盖", "Clear Override")}
        </Button>
      </div>

      <div className="tc-runtime-doc">
        <h4>{t("API 控制切换文档", "API Runtime Control Guide")}</h4>
        <p className="tc-upstream-advice">
          {t(
            "可通过接口查询当前生效模型、设置运行时覆盖、清空覆盖，以及启用/停用本地 Key。",
            "Use API to query effective model, set runtime override, clear override, and enable/disable local key."
          )}
        </p>
        <div className="tc-meta-row">
          <Tag variant="light-outline">GET {runtimeSwitchEndpoint}</Tag>
          <Tag variant="light-outline">POST {runtimeSwitchEndpoint}</Tag>
          <Tag variant="light-outline">selector=id/localKey/keyName/Bearer</Tag>
        </div>

        <div className="tc-log-panels">
          {apiDocPanels.map((panel) => (
            <div key={panel.title} className={`tc-log-panel${panel.full ? " tc-log-panel-full" : ""}`}>
              <div className="tc-runtime-doc-head">
                <strong>{panel.title}</strong>
                <Button size="small" variant="outline"
                  onClick={() => void copyTextToClipboard(panel.content, t("命令已复制。", "Command copied."))}>
                  {t("复制命令", "Copy Command")}
                </Button>
              </div>
              <CodeBlock value={panel.content} language={panel.language} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
