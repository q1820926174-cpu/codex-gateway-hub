import {
  Button,
  Checkbox,
  DateRangePicker,
  Input,
  Select,
  Switch,
  Tag
} from "tdesign-react";
import { CodeBlock } from "@/components/code-block";
import { JsonViewer } from "@/components/json-viewer";
import { UsageLoadingSkeleton } from "@/components/ui/UsageLoadingSkeleton";
import { UsagePieChart } from "@/components/ui/UsagePieChart";
import { UsageStatCard } from "@/components/ui/UsageStatCard";
import {
  AI_CALL_RANGE_OPTIONS,
  API_DOC_GATEWAY_ENDPOINTS,
  API_DOC_MANAGEMENT_ENDPOINTS,
  USAGE_METRIC_META,
  USAGE_RANGE_OPTIONS
} from "@/components/console/types";
import {
  MarkdownLogBlock,
  formatCnDate,
  formatNumber,
  pickUsageMetricValue,
  summarizeLogPreview
} from "@/components/console/settings-console-helpers";


export function SettingsRuntimePanel(props: any) {
  const {
    t,
    selectedKey,
    runtimeModel,
    setRuntimeModel,
    syncDefaultModel,
    setSyncDefaultModel,
    switchingModel,
    switchModel,
    loading,
    runtimeSwitchEndpoint,
    runtimeApiExamples,
    copyTextToClipboard,
    downloadRuntimeApiExample
  } = props;

  if (!selectedKey) {
    return (
      <section className="tc-section">
        <h3>{t("运行时调度", "Runtime")}</h3>
        <p className="tc-tip err">{t("请先创建并保存一个本地 Key。", "Create and save a local key first.")}</p>
      </section>
    );
  }

  return (
    <section className="tc-section">
      <h3>{t("运行时调度", "Runtime")}</h3>
      <div className="tc-meta-row">
        <Tag variant="light-outline">{t("当前默认模型", "Default Model")}: {selectedKey.defaultModel}</Tag>
        <Tag variant="light-outline">
          {t("绑定渠道", "Bound Upstream")}: {selectedKey.upstreamChannelName ?? "-"}
        </Tag>
      </div>
      <div className="tc-form-grid">
        <label className="tc-field tc-field-wide">
          <span>{t("运行时覆盖模型", "Runtime Override Model")}</span>
          <Input
            value={runtimeModel}
            onChange={(value) => setRuntimeModel(value)}
            placeholder={t("如：gpt-4.1 / glm-4-plus", "e.g. gpt-4.1 / glm-4-plus")}
            clearable
          />
        </label>

        <label className="tc-checkline">
          <Checkbox
            checked={syncDefaultModel}
            onChange={(checked) => setSyncDefaultModel(checked)}
          >
            {t("切换时同步更新默认模型", "Update default model together")}
          </Checkbox>
        </label>
      </div>

      <div className="tc-actions-row">
        <Button
          theme="primary"
          loading={switchingModel}
          onClick={() => void switchModel(false)}
          disabled={loading}
        >
          {t("应用运行时切换", "Apply Runtime Switch")}
        </Button>
        <Button
          theme="danger"
          variant="outline"
          onClick={() => void switchModel(true)}
          disabled={switchingModel || loading}
        >
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
          <div className="tc-log-panel tc-log-panel-full">
            <div className="tc-runtime-doc-head">
              <strong>{t("查询当前运行时状态（GET）", "Query Runtime Status (GET)")}</strong>
              <div className="tc-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    void copyTextToClipboard(
                      runtimeApiExamples.queryStatus,
                      t("查询命令已复制。", "Query command copied.")
                    )
                  }
                >
                  {t("复制命令", "Copy Command")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadRuntimeApiExample("queryStatus")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={runtimeApiExamples.queryStatus} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>{t("设置运行时覆盖模型（POST）", "Set Runtime Override (POST)")}</strong>
              <div className="tc-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    void copyTextToClipboard(
                      runtimeApiExamples.switchModel,
                      t("切换命令已复制。", "Switch command copied.")
                    )
                  }
                >
                  {t("复制命令", "Copy Command")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadRuntimeApiExample("switchModel")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={runtimeApiExamples.switchModel} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>{t("清空运行时覆盖（POST）", "Clear Runtime Override (POST)")}</strong>
              <div className="tc-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    void copyTextToClipboard(
                      runtimeApiExamples.clearOverride,
                      t("清空命令已复制。", "Clear command copied.")
                    )
                  }
                >
                  {t("复制命令", "Copy Command")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadRuntimeApiExample("clearOverride")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={runtimeApiExamples.clearOverride} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>{t("按 Key ID 启停（POST）", "Enable/Disable by Key ID (POST)")}</strong>
              <div className="tc-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    void copyTextToClipboard(
                      runtimeApiExamples.toggleEnabledById,
                      t("启停命令已复制。", "Enable/disable command copied.")
                    )
                  }
                >
                  {t("复制命令", "Copy Command")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadRuntimeApiExample("toggleEnabledById")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={runtimeApiExamples.toggleEnabledById} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>{t("POST 参数结构", "POST Payload")}</strong>
              <div className="tc-actions-row">
                <Button
                  size="small"
                  variant="outline"
                  onClick={() =>
                    void copyTextToClipboard(
                      runtimeApiExamples.payloadSchema,
                      t("参数结构已复制。", "Payload copied.")
                    )
                  }
                >
                  {t("复制结构", "Copy Payload")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadRuntimeApiExample("payloadSchema")}
                >
                  {t("下载结构", "Download Payload")}
                </Button>
              </div>
            </div>
            <CodeBlock value={runtimeApiExamples.payloadSchema} language="json" />
          </div>
        </div>
      </div>
    </section>
  );
}
