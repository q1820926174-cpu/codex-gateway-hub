"use client";

import { Button, Tag } from "tdesign-react";
import { CodeBlock } from "@/components/code-block";
import { useLocale } from "@/components/locale-provider";
import {
  API_DOC_GATEWAY_ENDPOINTS,
  API_DOC_MANAGEMENT_ENDPOINTS
} from "@/components/console/types";
import { copyTextToClipboard } from "@/lib/console-utils";

type DocsModuleProps = {
  gatewayV1Endpoint: string;
  gatewayOrigin: string;
  apiDocExamples: {
    chatCompletions: string;
    responses: string;
    anthropicMessages: string;
  };
};

export function DocsModule({ gatewayV1Endpoint, gatewayOrigin, apiDocExamples }: DocsModuleProps) {
  const { t } = useLocale();

  const docSections = [
    {
      title: t("网关推理接口", "Gateway Inference Endpoints"),
      endpoints: API_DOC_GATEWAY_ENDPOINTS
    },
    {
      title: t("管理与运维接口", "Management and Ops Endpoints"),
      endpoints: API_DOC_MANAGEMENT_ENDPOINTS
    }
  ];

  const examplePanels = [
    { title: "POST /v1/chat/completions", content: apiDocExamples.chatCompletions, language: "bash" },
    { title: "POST /v1/responses", content: apiDocExamples.responses, language: "bash" },
    { title: "POST /v1/messages", content: apiDocExamples.anthropicMessages, language: "bash" }
  ];

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
        {docSections.map((section) => (
          <div key={section.title} className="tc-usage-block">
            <h4>{section.title}</h4>
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
                  {section.endpoints.map((ep) => (
                    <tr key={`${ep.method}-${ep.path}`}>
                      <td><Tag variant="light-outline">{ep.method}</Tag></td>
                      <td><code>{ep.path}</code></td>
                      <td>{t(ep.zh, ep.en)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
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
          {examplePanels.map((panel) => (
            <div key={panel.title} className="tc-log-panel">
              <div className="tc-runtime-doc-head">
                <strong>{panel.title}</strong>
                <Button size="small" variant="outline"
                  onClick={() => void copyTextToClipboard(panel.content, t("示例命令已复制。", "Example command copied."))}>
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
