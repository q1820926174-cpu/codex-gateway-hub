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


export function SettingsDocsPanel(props: any) {
  const { t, gatewayV1Endpoint, gatewayOrigin, apiDocExamples, copyTextToClipboard } = props;
  return (
    <section className="tc-section">
      <h3>{t("本端接口文档", "Gateway API Documentation")}</h3>
      <p className="tc-upstream-advice">
        {t(
          "以下文档与当前服务端实现保持一致，包含网关推理接口和管理接口。网关鉴权使用本地 Key（不是上游 API Key）。",
          "This section mirrors the current server implementation, including gateway inference APIs and management APIs. Gateway auth uses local keys (not upstream API keys)."
        )}
      </p>

      <div className="tc-meta-row">
        <Tag variant="light-outline">{t("网关基地址", "Gateway Base URL")}: {gatewayV1Endpoint}</Tag>
        <Tag variant="light-outline">{t("管理基地址", "Management Base URL")}: {gatewayOrigin}/api</Tag>
        <Tag variant="light-outline">POST /v1/messages: x-api-key / Authorization</Tag>
      </div>

      <div className="tc-usage-grid">
        <div className="tc-usage-block">
          <h4>{t("网关推理接口", "Gateway Inference Endpoints")}</h4>
          <div className="tc-usage-table-wrap">
            <table className="tc-usage-table">
              <thead>
                <tr>
                  <th>{t("方法", "Method")}</th>
                  <th>{t("路径", "Path")}</th>
                  <th>{t("说明", "Description")}</th>
                </tr>
              </thead>
              <tbody>
                {API_DOC_GATEWAY_ENDPOINTS.map((item) => (
                  <tr key={`${item.method}-${item.path}`}>
                    <td><Tag variant="light-outline">{item.method}</Tag></td>
                    <td><code>{item.path}</code></td>
                    <td>{t(item.zh, item.en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="tc-usage-block">
          <h4>{t("管理与运维接口", "Management and Ops Endpoints")}</h4>
          <div className="tc-usage-table-wrap">
            <table className="tc-usage-table">
              <thead>
                <tr>
                  <th>{t("方法", "Method")}</th>
                  <th>{t("路径", "Path")}</th>
                  <th>{t("说明", "Description")}</th>
                </tr>
              </thead>
              <tbody>
                {API_DOC_MANAGEMENT_ENDPOINTS.map((item) => (
                  <tr key={`${item.method}-${item.path}`}>
                    <td><Tag variant="light-outline">{item.method}</Tag></td>
                    <td><code>{item.path}</code></td>
                    <td>{t(item.zh, item.en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="tc-runtime-doc">
        <h4>{t("调用示例", "Quick Examples")}</h4>
        <p className="tc-upstream-advice">
          {t(
            "示例中的本地 Key 会优先使用当前选中的 Key；若未选择，则使用占位符。",
            "Examples prefer the currently selected local key; otherwise they use a placeholder."
          )}
        </p>

        <div className="tc-log-panels">
          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>POST /v1/chat/completions</strong>
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  void copyTextToClipboard(
                    apiDocExamples.chatCompletions,
                    t("示例命令已复制。", "Example command copied.")
                  )
                }
              >
                {t("复制命令", "Copy Command")}
              </Button>
            </div>
            <CodeBlock value={apiDocExamples.chatCompletions} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>POST /v1/responses</strong>
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  void copyTextToClipboard(
                    apiDocExamples.responses,
                    t("示例命令已复制。", "Example command copied.")
                  )
                }
              >
                {t("复制命令", "Copy Command")}
              </Button>
            </div>
            <CodeBlock value={apiDocExamples.responses} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>POST /v1/messages</strong>
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  void copyTextToClipboard(
                    apiDocExamples.anthropicMessages,
                    t("示例命令已复制。", "Example command copied.")
                  )
                }
              >
                {t("复制命令", "Copy Command")}
              </Button>
            </div>
            <CodeBlock value={apiDocExamples.anthropicMessages} language="bash" />
          </div>
        </div>
      </div>
    </section>
  );
}

