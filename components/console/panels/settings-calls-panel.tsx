import {
  Button,
  Checkbox,
  DateRangePicker,
  DialogPlugin,
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
import { ActiveFilterSummary, FilterPresetBar } from "@/components/console/filters";


export function SettingsCallsPanel(props: any) {
  const {
    t,
    autoRefreshAiCallLogs,
    setAutoRefreshAiCallLogs,
    aiCallLogLimit,
    setAiCallLogLimit,
    normalizeSelectValue,
    aiCallKeyFilter,
    aiCallKeyOptions,
    setAiCallKeyFilter,
    aiCallModelFilter,
    aiCallModelSelectOptions,
    setAiCallModelFilter,
    aiCallTypeFilter,
    aiCallTypeOptions,
    setAiCallTypeFilter,
    aiCallDateRange,
    setAiCallDateRange,
    aiCallKeywordFilter,
    setAiCallKeywordFilter,
    aiCallRouteFilter,
    aiCallRouteOptions,
    setAiCallRouteFilter,
    aiCallRequestWireFilter,
    aiCallRequestWireOptions,
    setAiCallRequestWireFilter,
    aiCallUpstreamWireFilter,
    aiCallUpstreamWireOptions,
    setAiCallUpstreamWireFilter,
    aiCallRequestedModelFilter,
    aiCallRequestedModelOptions,
    setAiCallRequestedModelFilter,
    aiCallClientModelFilter,
    aiCallClientModelOptions,
    setAiCallClientModelFilter,
    aiCallStreamFilter,
    aiCallStreamOptions,
    setAiCallStreamFilter,
    applyAiCallQuickRange,
    hasCustomAiCallDateRange,
    expandVisibleAiCallLogs,
    collapseVisibleAiCallLogs,
    expandedAiCallLogIds,
    resetAiCallFilters,
    clearAiCallLogs,
    loadingAiCallLogs,
    aiCallStats,
    deferredAiCallLogs,
    aiCallActiveFilters,
    aiCallSavedPresets,
    aiCallSelectedPresetId,
    applyAiCallPresetById,
    saveAiCallPreset,
    deleteAiCallPreset,
    expandedAiCallLogIdSet,
    toggleAiCallLogExpanded,
    setPreviewImage
  } = props;

  return (
    <section className="tc-section">
      <h3>{t("AI 调用日志", "AI Call Logs")}</h3>
      <p className="tc-upstream-advice">
        {t(
          "展示系统提示词、用户提问、模型回答，以及真实上游模型（实际调用模型）信息。支持 Key、时间范围、关键词、请求路由/协议、请求模型、客户端模型、真实模型、流式模式、调用类型等组合筛选，并可单独统计跨模型辅助视觉调用。",
          "Shows system prompt, user question, assistant response, and the real upstream model. Supports combined filters by key, time range, keyword, route/APIs, requested/client/upstream model, stream mode, and call type, plus dedicated vision-fallback stats."
        )}
      </p>

      <FilterPresetBar
        presets={aiCallSavedPresets.map((item: any) => ({ id: item.id, name: item.name }))}
        activePresetId={aiCallSelectedPresetId === "all" ? undefined : aiCallSelectedPresetId}
        onSelectPreset={(id) => applyAiCallPresetById(id || "all")}
        onSavePreset={() => saveAiCallPreset()}
        onDeletePreset={(id) => {
          if (id) {
            applyAiCallPresetById(id);
            deleteAiCallPreset();
          }
        }}
        onReset={resetAiCallFilters}
      />

      <div className="tc-log-toolbar">
        <div className="tc-log-toolbar-group">
          <label className="tc-switchline">
            <span>{t("自动刷新（8秒）", "Auto Refresh (8s)")}</span>
            <Switch
              value={autoRefreshAiCallLogs}
              onChange={(value) => setAutoRefreshAiCallLogs(Boolean(value))}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("拉取条数", "Fetch Limit")}</span>
            <Select
              value={String(aiCallLogLimit)}
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
                  setAiCallLogLimit(next);
                }
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("筛选 Key", "Filter Key")}</span>
            <Select
              value={aiCallKeyFilter ? String(aiCallKeyFilter) : "__all__"}
              options={aiCallKeyOptions}
              style={{ width: 220 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                if (next === "__all__") {
                  setAiCallKeyFilter(null);
                  return;
                }
                const id = Number(next);
                if (Number.isFinite(id) && id > 0) {
                  setAiCallKeyFilter(id);
                }
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("筛选真实模型", "Filter Upstream Model")}</span>
            <Select
              value={aiCallModelFilter || "__all__"}
              options={aiCallModelSelectOptions}
              style={{ width: 280 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallModelFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("调用类型", "Call Type")}</span>
            <Select
              value={aiCallTypeFilter || "__all__"}
              options={aiCallTypeOptions}
              style={{ width: 180 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                if (next === "__all__") {
                  setAiCallTypeFilter("");
                  return;
                }
                if (next === "main" || next === "vision_fallback") {
                  setAiCallTypeFilter(next);
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="tc-log-toolbar tc-log-toolbar-detail">
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("时间范围", "Time Range")}</span>
            <DateRangePicker
              enableTimePicker
              clearable
              valueType="YYYY-MM-DD HH:mm:ss"
              format="YYYY-MM-DD HH:mm:ss"
              value={aiCallDateRange}
              placeholder={[t("开始时间", "Start time"), t("结束时间", "End time")]}
              style={{ width: 340 }}
              onChange={(value) => {
                if (!Array.isArray(value)) {
                  setAiCallDateRange([]);
                  return;
                }
                const next = value.map((item) => String(item ?? "").trim());
                if (next.length === 2 && next[0] && next[1]) {
                  setAiCallDateRange([next[0], next[1]]);
                  return;
                }
                setAiCallDateRange([]);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group tc-log-range-buttons">
          {AI_CALL_RANGE_OPTIONS.map((item) => (
            <Button
              key={`call-range-${item.minutes}`}
              size="small"
              variant="outline"
              onClick={() => applyAiCallQuickRange(item.minutes)}
            >
              {item.label}
            </Button>
          ))}
          {hasCustomAiCallDateRange ? (
            <Button size="small" variant="outline" onClick={() => setAiCallDateRange([])}>
              {t("清除时间", "Clear Time")}
            </Button>
          ) : null}
        </div>
        <div className="tc-log-toolbar-group tc-log-field-wide">
          <label className="tc-field">
            <span>{t("关键词", "Keyword")}</span>
            <Input
              value={aiCallKeywordFilter}
              onChange={(value) => setAiCallKeywordFilter(value)}
              placeholder={t("搜索提示词、回答、模型、Key", "Search prompts, response, models, key")}
              clearable
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("路由", "Route")}</span>
            <Select
              value={aiCallRouteFilter || "__all__"}
              options={aiCallRouteOptions}
              style={{ width: 180 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallRouteFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("请求协议", "Request API")}</span>
            <Select
              value={aiCallRequestWireFilter || "__all__"}
              options={aiCallRequestWireOptions}
              style={{ width: 190 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallRequestWireFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("上游协议", "Upstream API")}</span>
            <Select
              value={aiCallUpstreamWireFilter || "__all__"}
              options={aiCallUpstreamWireOptions}
              style={{ width: 190 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallUpstreamWireFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("请求模型", "Requested Model")}</span>
            <Select
              value={aiCallRequestedModelFilter || "__all__"}
              options={aiCallRequestedModelOptions}
              style={{ width: 220 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallRequestedModelFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("客户端模型", "Client Model")}</span>
            <Select
              value={aiCallClientModelFilter || "__all__"}
              options={aiCallClientModelOptions}
              style={{ width: 220 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                setAiCallClientModelFilter(next === "__all__" ? "" : next);
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group">
          <label className="tc-field">
            <span>{t("流式模式", "Stream Mode")}</span>
            <Select
              value={aiCallStreamFilter || "__all__"}
              options={aiCallStreamOptions}
              style={{ width: 170 }}
              onChange={(value) => {
                const next = normalizeSelectValue(value);
                if (next === "__all__") {
                  setAiCallStreamFilter("");
                  return;
                }
                if (next === "stream" || next === "non_stream") {
                  setAiCallStreamFilter(next);
                }
              }}
            />
          </label>
        </div>
        <div className="tc-log-toolbar-group tc-log-toolbar-actions">
          <Button
            variant="outline"
            onClick={expandVisibleAiCallLogs}
            disabled={deferredAiCallLogs.length === 0}
          >
            {t("展开全部", "Expand All")}
          </Button>
          <Button
            variant="outline"
            onClick={collapseVisibleAiCallLogs}
            disabled={expandedAiCallLogIds.length === 0}
          >
            {t("收起全部", "Collapse All")}
          </Button>
          <Button variant="outline" onClick={resetAiCallFilters}>
            {t("重置筛选", "Reset Filters")}
          </Button>
          <Button
            variant="outline"
            theme="danger"
            onClick={() => {
              const dialog = DialogPlugin.confirm({
                header: t("确认清空", "Confirm Clear"),
                body: t("此操作不可撤销，确认清空所有 AI 调用日志？", "This cannot be undone. Clear all AI call logs?"),
                confirmBtn: t("清空", "Clear"),
                onConfirm: () => { void clearAiCallLogs(); dialog.hide(); },
                onClose: () => dialog.hide(),
              });
            }}
            disabled={loadingAiCallLogs}
          >
            {t("清空日志", "Clear Logs")}
          </Button>
        </div>
      </div>

      <ActiveFilterSummary items={aiCallActiveFilters} onClearAll={resetAiCallFilters} />

      <div className="tc-meta-row">
        <Tag variant="light-outline">匹配调用={aiCallStats.matched}</Tag>
        <Tag variant="light-outline">主调用={aiCallStats.main}</Tag>
        <Tag theme="warning" variant="light-outline">
          辅助视觉={aiCallStats.visionFallback}
        </Tag>
        {aiCallStats.visionByModel.slice(0, 5).map((item: any) => (
          <Tag key={`vision-model-${item.model}`} theme="primary" variant="light-outline">
            视觉模型 {item.model} · {item.count}
          </Tag>
        ))}
        {aiCallStats.visionByKey.slice(0, 3).map((item: any) => (
          <Tag key={`vision-key-${item.keyId}`} variant="light-outline">
            视觉 Key {item.keyName} · {item.count}
          </Tag>
        ))}
        {hasCustomAiCallDateRange ? (
          <Tag theme="primary" variant="light-outline">
            {t("范围", "Range")}={aiCallDateRange[0]} ~ {aiCallDateRange[1]}
          </Tag>
        ) : null}
        {aiCallKeywordFilter.trim() ? (
          <Tag theme="primary" variant="light-outline">
            {t("关键词", "Keyword")}=
            {aiCallKeywordFilter.trim().slice(0, 24)}
            {aiCallKeywordFilter.trim().length > 24 ? "..." : ""}
          </Tag>
        ) : null}
      </div>

      {deferredAiCallLogs.length === 0 ? (
        <p className="tc-upstream-advice">
          {t(
            "暂无 AI 调用日志。先发起一次模型请求后再查看。",
            "No AI call logs yet. Send one model request first."
          )}
        </p>
      ) : (
        <div className="tc-log-list">
          {deferredAiCallLogs.map((item: any) => {
            const assistantReasoning = item.assistantReasoning?.trim() || "";
            const assistantResponse = item.assistantResponse?.trim() || "";
            const displayAssistantResponse =
              assistantReasoning && assistantReasoning === assistantResponse
                ? ""
                : item.assistantResponse || "";
            const expanded = expandedAiCallLogIdSet.has(item.id);
            const previewText = summarizeLogPreview(
              displayAssistantResponse,
              assistantReasoning,
              item.userPrompt || "",
              item.conversationTranscript || ""
            );

            return (
              <article className="tc-log-item tc-log-item-ok" key={`${item.id}-${item.createdAt}`}>
                <div className="tc-log-head">
                  <div className="tc-log-head-main">
                    <div className="tc-log-tags">
                      <Tag theme="success" variant="light-outline">
                        OK
                      </Tag>
                      <Tag
                        theme={item.callType === "vision_fallback" ? "warning" : "primary"}
                        variant="light-outline"
                      >
                        {item.callType === "vision_fallback" ? "辅助视觉" : "主调用"}
                      </Tag>
                      <Tag variant="light-outline">{item.route}</Tag>
                      <Tag variant="light-outline">key={item.keyName}</Tag>
                      <Tag variant="light-outline">真实模型={item.upstreamModel}</Tag>
                      <Tag variant="light-outline">客户端模型={item.clientModel}</Tag>
                      <Tag variant="light-outline">请求模型={item.requestedModel}</Tag>
                      <Tag variant="light-outline">{item.stream ? "stream" : "non-stream"}</Tag>
                    </div>
                    <div className="tc-log-head-actions">
                      <span className="tc-log-time">{formatCnDate(item.createdAt)}</span>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => toggleAiCallLogExpanded(item.id)}
                      >
                        {expanded ? t("收起详情", "Collapse") : t("展开详情", "Expand")}
                      </Button>
                    </div>
                  </div>
                  <div className="tc-log-subline">
                    <code className="tc-log-path">
                      request={item.requestWireApi} · upstream={item.upstreamWireApi}
                    </code>
                    <span className="tc-log-id">log#{item.id}</span>
                  </div>
                </div>
                {expanded ? (
                  <>
                    {item.conversationTranscript?.trim() ? (
                      <div className="tc-log-panels">
                        <div className="tc-log-panel tc-log-panel-full">
                          <strong>完整上下文</strong>
                          <MarkdownLogBlock value={item.conversationTranscript} />
                        </div>
                      </div>
                    ) : null}
                    <div className="tc-log-panels">
                      <div className="tc-log-panel">
                        <strong>系统提示词</strong>
                        <MarkdownLogBlock value={item.systemPrompt || ""} />
                      </div>
                      <div className="tc-log-panel">
                        <strong>用户提问</strong>
                        <MarkdownLogBlock value={item.userPrompt || ""} />
                      </div>
                    </div>
                    {assistantReasoning ? (
                      <div className="tc-log-panels">
                        <div className="tc-log-panel tc-log-panel-full">
                          <strong>{t("深度思考", "Deep Thinking")}</strong>
                          <MarkdownLogBlock value={assistantReasoning} />
                        </div>
                      </div>
                    ) : null}
                    {Array.isArray(item.images) && item.images.length > 0 ? (
                      <div className="tc-log-panels">
                        <div className="tc-log-panel tc-log-panel-full">
                          <strong>图片快照</strong>
                          <div className="tc-log-image-grid">
                            {item.images.map((image: any, idx: number) => (
                              <article
                                className="tc-log-image-card"
                                key={`${item.id}-image-${idx}-${image.savedUrl ?? image.source}`}
                              >
                                {image.savedUrl ? (
                                  <button
                                    type="button"
                                    className="tc-log-image-zoom-btn"
                                    onClick={() =>
                                      setPreviewImage({
                                        url: image.savedUrl!,
                                        title: `log#${item.id} · 图片 ${idx + 1}`
                                      })
                                    }
                                  >
                                    <img
                                      src={image.savedUrl}
                                      alt={`log-${item.id}-image-${idx + 1}`}
                                      className="tc-log-image-thumb"
                                      loading="lazy"
                                    />
                                  </button>
                                ) : (
                                  <div className="tc-log-image-missing">图片保存失败</div>
                                )}
                                <div className="tc-log-image-meta">
                                  <span>来源：{image.sourceType}</span>
                                  <span>地址：{image.source}</span>
                                  <span>类型：{image.mimeType || "-"}</span>
                                  <span>
                                    大小：
                                    {typeof image.sizeBytes === "number"
                                      ? `${formatNumber(image.sizeBytes)} bytes`
                                      : "-"}
                                  </span>
                                  {image.error ? (
                                    <span className="tc-log-image-error">{image.error}</span>
                                  ) : null}
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {displayAssistantResponse ? (
                      <div className="tc-log-panels">
                        <div className="tc-log-panel tc-log-panel-full">
                          <strong>模型回答</strong>
                          <MarkdownLogBlock value={displayAssistantResponse} />
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="tc-log-preview">
                    {previewText ||
                      t(
                        "详情已折叠，点击“展开详情”查看完整日志。",
                        "Details collapsed. Click Expand to render the full log."
                      )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
