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


export function SettingsLogsPanel(props: any) {
  const {
    t,
    autoRefreshLogs,
    setAutoRefreshLogs,
    logLimit,
    setLogLimit,
    normalizeSelectValue,
    clearApiLogs,
    loadingLogs,
    apiLogs,
    statusClassName,
    statusTheme
  } = props;

  return (
    <section className="tc-section">
      <h3>{t("接口访问日志", "API Access Logs")}</h3>
      <p className="tc-upstream-advice">
        {t(
          "按时间倒序展示网关收到的请求与返回结果。敏感字段已自动脱敏。",
          "Shows gateway requests/responses in reverse chronological order. Sensitive fields are redacted."
        )}
      </p>

      <div className="tc-log-toolbar">
        <div className="tc-log-toolbar-group">
          <label className="tc-switchline">
            <span>{t("自动刷新（3秒）", "Auto Refresh (3s)")}</span>
            <Switch
              value={autoRefreshLogs}
              onChange={(value) => setAutoRefreshLogs(Boolean(value))}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("拉取条数", "Fetch Limit")}</span>
            <Select
              value={String(logLimit)}
              options={[
                { label: "50 条", value: "50" },
                { label: "100 条", value: "100" },
                { label: "200 条", value: "200" },
                { label: "500 条", value: "500" }
              ]}
              style={{ width: 140 }}
              onChange={(value) => {
                const next = Number(normalizeSelectValue(value));
                if (Number.isFinite(next)) {
                  setLogLimit(next);
                }
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group tc-log-toolbar-actions">
          <Button
            variant="outline"
            theme="danger"
            onClick={() => void clearApiLogs()}
            disabled={loadingLogs}
          >
            {t("清空日志", "Clear Logs")}
          </Button>
        </div>
      </div>

      {apiLogs.length === 0 ? (
        <p className="tc-upstream-advice">
          {t("暂无日志。先调用一次接口后再查看。", "No logs yet. Send one request first.")}
        </p>
      ) : (
        <div className="tc-log-list">
          {apiLogs.map((item: any) => (
            <article
              className={`tc-log-item tc-log-item-${statusClassName(item.status)}`}
              key={`${item.id}-${item.createdAt}`}
            >
              <div className="tc-log-head">
                <div className="tc-log-head-main">
                  <div className="tc-log-tags">
                    <Tag theme={statusTheme(item.status)} variant="light-outline">
                      {item.status ?? "ERROR"}
                    </Tag>
                    <Tag variant="light-outline">{item.method}</Tag>
                    <Tag variant="light-outline">{item.route}</Tag>
                    <Tag variant="light-outline">{item.elapsedMs}ms</Tag>
                  </div>
                  <span className="tc-log-time">{formatCnDate(item.createdAt)}</span>
                </div>
                <div className="tc-log-subline">
                  <code className="tc-log-path">{item.path}</code>
                  <span className="tc-log-id">req#{item.id}</span>
                </div>
              </div>
              <div className="tc-log-panels">
                <div className="tc-log-panel">
                  <strong>{t("请求体", "Request Body")}</strong>
                  <JsonViewer value={item.requestBody} />
                </div>
                <div className={`tc-log-panel${item.error ? " tc-log-panel-error" : ""}`}>
                  <strong>{item.error ? t("错误", "Error") : t("响应体", "Response Body")}</strong>
                  <JsonViewer value={item.error ? item.error : item.responseBody} />
                </div>
              </div>
              <details className="tc-log-detail">
                <summary>{t("展开请求/响应头", "Expand Request/Response Headers")}</summary>
                <div className="tc-log-panels">
                  <div className="tc-log-panel">
                    <strong>{t("请求头", "Request Headers")}</strong>
                    <JsonViewer value={item.requestHeaders} />
                  </div>
                  <div className="tc-log-panel">
                    <strong>{t("响应头", "Response Headers")}</strong>
                    <JsonViewer value={item.responseHeaders} />
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

