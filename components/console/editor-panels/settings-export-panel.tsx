// @ts-nocheck
"use client";

import {
  Button,
  Checkbox,
  Input,
  Select,
  Switch,
  Tabs,
  Tag,
  Textarea
} from "tdesign-react";
import { CodeBlock } from "@/components/code-block";
import {
  CODING_PRESETS,
  DOUBAO_THINKING_TYPES,
  GLM_CODEX_THINKING_THRESHOLDS,
  PROVIDERS,
  PROVIDER_META,
  UPSTREAM_WIRE_APIS
} from "@/components/console/types";
import type {
  ProviderName,
  UpstreamWireApi
} from "@/components/console/types";
import {
  normalizeGlmCodexThinkingThreshold,
  shouldShowDoubaoThinkingType,
  shouldShowGlmThinkingThreshold
} from "@/components/console/settings-console-helpers";
import type { CodexApplyPatchToolType } from "@/lib/codex-export";

type AnyStateSetter = (updater: any | ((prev: any) => any)) => void;
type AnyItemUpdater = (id: any, updater: (prev: any) => any) => void;
type AnyRuleUpdater = (index: any, updater: (prev: any) => any) => void;

type SettingsAccessPanelProps = {
  setKeyForm: AnyStateSetter;
  updateKeyModelMapping: AnyItemUpdater;
  [key: string]: any;
};

type SettingsPromptPanelProps = {
  updateCompatPromptRule: AnyRuleUpdater;
  setShowCompatPromptRulesJsonEditor: AnyStateSetter;
  [key: string]: any;
};

type SettingsExportPanelProps = {
  [key: string]: any;
};

type SettingsUpstreamPanelProps = {
  setChannelForm: AnyStateSetter;
  updateUpstreamModel: AnyItemUpdater;
  [key: string]: any;
};


export function SettingsExportPanel(props: SettingsExportPanelProps) {
  const {
    t,
    copyCcSwitchCodexAuthJson,
    downloadCcSwitchCodexAuthJson,
    loading,
    keyForm,
    codexAuthJsonPreview,
    copyCcSwitchCodexConfigToml,
    downloadCcSwitchCodexConfigToml,
    codexConfigTomlPreview,
    nativeCodexApplyPatchToolType,
    setNativeCodexApplyPatchToolType,
    normalizeSelectValue,
    nativeCodexExportBundle,
    nativeCodexSelectedModelProfile,
    selectedKey,
    selectedChannelForKey,
    formatGlmThinkingThresholdLabel,
    selectedKeyId,
    copyNativeCodexBundleFile,
    downloadNativeCodexBundleFile,
    nativeCodexEmptyState,
    copyCcSwitchClaudeConfigJson,
    downloadCcSwitchClaudeConfigJson,
    claudeConfigPreview,
    openCcSwitchCodexImport,
    openCcSwitchClaudeImport,
    copyCcSwitchCodexDeepLink,
    copyCcSwitchCodexContextPatch,
    copyCcSwitchClaudeDeepLink,
    copyCcSwitchClaudeThinkingPatch
  } = props;

  return (
                <section className="tc-section">
                  <h3>{t("配置导出与导入", "Export and Import")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "这里集中展示 CC Switch 导入配置、原生 Codex 导出片段和 Claude Code 预览，不再和 Key 编辑表单混在一起。",
                      "This page centralizes CC Switch import configs, native Codex export snippets, and Claude Code previews instead of mixing them into the key editor."
                    )}
                  </p>
                  <p className="tc-tip">
                    {t(
                      "提示：CC Switch 当前 deep link 在 Codex/Claude 场景都可能丢失部分高级变量（例如 Codex 上下文窗口、Claude 上下文窗口/Thinking 变量）。导入后可点对应“补丁复制”按钮粘贴到 CC Switch 配置中。",
                      "Tip: CC Switch deep link may drop advanced variables for Codex/Claude (for example Codex context window and Claude context-window/thinking variables). After import, use the patch-copy buttons and paste into CC Switch config."
                    )}
                  </p>

                  <div className="tc-runtime-doc">
                    <div className="tc-runtime-doc-head">
                      <h4>{t("Codex auth.json 预览", "Codex auth.json Preview")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => void copyCcSwitchCodexAuthJson()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("一键复制 auth.json（含密钥）", "Copy auth.json (with key)")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => downloadCcSwitchCodexAuthJson()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("下载 auth.json", "Download auth.json")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        codexAuthJsonPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="json"
                    />
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：这里对应 CC Switch 的 auth.json；预览与复制都会显示完整真实密钥。",
                        "Note: This maps to CC Switch auth.json. Both preview and copy include the full real key."
                      )}
                    </p>
                    <div className="tc-runtime-doc-head">
                      <h4>{t("Codex config.toml 预览", "Codex config.toml Preview")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => void copyCcSwitchCodexConfigToml()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("一键复制 config.toml", "Copy config.toml")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => downloadCcSwitchCodexConfigToml()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("下载 config.toml", "Download config.toml")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        codexConfigTomlPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="toml"
                    />

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex CLI 导出", "Native Codex CLI Export")}</h4>
                      <Tag theme="primary" variant="light-outline">
                        {t("推荐", "Recommended")}
                      </Tag>
                    </div>
                    <Tabs
                      value={nativeCodexApplyPatchToolType}
                      size="medium"
                      theme="card"
                      onChange={(value) =>
                        setNativeCodexApplyPatchToolType(
                          normalizeSelectValue(value) as CodexApplyPatchToolType
                        )
                      }
                    >
                      <Tabs.TabPanel
                        value="function"
                        label={t("Function（推荐）", "Function (Recommended)")}
                      />
                      <Tabs.TabPanel value="freeform" label="Freeform" />
                    </Tabs>
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：CC Switch 导入仍是旧流程。原生 Codex 要让第三方模型稳定支持 apply_patch，还需要同时配置 `model_catalog_json` 与 `model_instructions_file`；`AGENTS.md` 为可选工作区补充。",
                        "Note: CC Switch import remains the legacy flow. Native Codex needs both `model_catalog_json` and `model_instructions_file` for stable third-party apply_patch support; `AGENTS.md` is an optional workspace supplement."
                      )}
                    </p>
                    {nativeCodexExportBundle ? (
                      <div className="tc-meta-row">
                        <Tag theme="primary" variant="light-outline">
                          {t("当前模型", "Selected Model")}: {nativeCodexExportBundle.selectedModel}
                        </Tag>
                        <Tag variant="light-outline">
                          {t("导出模型数", "Exported Models")}: {nativeCodexExportBundle.exportedModels.length}
                        </Tag>
                        <Tag variant="light-outline">
                          apply_patch: {nativeCodexExportBundle.applyPatchToolType}
                        </Tag>
                        {nativeCodexSelectedModelProfile &&
                        shouldShowGlmThinkingThreshold(
                          selectedKey?.provider ?? selectedChannelForKey?.provider ?? "openai",
                          nativeCodexSelectedModelProfile.model
                        ) ? (
                          <Tag variant="light-outline">
                            {t("GLM 深度思考", "GLM Deep Thinking")}:{" "}
                            {formatGlmThinkingThresholdLabel(
                              nativeCodexSelectedModelProfile.glmCodexThinkingThreshold
                            )}
                          </Tag>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedKeyId !== null ? (
                      <p className="tc-upstream-advice">
                        {t(
                          "已保存 Key 也可通过 `/api/keys/:id/codex-export` 获取相同导出结果。",
                          "Saved keys can also fetch the same bundle from `/api/keys/:id/codex-export`."
                        )}
                      </p>
                    ) : null}

                    <div className="tc-runtime-doc-head">
                      <h4>{t("~/.codex/.env 片段", "~/.codex/.env Snippet")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            void copyNativeCodexBundleFile(
                              "envSnippet",
                              t("原生 Codex .env 片段已复制。", "Native Codex .env snippet copied."),
                              t("复制原生 Codex .env 片段失败", "Failed to copy native Codex .env snippet")
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("复制 .env 片段", "Copy .env Snippet")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            downloadNativeCodexBundleFile(
                              "envSnippet",
                              ".env",
                              t("原生 Codex .env 片段已下载。", "Native Codex .env snippet downloaded."),
                              t("下载原生 Codex .env 片段失败", "Failed to download native Codex .env snippet")
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("下载 .env 片段", "Download .env Snippet")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={nativeCodexExportBundle?.files.envSnippet.content || nativeCodexEmptyState}
                      language="dotenv"
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.envSnippet.targetPath ?? "~/.codex/.env"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex config.toml 片段", "Native Codex config.toml Snippet")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            void copyNativeCodexBundleFile(
                              "configTomlSnippet",
                              t("原生 Codex config.toml 片段已复制。", "Native Codex config.toml snippet copied."),
                              t(
                                "复制原生 Codex config.toml 片段失败",
                                "Failed to copy native Codex config.toml snippet"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("复制原生 config.toml", "Copy Native config.toml")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            downloadNativeCodexBundleFile(
                              "configTomlSnippet",
                              "config.toml",
                              t("原生 Codex config.toml 片段已下载。", "Native Codex config.toml snippet downloaded."),
                              t(
                                "下载原生 Codex config.toml 片段失败",
                                "Failed to download native Codex config.toml snippet"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("下载原生 config.toml", "Download Native config.toml")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.configTomlSnippet.content || nativeCodexEmptyState
                      }
                      language="toml"
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.configTomlSnippet.targetPath ?? "~/.codex/config.toml"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex model_catalog_json", "Native Codex model_catalog_json")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            void copyNativeCodexBundleFile(
                              "modelCatalogJson",
                              t(
                                "原生 Codex model_catalog_json 已复制。",
                                "Native Codex model_catalog_json copied."
                              ),
                              t(
                                "复制原生 Codex model_catalog_json 失败",
                                "Failed to copy native Codex model_catalog_json"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("复制 model_catalog_json", "Copy model_catalog_json")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            downloadNativeCodexBundleFile(
                              "modelCatalogJson",
                              "export.catalog.json",
                              t(
                                "原生 Codex model_catalog_json 已下载。",
                                "Native Codex model_catalog_json downloaded."
                              ),
                              t(
                                "下载原生 Codex model_catalog_json 失败",
                                "Failed to download native Codex model_catalog_json"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("下载 model_catalog_json", "Download model_catalog_json")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.modelCatalogJson.content || nativeCodexEmptyState
                      }
                      language="json"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.modelCatalogJson.targetPath ??
                        "~/.codex/codex-gateway-hub/export.catalog.json"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("原生 Codex instructions", "Native Codex instructions")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            void copyNativeCodexBundleFile(
                              "modelInstructionsMd",
                              t("原生 Codex instructions 已复制。", "Native Codex instructions copied."),
                              t(
                                "复制原生 Codex instructions 失败",
                                "Failed to copy native Codex instructions"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("复制 instructions", "Copy instructions")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            downloadNativeCodexBundleFile(
                              "modelInstructionsMd",
                              "export.instructions.md",
                              t("原生 Codex instructions 已下载。", "Native Codex instructions downloaded."),
                              t(
                                "下载原生 Codex instructions 失败",
                                "Failed to download native Codex instructions"
                              )
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("下载 instructions", "Download instructions")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        nativeCodexExportBundle?.files.modelInstructionsMd.content || nativeCodexEmptyState
                      }
                      language="markdown"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.modelInstructionsMd.targetPath ??
                        "~/.codex/codex-gateway-hub/export.instructions.md"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("可选 AGENTS.md", "Optional AGENTS.md")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            void copyNativeCodexBundleFile(
                              "agentsMd",
                              t("原生 Codex AGENTS.md 已复制。", "Native Codex AGENTS.md copied."),
                              t("复制原生 Codex AGENTS.md 失败", "Failed to copy native Codex AGENTS.md")
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("复制 AGENTS.md", "Copy AGENTS.md")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() =>
                            downloadNativeCodexBundleFile(
                              "agentsMd",
                              "AGENTS.md",
                              t("原生 Codex AGENTS.md 已下载。", "Native Codex AGENTS.md downloaded."),
                              t("下载原生 Codex AGENTS.md 失败", "Failed to download native Codex AGENTS.md")
                            )
                          }
                          disabled={loading || !nativeCodexExportBundle}
                        >
                          {t("下载 AGENTS.md", "Download AGENTS.md")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={nativeCodexExportBundle?.files.agentsMd.content || nativeCodexEmptyState}
                      language="markdown"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t("建议路径", "Suggested path")}:{" "}
                      {nativeCodexExportBundle?.files.agentsMd.targetPath ?? "./AGENTS.md"}
                    </p>

                    <div className="tc-runtime-doc-head">
                      <h4>{t("Claude Code 配置预览（JSON）", "Claude Code Config Preview (JSON)")}</h4>
                      <div className="tc-actions-row">
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => void copyCcSwitchClaudeConfigJson()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("一键复制 Claude 配置（含密钥）", "Copy Claude Config (with key)")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => downloadCcSwitchClaudeConfigJson()}
                          disabled={loading || !keyForm.localKey.trim()}
                        >
                          {t("下载 Claude 配置", "Download Claude Config")}
                        </Button>
                      </div>
                    </div>
                    <CodeBlock
                      value={
                        claudeConfigPreview ||
                        t("请先填写本地 Key 后查看配置预览。", "Fill local key to preview config.")
                      }
                      language="json"
                      maxHeight={260}
                    />
                    <p className="tc-upstream-advice">
                      {t(
                        "说明：这里对应 CC Switch 的 Claude env 配置；预览与复制都会显示完整真实密钥。",
                        "Note: This maps to CC Switch Claude env config. Both preview and copy include the full real key."
                      )}
                    </p>
                  </div>

                  <div className="tc-actions-row">
                    <Button
                      theme="primary"
                      variant="outline"
                      onClick={openCcSwitchCodexImport}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("一键导入 CC Switch（Codex）", "One-click Import to CC Switch (Codex)")}
                    </Button>
                    <Button
                      theme="primary"
                      variant="outline"
                      onClick={openCcSwitchClaudeImport}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("一键导入 CC Switch（Claude Code）", "One-click Import to CC Switch (Claude Code)")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchCodexDeepLink()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Codex 导入链接", "Copy Codex Import Link")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchCodexContextPatch()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Codex 上下文补丁", "Copy Codex Context Patch")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchClaudeDeepLink()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Claude Code 导入链接", "Copy Claude Code Import Link")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => void copyCcSwitchClaudeThinkingPatch()}
                      disabled={loading || !keyForm.localKey.trim()}
                    >
                      {t("复制 Claude 上下文/Thinking 补丁", "Copy Claude Context/Thinking Patch")}
                    </Button>
                  </div>
                  <p className="tc-upstream-advice">
                    {t(
                      "说明：通过 CC Switch 导入链接导入时，会自动附带网关用量/配额查询脚本，可直接在 CC Switch 中查看每日 Token / 请求额度与今日使用量。",
                      "Note: CC Switch import links now include a gateway usage/quota query script, so you can view daily token/request quotas and today's usage directly in CC Switch."
                    )}
                  </p>
                </section>
  );
}
