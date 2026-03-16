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


export function SettingsUpstreamPanel(props: SettingsUpstreamPanelProps) {
  const {
    t,
    applyCodingPreset,
    addUpstreamModel,
    handleQuickExportModels,
    handleQuickCopyModels,
    handleOpenQuickImportDialog,
    channelForm,
    setChannelForm,
    applyProviderPreset,
    normalizeSelectValue,
    selectedChannel,
    isNewChannel,
    setChannelDefaultModel,
    channelModelOptions,
    updateUpstreamModel,
    formatGlmThinkingThresholdLabel,
    removeUpstreamModel,
    testingUpstream,
    testingModelId,
    testUpstreamModel,
    savingChannel,
    loading,
    visionChannelOptions,
    resolveVisionModelOptions,
    testPrompt,
    setTestPrompt
  } = props;

  return (
                <section className="tc-section">
                  <h3>{t("上游渠道配置", "Upstream Configuration")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "渠道独立管理，可配置多模型池、视觉兜底模型与单模型连通测试。以下仅提供套餐建议，不做强制预设。",
                      "Manage upstreams independently with model pools, vision fallback, and per-model health checks. Suggestions only, no forced presets."
                    )}
                  </p>

                  <div className="tc-upstream-toolbar">
                    {CODING_PRESETS.map((preset) => (
                      <Button
                        key={preset.id}
                        variant="outline"
                        theme="default"
                        onClick={() => applyCodingPreset(preset)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button theme="primary" variant="outline" onClick={addUpstreamModel}>
                      {t("新增上游模型", "Add Upstream Model")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickExportModels}
                      disabled={!channelForm.upstreamModels.length}
                    >
                      {t("导出模型池", "Export Model Pool")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickCopyModels}
                      disabled={!channelForm.upstreamModels.length}
                    >
                      {t("复制模型池", "Copy Model Pool")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleOpenQuickImportDialog}
                    >
                      {t("导入模型池", "Import Model Pool")}
                    </Button>
                  </div>

                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("渠道名称", "Upstream Name")}</span>
                      <Input
                        value={channelForm.name}
                        onChange={(value) => setChannelForm((prev: any) => ({ ...prev, name: value }))}
                        placeholder={t("如：openai-主线路", "e.g. openai-main")}
                        clearable
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("供应商", "Provider")}</span>
                      <Select
                        value={channelForm.provider}
                        options={PROVIDERS.map((provider) => ({
                          label: `${PROVIDER_META[provider].label} · ${PROVIDER_META[provider].tip}`,
                          value: provider
                        }))}
                        onChange={(value) => applyProviderPreset(normalizeSelectValue(value) as ProviderName)}
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>{t("上游 Base URL", "Upstream Base URL")}</span>
                      <Input
                        value={channelForm.upstreamBaseUrl}
                        onChange={(value) =>
                          setChannelForm((prev: any) => ({ ...prev, upstreamBaseUrl: value }))
                        }
                        placeholder="https://api.openai.com"
                        clearable
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>
                        {t("上游 API Key", "Upstream API Key")}{" "}
                        {selectedChannel?.hasUpstreamApiKey ? t("（已配置）", "(configured)") : t("（未配置）", "(not set)")}
                      </span>
                      <Input
                        type="password"
                        value={channelForm.upstreamApiKey}
                        onChange={(value) =>
                          setChannelForm((prev: any) => ({
                            ...prev,
                            upstreamApiKey: value,
                            clearUpstreamApiKey: false
                          }))
                        }
                        placeholder={isNewChannel ? t("请输入上游 Key", "Enter upstream API key") : t("留空表示不变", "Keep empty to keep unchanged")}
                        clearable
                      />
                    </label>

                    {!isNewChannel ? (
                      <label className="tc-checkline">
                        <Checkbox
                          checked={channelForm.clearUpstreamApiKey}
                          onChange={(checked) =>
                            setChannelForm((prev: any) => ({
                              ...prev,
                              clearUpstreamApiKey: checked,
                              upstreamApiKey: ""
                            }))
                          }
                        >
                          {t("清空渠道 API Key", "Clear Upstream API Key")}
                        </Checkbox>
                      </label>
                    ) : null}

                    <label className="tc-field">
                      <span>{t("请求超时（毫秒）", "Request Timeout (ms)")}</span>
                      <Input
                        type="number"
                        value={String(channelForm.timeoutMs)}
                        onChange={(value) => {
                          const n = Number(value);
                          if (!Number.isNaN(n)) {
                            setChannelForm((prev: any) => ({ ...prev, timeoutMs: n }));
                          }
                        }}
                      />
                    </label>

                    <label className="tc-switchline">
                      <span>{t("启用状态", "Enabled")}</span>
                      <Switch
                        value={channelForm.enabled}
                        onChange={(value) =>
                          setChannelForm((prev: any) => ({ ...prev, enabled: Boolean(value) }))
                        }
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("默认模型", "Default Model")}</span>
                      <Select
                        value={channelForm.defaultModel}
                        options={channelModelOptions}
                        onChange={(value) => setChannelDefaultModel(normalizeSelectValue(value))}
                      />
                    </label>
                  </div>

                  <div className="tc-model-list-toolbar">
                    <div className="tc-model-list-toolbar-left">
                      <div className="tc-model-list-title">{t("模型池", "Model Pool")}</div>
                      <Tag variant="light-outline">
                        {t("当前", "Current")} {channelForm.upstreamModels.length} {t("个", "items")}
                      </Tag>
                    </div>
                    <Button theme="primary" variant="outline" onClick={addUpstreamModel}>
                      {t("继续添加模型", "Add Another Model")}
                    </Button>
                  </div>

                  <div className="tc-model-list">
                    {channelForm.upstreamModels.map((item, index) => (
                      <div className="tc-model-item" key={item.id}>
                        <div className="tc-model-head">
                          <strong>{t("模型", "Model")} #{index + 1}</strong>
                          <div className="tc-model-actions">
                            <Button
                              variant="outline"
                              size="small"
                              onClick={() => setChannelDefaultModel(item.model)}
                              disabled={channelForm.defaultModel === item.model}
                            >
                              {channelForm.defaultModel === item.model ? t("当前默认", "Current Default") : t("设为默认", "Set Default")}
                            </Button>
                            <Button
                              variant="outline"
                              size="small"
                              loading={testingUpstream && testingModelId === item.id}
                              onClick={() => void testUpstreamModel(item)}
                              disabled={savingChannel || loading}
                            >
                              {t("测试", "Test")}
                            </Button>
                            <Button
                              theme="danger"
                              variant="text"
                              size="small"
                              disabled={channelForm.upstreamModels.length <= 1}
                              onClick={() => removeUpstreamModel(item.id)}
                            >
                              {t("删除", "Delete")}
                            </Button>
                          </div>
                        </div>

                        <div className="tc-form-grid">
                          <label className="tc-field">
                            <span>{t("展示名", "Display Name")}</span>
                            <Input
                              value={item.name}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  name: value
                                }))
                              }
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("对外模型名（别名）", "Public Model Name (Alias)")}</span>
                            <Input
                              value={item.aliasModel ?? ""}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  aliasModel: value
                                }))
                              }
                              placeholder={t("如：gpt-5.3-codex（可选）", "e.g. gpt-5.3-codex (optional)")}
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("模型 ID", "Model ID")}</span>
                            <Input
                              value={item.model}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  model: value
                                }))
                              }
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("上下文长度（Token）", "Context Window (tokens)")}</span>
                            <Input
                              type="number"
                              value={item.contextWindow ? String(item.contextWindow) : ""}
                              onChange={(value) => {
                                const normalized = value.trim();
                                updateUpstreamModel(item.id, (prev: any) => {
                                  if (!normalized) {
                                    return {
                                      ...prev,
                                      contextWindow: null
                                    };
                                  }
                                  const next = Number(normalized);
                                  if (!Number.isFinite(next)) {
                                    return prev;
                                  }
                                  return {
                                    ...prev,
                                    contextWindow: Math.floor(next)
                                  };
                                });
                              }}
                              placeholder={t("如：128000（可选）", "e.g. 128000 (optional)")}
                              clearable
                            />
                          </label>

                          <label className="tc-field">
                            <span>{t("协议", "Wire API")}</span>
                            <Select
                              value={item.upstreamWireApi}
                              options={UPSTREAM_WIRE_APIS.map((wireApi) => ({
                                label: wireApi,
                                value: wireApi
                              }))}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  upstreamWireApi: normalizeSelectValue(value) as UpstreamWireApi
                                }))
                              }
                            />
                          </label>

                          {shouldShowGlmThinkingThreshold(
                            channelForm.provider,
                            item.model
                          ) ? (
                            <label className="tc-field">
                              <span>
                                {t(
                                  "GLM 深度思考触发阈值",
                                  "GLM Deep Thinking Threshold"
                                )}
                              </span>
                              <Select
                                value={item.glmCodexThinkingThreshold}
                                options={GLM_CODEX_THINKING_THRESHOLDS.map((threshold) => ({
                                  value: threshold,
                                  label: formatGlmThinkingThresholdLabel(threshold)
                                }))}
                                onChange={(value) =>
                                  updateUpstreamModel(item.id, (prev: any) => ({
                                    ...prev,
                                    glmCodexThinkingThreshold: normalizeGlmCodexThinkingThreshold(
                                      normalizeSelectValue(value)
                                    )
                                  }))
                                }
                              />
                            </label>
                          ) : null}

                          <label className="tc-switchline">
                            <span>{t("启用模型", "Model Enabled")}</span>
                            <Switch
                              value={item.enabled}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  enabled: Boolean(value)
                                }))
                              }
                            />
                          </label>

                          {shouldShowGlmThinkingThreshold(
                            channelForm.provider,
                            item.model
                          ) ? (
                            <p className="tc-upstream-advice tc-field-wide">
                              {t(
                                "当 Codex 通过本模型请求 `reasoning_effort` 时，达到这里设置的力度才会自动映射为 GLM 的 `thinking.enabled`。`off` 表示永不自动开启；如果客户端显式发送 `thinking.type`，仍以客户端为准。",
                                "When Codex sends `reasoning_effort` through this model, GLM `thinking.enabled` will only be auto-enabled once the request reaches this threshold. `off` disables auto-enable; explicit client `thinking.type` still wins."
                              )}
                            </p>
                          ) : null}

                          <label className="tc-switchline">
                            <span>{t("主模型支持视觉", "Main Model Supports Vision")}</span>
                            <Switch
                              value={item.supportsVision}
                              onChange={(value) =>
                                updateUpstreamModel(item.id, (prev: any) => ({
                                  ...prev,
                                  supportsVision: Boolean(value),
                                  visionChannelId: Boolean(value) ? null : prev.visionChannelId,
                                  visionModel: Boolean(value) ? null : prev.visionModel
                                }))
                              }
                            />
                          </label>

                          {!item.supportsVision ? (
                            <>
                              <p className="tc-upstream-advice tc-field-wide">
                                {t(
                                  "当前主模型不支持视觉。收到图片后会先调用下方辅助视觉渠道/模型做图片转文本，再回到本模型继续推理。",
                                  "This main model has no native vision. Image input will be converted by fallback vision channel/model first, then fed back to this model."
                                )}
                              </p>
                              <label className="tc-field">
                                <span>{t("视觉渠道（可跨供应商）", "Vision Channel (cross-provider)")}</span>
                                <Select
                                  value={
                                    item.visionChannelId
                                      ? String(item.visionChannelId)
                                      : "__self__"
                                  }
                                  options={visionChannelOptions}
                                  onChange={(value) => {
                                    const next = normalizeSelectValue(value);
                                    updateUpstreamModel(item.id, (prev: any) => ({
                                      ...prev,
                                      visionChannelId:
                                        next === "__self__" ? null : Number(next) || null
                                    }));
                                  }}
                                />
                              </label>

                              <label className="tc-field">
                                <span>{t("从视觉渠道选择模型", "Pick Model from Vision Channel")}</span>
                                <Select
                                  value={item.visionModel ?? undefined}
                                  options={resolveVisionModelOptions(item)}
                                  placeholder={t("可选，不填可手输", "Optional; leave empty to type manually")}
                                  onChange={(value) =>
                                    updateUpstreamModel(item.id, (prev: any) => ({
                                      ...prev,
                                      visionModel: normalizeSelectValue(value) || null
                                    }))
                                  }
                                />
                              </label>

                              <label className="tc-field tc-field-wide">
                                <span>{t("辅助视觉模型（跨模型图片转文本）", "Fallback Vision Model (cross-model image-to-text)")}</span>
                                <Input
                                  value={item.visionModel ?? ""}
                                  onChange={(value) =>
                                    updateUpstreamModel(item.id, (prev: any) => ({
                                      ...prev,
                                      visionModel: value
                                    }))
                                  }
                                  placeholder={t("如：glm-4v / doubao-vision / gpt-4.1-mini", "e.g. glm-4v / doubao-vision / gpt-4.1-mini")}
                                  clearable
                                />
                              </label>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="tc-form-grid">
                    <label className="tc-field tc-field-wide">
                      <span>{t("上游测试提示词", "Upstream Test Prompt")}</span>
                      <Input
                        value={testPrompt}
                        onChange={(value) => setTestPrompt(value)}
                        placeholder={t("如：请只回复 upstream_test_ok", "e.g. Reply only: upstream_test_ok")}
                        clearable
                      />
                    </label>
                  </div>

                  <div className="tc-actions-row">
                    <Button
                      variant="outline"
                      theme="default"
                      loading={testingUpstream && testingModelId === null}
                      onClick={() => void testUpstreamModel()}
                      disabled={savingChannel || loading}
                    >
                      {t("测试默认模型", "Test Default Model")}
                    </Button>
                  </div>
                </section>
  );
}
