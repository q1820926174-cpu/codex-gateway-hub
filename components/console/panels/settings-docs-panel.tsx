import {
  Button,
  Tag,
  type TableProps
} from "tdesign-react";
import { CodeBlock } from "@/components/code-block";
import { StaticTable } from "@/components/ui/StaticTable";
import {
  type ApiDocEndpoint,
  API_DOC_GATEWAY_ENDPOINTS,
  API_DOC_MANAGEMENT_ENDPOINTS
} from "@/components/console/types";

type ApiDocExampleKey = "chatCompletions" | "responses" | "anthropicMessages";
type DocsPanelExamples = Record<ApiDocExampleKey, string>;
type ApiDocTableRow = {
  id: string;
  method: ApiDocEndpoint["method"];
  path: string;
  description: string;
};

type SettingsDocsPanelProps = {
  t: (zh: string, en: string) => string;
  gatewayV1Endpoint: string;
  gatewayOrigin: string;
  apiDocExamples: DocsPanelExamples;
  copyTextToClipboard: (value: string, successMessage?: string) => Promise<void> | void;
  downloadApiDocExample: (key: ApiDocExampleKey) => void;
};

export function SettingsDocsPanel(props: SettingsDocsPanelProps) {
  const {
    t,
    gatewayV1Endpoint,
    gatewayOrigin,
    apiDocExamples,
    copyTextToClipboard,
    downloadApiDocExample
  } = props;
  const endpointColumns: NonNullable<TableProps<ApiDocTableRow>["columns"]> = [
    {
      colKey: "method",
      title: t("方法", "Method"),
      width: 120,
      cell: ({ row }) => <Tag variant="light-outline">{row.method}</Tag>
    },
    {
      colKey: "path",
      title: t("路径", "Path"),
      cell: ({ row }) => <code>{row.path}</code>
    },
    {
      colKey: "description",
      title: t("说明", "Description"),
      cell: ({ row }) => row.description
    }
  ];
  const gatewayEndpointRows: ApiDocTableRow[] = API_DOC_GATEWAY_ENDPOINTS.map((item) => ({
    id: `${item.method}-${item.path}`,
    method: item.method,
    path: item.path,
    description: t(item.zh, item.en)
  }));
  const managementEndpointRows: ApiDocTableRow[] = API_DOC_MANAGEMENT_ENDPOINTS.map((item) => ({
    id: `${item.method}-${item.path}`,
    method: item.method,
    path: item.path,
    description: t(item.zh, item.en)
  }));

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
            <StaticTable columns={endpointColumns} data={gatewayEndpointRows} className="tc-static-table" />
          </div>
        </div>

        <div className="tc-usage-block">
          <h4>{t("管理与运维接口", "Management and Ops Endpoints")}</h4>
          <div className="tc-usage-table-wrap">
            <StaticTable columns={endpointColumns} data={managementEndpointRows} className="tc-static-table" />
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
              <div className="tc-actions-row">
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
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadApiDocExample("chatCompletions")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={apiDocExamples.chatCompletions} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>POST /v1/responses</strong>
              <div className="tc-actions-row">
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
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadApiDocExample("responses")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={apiDocExamples.responses} language="bash" />
          </div>

          <div className="tc-log-panel">
            <div className="tc-runtime-doc-head">
              <strong>POST /v1/messages</strong>
              <div className="tc-actions-row">
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
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => downloadApiDocExample("anthropicMessages")}
                >
                  {t("下载命令", "Download Command")}
                </Button>
              </div>
            </div>
            <CodeBlock value={apiDocExamples.anthropicMessages} language="bash" />
          </div>
        </div>
      </div>
    </section>
  );
}
