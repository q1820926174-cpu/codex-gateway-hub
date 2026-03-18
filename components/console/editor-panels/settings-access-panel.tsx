// @ts-nocheck
"use client";

import {
  Button,
  Checkbox,
  DialogPlugin,
  Input,
  MessagePlugin,
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
import { ActiveFilterSummary } from "@/components/console/filters";

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


export function SettingsAccessPanel(props: SettingsAccessPanelProps) {
  const {
    t,
    keyForm,
    setKeyForm,
    keyBindChannelOptions,
    normalizeSelectValue,
    copyLocalKey,
    addKeyModelMapping,
    handleQuickExportKeyMappings,
    handleQuickCopyKeyMappings,
    handleOpenQuickImportKeyMappingDialog,
    resolveMappingChannel,
    findChannelModelProfile,
    formatDoubaoThinkingTypeLabel,
    updateKeyModelMapping,
    removeKeyModelMapping,
    mappingBindChannelOptions,
    formatGlmThinkingThresholdLabel,
    updateBoundChannelGlmThinkingThreshold,
    loading,
    savingKey,
    savingChannel,
    keyOverflowModelOptions,
    mappingOverflowModelOptions,
    selectedChannelForKey,
    keyMappingSearch,
    setKeyMappingSearch,
    keyMappingStatusFilter,
    setKeyMappingStatusFilter,
    keyMappingBindingFilter,
    setKeyMappingBindingFilter,
    keyMappingOverflowFilter,
    setKeyMappingOverflowFilter,
    keyMappingVisibleItems,
    keyMappingActiveFilters,
    resetKeyMappingFilters,
    isNewKey,
    handleMenuRoute,
    generateLocalKey
  } = props;

  return (
                <section className="tc-section">
                  <h3>{t("本地 Key 接入", "Local Key Access")}</h3>
                  <p className="tc-upstream-advice">
                    {t(
                      "one-api 风格：本地 Key 只负责鉴权与调度，上游连接在「上游渠道」模块独立维护。",
                      "one-api style: local key handles auth and scheduling only. Upstream connections are managed in the Upstreams module."
                    )}
                  </p>
                  <div className="tc-form-grid">
                    <label className="tc-field">
                      <span>{t("Key 名称", "Key Name")}</span>
                      <Input
                        value={keyForm.name}
                        onChange={(value) => setKeyForm((prev: any) => ({ ...prev, name: value }))}
                        placeholder={t("如：生产-客服网关", "e.g. prod-support-gateway")}
                        clearable
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("绑定上游渠道", "Bind Upstream")}</span>
                      <Select
                        value={keyForm.upstreamChannelId ? String(keyForm.upstreamChannelId) : undefined}
                        options={keyBindChannelOptions}
                        placeholder={t("请选择渠道", "Select upstream")}
                        onChange={(value) => {
                          const next = Number(normalizeSelectValue(value));
                          if (!Number.isNaN(next) && next > 0) {
                            setKeyForm((prev: any) => ({ ...prev, upstreamChannelId: next }));
                          }
                        }}
                      />
                    </label>

                    <label className="tc-field tc-field-wide">
                      <span>{t("本地 Key（OpenAI 风格）", "Local Key (OpenAI style)")}</span>
                      <div className="tc-inline-actions">
                        <Input
                          value={keyForm.localKey}
                          onChange={(value) => setKeyForm((prev: any) => ({ ...prev, localKey: value }))}
                          placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                          clearable
                        />
                        <Button
                          variant="outline"
                          theme="default"
                          onClick={() => {
                            setKeyForm((prev: any) => ({
                              ...prev,
                              localKey: generateLocalKey()
                            }));
                            void MessagePlugin.success(t("已生成新 Key", "New key generated"));
                          }}
                        >
                          {t("生成", "Generate")}
                        </Button>
                        <Button variant="outline" theme="default" onClick={() => void copyLocalKey()}>
                          {t("复制", "Copy")}
                        </Button>
                      </div>
                    </label>

                    <label className="tc-switchline">
                      <span>{t("按上下文长度自动切模", "Auto-switch by context length")}</span>
                      <Switch
                        value={keyForm.dynamicModelSwitch}
                        onChange={(value) =>
                          setKeyForm((prev: any) => ({
                            ...prev,
                            dynamicModelSwitch: Boolean(value)
                          }))
                        }
                      />
                    </label>

                    <label className="tc-switchline">
                      <span>{t("启用状态", "Enabled")}</span>
                      <Switch
                        value={keyForm.enabled}
                        onChange={(value) =>
                          setKeyForm((prev: any) => ({
                            ...prev,
                            enabled: Boolean(value)
                          }))
                        }
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("每日请求上限", "Daily Request Limit")}</span>
                      <Input
                        type="number"
                        value={keyForm.dailyRequestLimit}
                        onChange={(value) =>
                          setKeyForm((prev: any) => ({
                            ...prev,
                            dailyRequestLimit: value
                          }))
                        }
                        placeholder={t("留空表示不限", "Leave empty for unlimited")}
                        clearable
                      />
                    </label>

                    <label className="tc-field">
                      <span>{t("每日 Token 上限", "Daily Token Limit")}</span>
                      <Input
                        type="number"
                        value={keyForm.dailyTokenLimit}
                        onChange={(value) =>
                          setKeyForm((prev: any) => ({
                            ...prev,
                            dailyTokenLimit: value
                          }))
                        }
                        placeholder={t("留空表示不限", "Leave empty for unlimited")}
                        clearable
                      />
                    </label>

                    <p className="tc-upstream-advice tc-field-wide">
                      {t(
                        "每日配额基于网关用量记录按天统计，达到上限后会返回 429；每天 00:00 按服务端本地时区自动重置。留空表示不限制。",
                        "Daily quota is calculated from gateway usage records. Requests return 429 after the limit is reached and reset automatically at 00:00 in the server local timezone. Leave blank for unlimited."
                      )}
                    </p>

                    {keyForm.dynamicModelSwitch ? (
                      <>
                        <label className="tc-field">
                          <span>{t("切换阈值（输入 Token）", "Switch Threshold (prompt tokens)")}</span>
                          <Input
                            type="number"
                            value={String(keyForm.contextSwitchThreshold)}
                            onChange={(value) => {
                              const n = Number(value);
                              if (!Number.isNaN(n)) {
                                setKeyForm((prev: any) => ({
                                  ...prev,
                                  contextSwitchThreshold: n
                                }));
                              }
                            }}
                          />
                        </label>
                        <label className="tc-field">
                          <span>{t("溢出模型（超阈值切换）", "Overflow Model (above threshold)")}</span>
                          <Select
                            value={keyForm.contextOverflowModel || undefined}
                            options={keyOverflowModelOptions}
                            placeholder={t("可跨上游选择任意已启用模型", "Select any enabled model across upstreams")}
                            onChange={(value) =>
                              setKeyForm((prev: any) => ({
                                ...prev,
                                contextOverflowModel: normalizeSelectValue(value)
                              }))
                            }
                          />
                        </label>
                        <p className="tc-upstream-advice tc-field-wide">
                          {t(
                            "溢出模型支持跨上游选择。超阈值后会直接切到你选定的渠道与模型，而不再限制为当前绑定渠道。",
                            "Overflow model supports cross-upstream selection. Once the threshold is exceeded, requests switch directly to the selected channel and model instead of being limited to the currently bound upstream."
                          )}
                        </p>
                      </>
                    ) : null}
                  </div>

                  <div className="tc-actions-row">
                    <Tag variant="light-outline">{t("单 Key 内部模型映射（客户端 -> 内部）", "Single-key model mapping (client -> internal)")}</Tag>
                    <Tag variant="light-outline">
                      {t("可见", "Visible")} {keyMappingVisibleItems.length}/{keyForm.modelMappings.length}
                    </Tag>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={addKeyModelMapping}
                      disabled={!keyForm.upstreamChannelId}
                    >
                      {t("新增映射", "Add Mapping")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleQuickExportKeyMappings}
                      disabled={!keyForm.modelMappings.length}
                    >
                      {t("批量导出", "Bulk Export")}
                    </Button>
                    <Button
                      variant="outline"
                      theme="default"
                      onClick={handleOpenQuickImportKeyMappingDialog}
                    >
                      {t("批量导入", "Bulk Import")}
                    </Button>
                  </div>

                  <div className="tc-log-toolbar">
                    <div className="tc-log-toolbar-group tc-log-field-wide">
                      <label className="tc-field">
                        <span>{t("关键词", "Keyword")}</span>
                        <Input
                          value={keyMappingSearch}
                          onChange={(value) => setKeyMappingSearch(value)}
                          placeholder={t("搜索客户端模型、内部模型、渠道、溢出模型", "Search client model, target model, channel, or overflow model")}
                          clearable
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("状态", "Status")}</span>
                        <Select
                          value={keyMappingStatusFilter}
                          options={[
                            { label: t("全部状态", "All Status"), value: "all" },
                            { label: t("启用", "Enabled"), value: "enabled" },
                            { label: t("停用", "Disabled"), value: "disabled" }
                          ]}
                          style={{ width: 150 }}
                          onChange={(value) => setKeyMappingStatusFilter(normalizeSelectValue(value))}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("绑定方式", "Binding")}</span>
                        <Select
                          value={keyMappingBindingFilter}
                          options={[
                            { label: t("全部绑定", "All Binding"), value: "all" },
                            { label: t("继承 Key 渠道", "Inherit Key Channel"), value: "inherit" },
                            { label: t("独立绑定渠道", "Bound Channel"), value: "bound" }
                          ]}
                          style={{ width: 180 }}
                          onChange={(value) => setKeyMappingBindingFilter(normalizeSelectValue(value))}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group">
                      <label className="tc-field">
                        <span>{t("溢出切模", "Overflow")}</span>
                        <Select
                          value={keyMappingOverflowFilter}
                          options={[
                            { label: t("全部", "All"), value: "all" },
                            { label: t("已开启", "Enabled"), value: "yes" },
                            { label: t("未开启", "Disabled"), value: "no" }
                          ]}
                          style={{ width: 150 }}
                          onChange={(value) => setKeyMappingOverflowFilter(normalizeSelectValue(value))}
                        />
                      </label>
                    </div>
                    <div className="tc-log-toolbar-group tc-log-toolbar-actions">
                      <Button variant="outline" onClick={resetKeyMappingFilters}>
                        {t("重置筛选", "Reset Filters")}
                      </Button>
                    </div>
                  </div>

                  <ActiveFilterSummary
                    items={keyMappingActiveFilters}
                    onClearAll={resetKeyMappingFilters}
                  />

                  {keyForm.modelMappings.length > 0 ? (
                    keyMappingVisibleItems.length === 0 ? (
                      <p className="tc-upstream-advice">
                        {t(
                          "当前没有命中筛选条件的映射。",
                          "No mappings matched the current filters."
                        )}
                      </p>
                    ) : (
                    <div className="tc-model-list">
                      {keyMappingVisibleItems.map((item, index) => {
                        const mappingChannel = resolveMappingChannel(item);
                        const targetProfile = findChannelModelProfile(mappingChannel, item.targetModel);
                        const showDoubaoThinkingControl = shouldShowDoubaoThinkingType(
                          mappingChannel?.provider ?? "openai",
                          targetProfile?.model ?? item.targetModel
                        );
                        const showGlmThinkingControl = shouldShowGlmThinkingThreshold(
                          mappingChannel?.provider ?? "openai",
                          targetProfile?.model ?? item.targetModel
                        );

                        return (
                          <div key={item.id} className="tc-model-item">
                            <div className="tc-model-head">
                              <strong>映射 #{index + 1}</strong>
                              <div className="tc-model-actions">
                                <span>{t("切模", "Overflow")}</span>
                                <Switch
                                  value={item.dynamicModelSwitch}
                                  onChange={(value) =>
                                    updateKeyModelMapping(item.id, (prev: any) => ({
                                      ...prev,
                                      dynamicModelSwitch: Boolean(value)
                                    }))
                                  }
                                />
                                <span className="tc-sep">|</span>
                                <span>{t("启用", "Enabled")}</span>
                                <Switch
                                  value={item.enabled}
                                  onChange={(value) =>
                                    updateKeyModelMapping(item.id, (prev: any) => ({
                                      ...prev,
                                      enabled: Boolean(value)
                                    }))
                                  }
                                />
                                <Button
                                  variant="outline"
                                  theme="danger"
                                  onClick={() => {
                                    const dialog = DialogPlugin.confirm({
                                      header: t("确认删除", "Confirm Delete"),
                                      body: t("确认删除该模型映射？", "Delete this model mapping?"),
                                      confirmBtn: t("删除", "Delete"),
                                      onConfirm: () => { removeKeyModelMapping(item.id); dialog.hide(); },
                                      onClose: () => dialog.hide(),
                                    });
                                  }}
                                >
                                  {t("删除", "Delete")}
                                </Button>
                              </div>
                            </div>

                            <div className="tc-form-grid">
                              <label className="tc-field">
                                <span>{t("客户端模型名", "Client Model Name")}</span>
                                <Input
                                  value={item.clientModel}
                                  onChange={(value) =>
                                    updateKeyModelMapping(item.id, (prev: any) => ({
                                      ...prev,
                                      clientModel: value
                                    }))
                                  }
                                  placeholder={t("如：gpt-5.3-codex", "e.g. gpt-5.3-codex")}
                                  clearable
                                />
                              </label>

                              <label className="tc-field">
                                <span>{t("内部模型名", "Internal Model Name")}</span>
                                <Input
                                  value={item.targetModel}
                                  onChange={(value) =>
                                    updateKeyModelMapping(item.id, (prev: any) => ({
                                      ...prev,
                                      targetModel: value
                                    }))
                                  }
                                  placeholder={t("如：glm-5 / gpt-4.1-mini", "e.g. glm-5 / gpt-4.1-mini")}
                                  clearable
                                />
                              </label>

                              <label className="tc-field">
                                <span>
                                  {t("绑定上游渠道（映射级）", "Bind Upstream (Mapping-level)")}
                                </span>
                                <Select
                                  value={
                                    typeof item.upstreamChannelId === "number"
                                      ? String(item.upstreamChannelId)
                                      : "__inherit__"
                                  }
                                  options={mappingBindChannelOptions}
                                  onChange={(value) => {
                                    const normalized = normalizeSelectValue(value);
                                    const parsed = Number(normalized);
                                    updateKeyModelMapping(item.id, (prev: any) => ({
                                      ...prev,
                                      upstreamChannelId:
                                        normalized === "__inherit__" ||
                                        !Number.isInteger(parsed) ||
                                        parsed <= 0
                                          ? null
                                          : parsed
                                    }));
                                  }}
                                />
                              </label>

                              {showDoubaoThinkingControl ? (
                                <label className="tc-field">
                                  <span>{t("豆包深度思考", "Doubao Thinking")}</span>
                                  <Select
                                    value={item.thinkingType ?? "__inherit__"}
                                    options={[
                                      {
                                        value: "__inherit__",
                                        label: t("继承请求参数", "Inherit request")
                                      },
                                      ...DOUBAO_THINKING_TYPES.map((thinkingType) => ({
                                        value: thinkingType,
                                        label: formatDoubaoThinkingTypeLabel(thinkingType)
                                      }))
                                    ]}
                                    onChange={(value) => {
                                      const normalized = normalizeSelectValue(value);
                                      updateKeyModelMapping(item.id, (prev: any) => ({
                                        ...prev,
                                        thinkingType:
                                          normalized === "enabled" ||
                                          normalized === "disabled" ||
                                          normalized === "auto"
                                            ? normalized
                                            : null
                                      }));
                                    }}
                                  />
                                </label>
                              ) : null}

                              {showDoubaoThinkingControl ? (
                                <p className="tc-upstream-advice tc-field-wide">
                                  {t(
                                    "映射级可固定豆包 thinking.type（enabled/disabled/auto）。选择“继承请求参数”时，客户端传什么就透传什么；未传时按网关自动策略处理。",
                                    "Mapping-level setting can pin Doubao thinking.type (enabled/disabled/auto). With 'Inherit request', client input is forwarded as-is; if absent, gateway auto strategy is used."
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl ? (
                                <label className="tc-field">
                                  <span>
                                    {t(
                                      "GLM 深度思考触发阈值",
                                      "GLM Deep Thinking Threshold"
                                    )}
                                  </span>
                                  <Select
                                    value={targetProfile?.glmCodexThinkingThreshold ?? "low"}
                                    options={GLM_CODEX_THINKING_THRESHOLDS.map((threshold) => ({
                                      value: threshold,
                                      label: formatGlmThinkingThresholdLabel(threshold)
                                    }))}
                                    onChange={(value) =>
                                      void updateBoundChannelGlmThinkingThreshold(
                                        item,
                                        normalizeGlmCodexThinkingThreshold(
                                          normalizeSelectValue(value)
                                        )
                                      )
                                    }
                                    disabled={
                                      loading ||
                                      savingKey ||
                                      savingChannel ||
                                      !mappingChannel ||
                                      !targetProfile
                                    }
                                  />
                                </label>
                              ) : null}

                              {showGlmThinkingControl && mappingChannel && targetProfile ? (
                                <p className="tc-upstream-advice tc-field-wide">
                                  {t(
                                    `当前映射会继承渠道「${mappingChannel.name}」中内部模型 ${targetProfile.model} 的思考阈值设置。达到该力度时，Codex 的 reasoning_effort 才会自动映射为 GLM thinking.enabled。`,
                                    `This mapping inherits the thinking threshold from internal model ${targetProfile.model} in channel ${mappingChannel.name}. Codex reasoning_effort only auto-maps to GLM thinking.enabled once the threshold is reached.`
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl && !mappingChannel ? (
                                <p className="tc-tip err tc-field-wide">
                                  {t(
                                    "请先为该映射选择上游渠道，或让它继承 Key 绑定渠道。",
                                    "Select an upstream channel for this mapping, or make it inherit the key-level channel first."
                                  )}
                                </p>
                              ) : null}

                              {showGlmThinkingControl && mappingChannel && !targetProfile ? (
                                <p className="tc-tip err tc-field-wide">
                                  {t(
                                    "这是一个 GLM 目标模型，但当前映射渠道的模型池里还没有找到同名内部模型，所以暂时无法设置思考阈值。请先在对应上游渠道模型池中添加或修正该模型。",
                                    "This is a GLM target model, but no matching internal model was found in the selected channel model pool yet, so the thinking threshold cannot be configured here. Add or fix the model in that upstream channel pool first."
                                  )}
                                </p>
                              ) : null}
                            </div>
                            {item.dynamicModelSwitch ? (
                              <div className="tc-mapping-overflow">
                                <span className="tc-sub-label">{t("上下文溢出切模", "Context Overflow Switch")}</span>
                                <div className="tc-form-grid">
                                  <label className="tc-field">
                                    <span>{t("切换阈值（输入 Token）", "Switch Threshold (prompt tokens)")}</span>
                                    <Input
                                      type="number"
                                      value={String(item.contextSwitchThreshold)}
                                      onChange={(value) => {
                                        const n = Number(value);
                                        if (!Number.isNaN(n)) {
                                          updateKeyModelMapping(item.id, (prev: any) => ({
                                            ...prev,
                                            contextSwitchThreshold: n
                                          }));
                                        }
                                      }}
                                    />
                                  </label>
                                  <label className="tc-field">
                                    <span>{t("溢出模型（超阈值切换）", "Overflow Model (above threshold)")}</span>
                                    <Select
                                      value={item.contextOverflowModel || undefined}
                                      options={mappingOverflowModelOptions}
                                      placeholder={t("可跨上游选择任意已启用模型", "Select any enabled model across upstreams")}
                                      onChange={(value) =>
                                        updateKeyModelMapping(item.id, (prev: any) => ({
                                          ...prev,
                                          contextOverflowModel: normalizeSelectValue(value)
                                        }))
                                      }
                                    />
                                  </label>
                                  <p className="tc-upstream-advice tc-field-wide">
                                    {t(
                                      "映射级溢出模型优先于 Key 级设置。超阈值后会直接切到你选定的渠道与模型。",
                                      "Mapping-level overflow model takes priority over key-level settings. Once the threshold is exceeded, requests switch directly to the selected channel and model."
                                    )}
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    )
                  ) : (
                    <p className="tc-upstream-advice">
                      {t(
                        "未配置映射时，客户端模型名按现有模型池（model/alias）直接解析。",
                        "Without mapping, client model names are resolved directly from current model pool (model/alias)."
                      )}
                    </p>
                  )}

                  {selectedChannelForKey ? (
                    <div className="tc-channel-summary">
                      <div className="tc-meta-row">
                        <Tag theme="primary" variant="light-outline">
                          {t("渠道供应商", "Upstream Provider")}: {PROVIDER_META[selectedChannelForKey.provider].label}
                        </Tag>
                        <Tag variant="light-outline">
                          {t("默认模型", "Default Model")}: {selectedChannelForKey.defaultModel}
                        </Tag>
                        <Tag variant="light-outline">
                          {t("协议", "Wire API")}: {selectedChannelForKey.upstreamWireApi}
                        </Tag>
                      </div>
                      <div className="tc-channel-endpoint">
                        <span className="tc-channel-endpoint-label">
                          {t("上游地址", "Upstream URL")}
                        </span>
                        <code>{selectedChannelForKey.upstreamBaseUrl}</code>
                      </div>
                    </div>
                  ) : (
                    <p className="tc-tip err">{t("请先在「上游渠道」创建渠道，再回来绑定本地 Key。", "Create an upstream first, then bind local key here.")}</p>
                  )}

                  <p className="tc-upstream-advice">
                    {t("保存入口统一在本页底部，仅保留一个", "Save action is unified at bottom with one button")}「
                    {isNewKey ? t("创建 Key", "Create Key") : t("保存 Key", "Save Key")}」。
                  </p>
                  <p className="tc-tip">
                    {t(
                      "导入预览与原生 Codex 导出已单独放到「配置导出」页面，便于专门查看和复制。",
                      "Import previews and native Codex export have moved to the dedicated Export page for cleaner access."
                    )}
                  </p>
                </section>
  );
}
