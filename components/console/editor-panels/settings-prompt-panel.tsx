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


export function SettingsPromptPanel(props: SettingsPromptPanelProps) {
  const {
    t,
    compatPromptKeywordsInput,
    setCompatPromptKeywordsInput,
    compatPromptHintInput,
    setCompatPromptHintInput,
    compatPromptRuleCount,
    compatPromptRuleEnabledCount,
    compatPromptRuleSearch,
    setCompatPromptRuleSearch,
    addCompatPromptRule,
    openCompatPromptRulesFileImporter,
    compatPromptRulesFileInputRef,
    handleCompatPromptRulesFileChange,
    compatPromptUpstreamModelSuggestions,
    compatPromptRuleVisibleItems,
    duplicateCompatPromptRule,
    removeCompatPromptRule,
    updateCompatPromptRule,
    setShowCompatPromptRulesJsonEditor,
    showCompatPromptRulesJsonEditor,
    compatPromptRulesJsonInput,
    setCompatPromptRulesJsonInput,
    exportCompatPromptRulesToJsonDraft,
    importCompatPromptRulesFromJsonDraft,
    savingCompatPromptConfig,
    saveGatewayCompatPromptConfig,
    loading,
    compatPromptDefaults,
    applyCompatPromptConfig
  } = props;

  return (
                <section className="tc-section">
                  <h3>{t("网关注入提示词配置", "Gateway Injected Prompt Config")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "这里控制 AGENTS.md 检测场景下注入策略：未命中规则时使用默认提示词；命中上游真实模型规则时，用该模型专属提示词替换默认提示词。保存后会影响后续请求。",
                      "This controls AGENTS.md injection behavior: use the default hint when no rule matches; when a real-upstream-model rule matches, its model-specific hint replaces the default hint."
                    )}
                  </p>

                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("AGENTS 关键词（每行一个）", "AGENTS Keywords (one per line)")}</span>
                      <Textarea
                        value={compatPromptKeywordsInput}
                        onChange={(value) => setCompatPromptKeywordsInput(value)}
                        autosize={{ minRows: 4, maxRows: 8 }}
                        placeholder={"AGENTS.md\nAGENTS.MD\nagents.md"}
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("默认提示词正文", "Default Prompt Body")}</span>
                      <Textarea
                        value={compatPromptHintInput}
                        onChange={(value) => setCompatPromptHintInput(value)}
                        autosize={{ minRows: 10, maxRows: 18 }}
                        placeholder={t("请输入自动注入的默认提示词", "Enter the default injected prompt")}
                      />
                    </label>
                  </div>

                  <div className="tc-model-list-toolbar">
                    <div className="tc-model-list-toolbar-left">
                      <div className="tc-model-list-title">{t("模型定制规则", "Model-Specific Rules")}</div>
                      <Tag variant="light-outline">
                        {t("当前", "Current")} {compatPromptRuleCount} {t("条", "items")}
                      </Tag>
                      <Tag variant="light-outline">
                        {t("启用", "Enabled")} {compatPromptRuleEnabledCount}
                      </Tag>
                    </div>
                    <div className="tc-model-list-toolbar-left">
                      <Input
                        value={compatPromptRuleSearch}
                        onChange={(value) => setCompatPromptRuleSearch(value)}
                        clearable
                        placeholder={t("搜索规则 ID / 模型 / 提示词", "Search rule ID / model / hint")}
                        style={{ width: 280 }}
                      />
                      <Button
                        theme="primary"
                        variant="outline"
                        onClick={() => addCompatPromptRule()}
                        disabled={compatPromptRuleCount >= 128}
                      >
                        {t("新增规则", "Add Rule")}
                      </Button>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => openCompatPromptRulesFileImporter("append")}
                        disabled={compatPromptRuleCount >= 128}
                      >
                        {t("批量导入并追加", "Batch Import (Append)")}
                      </Button>
                      <Button
                        variant="outline"
                        theme="default"
                        onClick={() => openCompatPromptRulesFileImporter("replace")}
                      >
                        {t("批量导入并覆盖", "Batch Import (Replace)")}
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={compatPromptRulesFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    style={{ display: "none" }}
                    onChange={(event) => void handleCompatPromptRulesFileChange(event)}
                  />

                  {compatPromptUpstreamModelSuggestions.length > 0 ? (
                    <>
                      <p className="tc-upstream-advice">
                        {t(
                          "已发现上游真实模型。可一键创建规则，也可以手填任意上游真实模型名称。",
                          "Detected real upstream models. You can add rules with one click, or type any upstream model manually."
                        )}
                      </p>
                      <div className="tc-actions-row">
                        {compatPromptUpstreamModelSuggestions.map((model) => (
                          <Button
                            key={model}
                            variant="outline"
                            size="small"
                            onClick={() =>
                              addCompatPromptRule({
                                upstreamModelPattern: model
                              })
                            }
                            disabled={compatPromptRuleCount >= 128}
                          >
                            {model}
                          </Button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {compatPromptRuleCount === 0 ? (
                    <p className="tc-upstream-advice">
                      {t(
                        "当前没有模型规则。你可以点击“新增规则”开始按上游真实模型定制提示词。",
                        "No model rules yet. Click 'Add Rule' to start customizing hints by real upstream model."
                      )}
                    </p>
                  ) : compatPromptRuleVisibleItems.length === 0 ? (
                    <p className="tc-upstream-advice">
                      {t(
                        "没有匹配搜索条件的规则。",
                        "No rules matched the search filter."
                      )}
                    </p>
                  ) : (
                    <div className="tc-model-list">
                      {compatPromptRuleVisibleItems.map(({ rule, index }) => (
                        <div className="tc-model-item" key={`${rule.id}-${index}`}>
                          <div className="tc-model-head">
                            <strong>{t("规则", "Rule")} #{index + 1}</strong>
                            <div className="tc-model-actions">
                              <Tag
                                theme={rule.enabled ? "success" : "default"}
                                variant="light-outline"
                              >
                                {rule.enabled ? t("启用", "Enabled") : t("停用", "Disabled")}
                              </Tag>
                              <Button
                                variant="outline"
                                size="small"
                                onClick={() => duplicateCompatPromptRule(index)}
                                disabled={compatPromptRuleCount >= 128}
                              >
                                {t("复制", "Duplicate")}
                              </Button>
                              <Button
                                theme="danger"
                                variant="text"
                                size="small"
                                onClick={() => removeCompatPromptRule(index)}
                              >
                                {t("删除", "Delete")}
                              </Button>
                            </div>
                          </div>

                          <div className="tc-form-grid">
                            <label className="tc-field">
                              <span>{t("规则 ID", "Rule ID")}</span>
                              <Input
                                value={rule.id}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev: any) => ({
                                    ...prev,
                                    id: value
                                  }))
                                }
                                clearable
                              />
                            </label>

                            <label className="tc-switchline">
                              <span>{t("启用规则", "Rule Enabled")}</span>
                              <Switch
                                value={rule.enabled}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev: any) => ({
                                    ...prev,
                                    enabled: Boolean(value)
                                  }))
                                }
                              />
                            </label>

                            <label className="tc-field">
                              <span>{t("供应商匹配（可选）", "Provider Pattern (optional)")}</span>
                              <Input
                                value={rule.provider}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev: any) => ({
                                    ...prev,
                                    provider: value
                                  }))
                                }
                                placeholder={t("例如：doubao / glm / *", "e.g. doubao / glm / *")}
                                clearable
                              />
                            </label>

                            <label className="tc-field">
                              <span>{t("上游真实模型匹配", "Upstream Real Model Pattern")}</span>
                              <Input
                                value={rule.upstreamModelPattern}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev: any) => ({
                                    ...prev,
                                    upstreamModelPattern: value
                                  }))
                                }
                                placeholder={t(
                                  "例如：doubao-seed-2.0-pro / glm-5 / *",
                                  "e.g. doubao-seed-2.0-pro / glm-5 / *"
                                )}
                                clearable
                              />
                            </label>

                            <label className="tc-field tc-field-wide">
                              <span>{t("规则追加提示词", "Rule Extra Hint")}</span>
                              <Textarea
                                value={rule.hint}
                                onChange={(value) =>
                                  updateCompatPromptRule(index, (prev: any) => ({
                                    ...prev,
                                    hint: value
                                  }))
                                }
                                autosize={{ minRows: 6, maxRows: 14 }}
                                placeholder={t(
                                  "请输入该模型命中时需要追加的提示词",
                                  "Enter extra hint to append when this rule matches"
                                )}
                              />
                            </label>

                            <p className="tc-upstream-advice tc-field-wide">
                              {t(
                                "匹配建议：优先填写“上游真实模型匹配”，可搭配 provider 收敛范围。支持 `*`、`?` 通配。",
                                "Matching tip: prioritize upstream real model pattern, then narrow with provider if needed. `*` and `?` wildcards are supported."
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="tc-actions-row">
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => setShowCompatPromptRulesJsonEditor((prev: any) => !prev)}
                    >
                      {showCompatPromptRulesJsonEditor
                        ? t("收起 JSON 批量编辑", "Hide JSON Bulk Editor")
                        : t("展开 JSON 批量编辑", "Show JSON Bulk Editor")}
                    </Button>
                  </div>

                  {showCompatPromptRulesJsonEditor ? (
                    <>
                      <div className="tc-form-grid">
                        <label className="tc-field tc-field-wide">
                          <span>{t("高级：模型规则 JSON", "Advanced: Model Rules JSON")}</span>
                          <Textarea
                            value={compatPromptRulesJsonInput}
                            onChange={(value) => setCompatPromptRulesJsonInput(value)}
                            autosize={{ minRows: 10, maxRows: 22 }}
                            placeholder={t("可用于批量导入导出规则", "Use for bulk import/export of rules")}
                          />
                        </label>
                      </div>
                      <div className="tc-actions-row">
                        <Button variant="outline" theme="default" onClick={exportCompatPromptRulesToJsonDraft}>
                          {t("从当前规则生成 JSON", "Generate JSON from Rules")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => importCompatPromptRulesFromJsonDraft("append")}
                          disabled={compatPromptRuleCount >= 128}
                        >
                          {t("从 JSON 追加规则", "Append Rules from JSON")}
                        </Button>
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => importCompatPromptRulesFromJsonDraft("replace")}
                        >
                          {t("从 JSON 覆盖规则", "Replace Rules from JSON")}
                        </Button>
                      </div>
                    </>
                  ) : null}

                  <div className="tc-actions-row">
                    <Button
                      theme="primary"
                      loading={savingCompatPromptConfig}
                      onClick={() => void saveGatewayCompatPromptConfig()}
                      disabled={loading}
                    >
                      {t("保存提示词配置", "Save Prompt Config")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={() => {
                        if (!compatPromptDefaults) {
                          return;
                        }
                        applyCompatPromptConfig(compatPromptDefaults);
                      }}
                      disabled={!compatPromptDefaults || savingCompatPromptConfig}
                    >
                      {t("恢复默认草稿", "Reset to Defaults")}
                    </Button>
                  </div>

                  <p className="tc-tip">
                    {t(
                      "规则字段：provider / upstreamModelPattern 支持 `*`、`?` 通配；优先按上游真实模型命中。命中规则后将替换默认提示词。支持批量导入 `.json`（数组，或含 modelPromptRules/compatPromptConfig.modelPromptRules）。关键词用于定位 AGENTS.md 段落前的插入位置。",
                      "Rule fields provider / upstreamModelPattern support `*` and `?` wildcards; matching prioritizes real upstream model. A matched rule replaces the default hint. Batch `.json` import is supported (array, or modelPromptRules/compatPromptConfig.modelPromptRules). Keywords still control where hints are injected before AGENTS.md sections."
                    )}
                  </p>
                </section>
  );
}

