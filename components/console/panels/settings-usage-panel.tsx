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
import { ActiveFilterSummary, FilterPresetBar } from "@/components/console/filters";


export function SettingsUsagePanel(props: any) {
  const {
    t,
    normalizeSelectValue,
    hasCustomUsageDateRange,
    usageMinutes,
    setUsageMinutes,
    setUsageDateRange,
    autoRefreshUsage,
    setAutoRefreshUsage,
    usageDateRange,
    usageMetric,
    setUsageMetric,
    usageBucketMode,
    setUsageBucketMode,
    usageKeyFilter,
    usageKeyOptions,
    setUsageKeyFilter,
    usageModelFilter,
    usageModelOptions,
    setUsageModelFilter,
    usageRouteFilter,
    usageRouteOptions,
    setUsageRouteFilter,
    usageRequestWireFilter,
    usageRequestWireOptions,
    setUsageRequestWireFilter,
    usageUpstreamWireFilter,
    usageUpstreamWireOptions,
    setUsageUpstreamWireFilter,
    usageStreamFilter,
    usageStreamOptions,
    setUsageStreamFilter,
    usageTimelineLimit,
    setUsageTimelineLimit,
    loadUsageReport,
    clearUsageReport,
    resetUsageFilters,
    loadingUsage,
    usageReport,
    locale,
    usageActiveFilters,
    usageSavedPresets,
    usageSelectedPresetId,
    applyUsagePresetById,
    saveUsagePreset,
    deleteUsagePreset,
    usagePrimaryMetricMeta,
    resolvedUsageBucketMinutes,
    usageTimelineChartOption,
    usageTimelineChartHeight,
    usagePerKeyChartOption,
    usagePerModelChartOption,
    ReactECharts
  } = props;

  return (
    <section className="tc-section">
      <h3>{t("Token 用量统计报表", "Token Usage Report")}</h3>
      <p className="tc-upstream-advice">
        {t(
          "按分钟聚合展示每个本地 Key 与模型的 token 用量，支持自动刷新和按 Key 筛选。",
          "Shows per-minute aggregated token usage by local key and model. Supports auto refresh and key filter."
        )}
      </p>

      <FilterPresetBar
        presets={usageSavedPresets.map((item: any) => ({ id: item.id, name: item.name }))}
        activePresetId={usageSelectedPresetId === "all" ? undefined : usageSelectedPresetId}
        onSelectPreset={(id) => applyUsagePresetById(id || "all")}
        onSavePreset={() => saveUsagePreset()}
        onDeletePreset={(id) => {
          if (id) {
            applyUsagePresetById(id);
            deleteUsagePreset();
          }
        }}
        onReset={resetUsageFilters}
      />

      <div className="tc-usage-toolbar">
        <div className="tc-usage-range">
          <span>时间范围</span>
          <div className="tc-usage-range-buttons">
            {USAGE_RANGE_OPTIONS.map((item) => (
              <Button
                key={`usage-range-${item.minutes}`}
                size="small"
                theme={!hasCustomUsageDateRange && usageMinutes === item.minutes ? "primary" : "default"}
                variant={
                  !hasCustomUsageDateRange && usageMinutes === item.minutes ? "base" : "outline"
                }
                onClick={() => {
                  setUsageMinutes(item.minutes);
                  setUsageDateRange([]);
                }}
              >
                {item.label}
              </Button>
            ))}
            {hasCustomUsageDateRange ? (
              <Button size="small" variant="outline" onClick={() => setUsageDateRange([])}>
                清除自由日期
              </Button>
            ) : null}
          </div>
        </div>

        <label className="tc-switchline">
          <span>自动刷新（5秒）</span>
          <Switch
            value={autoRefreshUsage}
            onChange={(value) => setAutoRefreshUsage(Boolean(value))}
          />
        </label>

        <label className="tc-field">
          <span>统计窗口</span>
          <Select
            value={String(usageMinutes)}
            options={[
              { label: "30 分钟", value: "30" },
              { label: "1 小时", value: "60" },
              { label: "3 小时", value: "180" },
              { label: "12 小时", value: "720" },
              { label: "24 小时", value: "1440" },
              { label: "7 天", value: "10080" }
            ]}
            style={{ width: 150 }}
            onChange={(value) => {
              const next = Number(normalizeSelectValue(value));
              if (Number.isFinite(next)) {
                setUsageMinutes(next);
                setUsageDateRange([]);
              }
            }}
          />
        </label>

        <label className="tc-field">
          <span>自由日期范围</span>
          <DateRangePicker
            enableTimePicker
            clearable
            valueType="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm:ss"
            value={usageDateRange}
            placeholder={["开始时间", "结束时间"]}
            style={{ width: "min(360px, 100%)" }}
            onChange={(value) => {
              if (!Array.isArray(value)) {
                setUsageDateRange([]);
                return;
              }
              const next = value.map((item) => String(item ?? "").trim());
              if (next.length === 2 && next[0] && next[1]) {
                setUsageDateRange([next[0], next[1]]);
                return;
              }
              setUsageDateRange([]);
            }}
          />
        </label>

        <label className="tc-field">
          <span>主指标</span>
          <Select
            value={usageMetric}
            options={[
              { label: "请求数", value: "requestCount" },
              { label: "输入 Token", value: "promptTokens" },
              { label: "输出 Token", value: "completionTokens" },
              { label: "Total Token", value: "totalTokens" }
            ]}
            style={{ width: 150 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              if (next in USAGE_METRIC_META) {
                setUsageMetric(next);
              }
            }}
          />
        </label>

        <label className="tc-field">
          <span>时间桶</span>
          <Select
            value={usageBucketMode}
            options={[
              { label: "自动", value: "auto" },
              { label: "1 分钟", value: "1" },
              { label: "5 分钟", value: "5" },
              { label: "15 分钟", value: "15" },
              { label: "1 小时", value: "60" }
            ]}
            style={{ width: 140 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              if (["auto", "1", "5", "15", "60"].includes(next)) {
                setUsageBucketMode(next);
              }
            }}
          />
        </label>

        <label className="tc-field">
          <span>本地 Key 筛选</span>
          <Select
            value={usageKeyFilter ? String(usageKeyFilter) : "__all__"}
            options={usageKeyOptions}
            style={{ width: 300 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              if (next === "__all__") {
                setUsageKeyFilter(null);
                return;
              }
              const id = Number(next);
              if (Number.isFinite(id) && id > 0) {
                setUsageKeyFilter(id);
              }
            }}
          />
        </label>

        <label className="tc-field">
          <span>{t("真实模型", "Upstream Model")}</span>
          <Select
            value={usageModelFilter || "__all__"}
            options={usageModelOptions}
            style={{ width: 220 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              setUsageModelFilter(next === "__all__" ? "" : next);
            }}
          />
        </label>

        <label className="tc-field">
          <span>{t("路由", "Route")}</span>
          <Select
            value={usageRouteFilter || "__all__"}
            options={usageRouteOptions}
            style={{ width: 180 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              setUsageRouteFilter(next === "__all__" ? "" : next);
            }}
          />
        </label>

        <label className="tc-field">
          <span>{t("请求协议", "Request API")}</span>
          <Select
            value={usageRequestWireFilter || "__all__"}
            options={usageRequestWireOptions}
            style={{ width: 190 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              setUsageRequestWireFilter(next === "__all__" ? "" : next);
            }}
          />
        </label>

        <label className="tc-field">
          <span>{t("上游协议", "Upstream API")}</span>
          <Select
            value={usageUpstreamWireFilter || "__all__"}
            options={usageUpstreamWireOptions}
            style={{ width: 190 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              setUsageUpstreamWireFilter(next === "__all__" ? "" : next);
            }}
          />
        </label>

        <label className="tc-field">
          <span>{t("流式模式", "Stream Mode")}</span>
          <Select
            value={usageStreamFilter || "__all__"}
            options={usageStreamOptions}
            style={{ width: 170 }}
            onChange={(value) => {
              const next = normalizeSelectValue(value);
              if (next === "__all__") {
                setUsageStreamFilter("");
                return;
              }
              if (next === "stream" || next === "non_stream") {
                setUsageStreamFilter(next);
              }
            }}
          />
        </label>

        <label className="tc-field">
          <span>分钟明细上限</span>
          <Select
            value={String(usageTimelineLimit)}
            options={[
              { label: "200 行", value: "200" },
              { label: "600 行", value: "600" },
              { label: "1200 行", value: "1200" },
              { label: "2000 行", value: "2000" }
            ]}
            style={{ width: 140 }}
            onChange={(value) => {
              const next = Number(normalizeSelectValue(value));
              if (Number.isFinite(next)) {
                setUsageTimelineLimit(next);
              }
            }}
          />
        </label>

        <div className="tc-usage-toolbar-actions">
          <Button
            variant="outline"
            theme="default"
            onClick={() => void loadUsageReport()}
            disabled={loadingUsage}
          >
            手动刷新
          </Button>
          <Button
            variant="outline"
            theme="danger"
            onClick={() => void clearUsageReport()}
            disabled={loadingUsage}
          >
            清空统计
          </Button>
        </div>
      </div>

      <ActiveFilterSummary items={usageActiveFilters} onClearAll={resetUsageFilters} />

      {!usageReport || usageReport.summary.requestCount === 0 ? (
        loadingUsage ? (
          <UsageLoadingSkeleton />
        ) : (
          <div className="tc-usage-empty-state">
            <div className="tc-usage-empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="8" y="24" width="12" height="28" rx="3" fill="#e2e8f0" />
                <rect x="26" y="16" width="12" height="36" rx="3" fill="#cbd5e1" />
                <rect x="44" y="8" width="12" height="44" rx="3" fill="#94a3b8" />
              </svg>
            </div>
            <p className="tc-usage-empty-title">暂无 Token 用量数据</p>
            <p className="tc-usage-empty-desc">先发起一次模型请求后再查看。数据将按分钟自动聚合。</p>
          </div>
        )
      ) : (
        <>
          <div className="tc-stat-cards-grid">
            <UsageStatCard variant="requests" value={usageReport.summary.requestCount} delay={0} locale={locale} />
            <UsageStatCard variant="prompt" value={usageReport.summary.promptTokens} delay={0.08} locale={locale} />
            <UsageStatCard
              variant="completion"
              value={usageReport.summary.completionTokens}
              delay={0.16}
              locale={locale}
            />
            <UsageStatCard variant="total" value={usageReport.summary.totalTokens} delay={0.24} locale={locale} />
          </div>

          {loadingUsage ? (
            <div className="tc-usage-refresh-bar">
              <div className="tc-usage-refresh-bar-inner" />
            </div>
          ) : null}

          <div className="tc-usage-charts">
            <div className="tc-usage-chart-card tc-usage-chart-wide">
              <h4>{t("趋势图", "Trend")}（{usagePrimaryMetricMeta.label}）</h4>
              <p className="tc-usage-chart-note">
                {t("时间桶", "Time bucket")} {resolvedUsageBucketMinutes} {t("分钟", "min")}，{t("统计", "covering")}
                {hasCustomUsageDateRange
                  ? ` ${usageDateRange[0]} ${t("至", "to")} ${usageDateRange[1]}`
                  : usageMinutes >= 1440
                    ? ` ${t("最近", "last")} ${(usageMinutes / 1440).toFixed(usageMinutes % 1440 === 0 ? 0 : 1)} ${t("天", "days")}`
                    : ` ${t("最近", "last")} ${usageMinutes} ${t("分钟", "min")}`}
                {t("的用量趋势", " usage trend.")}
              </p>
              {usageTimelineChartOption ? (
                <ReactECharts
                  notMerge
                  lazyUpdate
                  option={usageTimelineChartOption}
                  style={{ width: "100%", height: usageTimelineChartHeight }}
                />
              ) : (
                <p className="tc-upstream-advice">{t("暂无分钟趋势数据。", "No timeline data available.")}</p>
              )}
            </div>

            <div className="tc-usage-chart-card">
              <h4>Key Top12（{usagePrimaryMetricMeta.shortLabel}）</h4>
              <p className="tc-usage-chart-note">
                {t("对比不同本地 Key 的核心指标分布。", "Compare key-level metric distribution.")}
              </p>
              {usagePerKeyChartOption ? (
                <ReactECharts
                  notMerge
                  lazyUpdate
                  option={usagePerKeyChartOption}
                  style={{ width: "100%", height: 320 }}
                />
              ) : (
                <p className="tc-upstream-advice">{t("暂无 Key 维度数据。", "No key-level data.")}</p>
              )}
            </div>

            <div className="tc-usage-chart-card">
              <h4>{t("真实模型 Top10", "Upstream Model Top10")}（{usagePrimaryMetricMeta.shortLabel}）</h4>
              <p className="tc-usage-chart-note">
                {t("识别高消耗模型，辅助做策略切换与限流。", "Identify high-consumption models for policy tuning.")}
              </p>
              {usagePerModelChartOption ? (
                <ReactECharts
                  notMerge
                  lazyUpdate
                  option={usagePerModelChartOption}
                  style={{ width: "100%", height: 320 }}
                />
              ) : (
                <p className="tc-upstream-advice">{t("暂无模型维度数据。", "No model-level data.")}</p>
              )}
            </div>
          </div>

          <div className="tc-usage-charts">
            {usageReport.perKey.length > 0 ? (
              <UsagePieChart
                title={`Key 分布（${usagePrimaryMetricMeta.shortLabel}）`}
                slices={usageReport.perKey.slice(0, 8).map((item: any) => ({
                  name: item.keyName,
                  value: pickUsageMetricValue(item, usageMetric)
                }))}
                height={260}
                delay={0.4}
                EChartsComponent={ReactECharts}
              />
            ) : null}
            {usageReport.perModel.length > 0 ? (
              <UsagePieChart
                title={`模型分布（${usagePrimaryMetricMeta.shortLabel}）`}
                slices={usageReport.perModel.slice(0, 8).map((item: any) => ({
                  name: item.model,
                  value: pickUsageMetricValue(item, usageMetric)
                }))}
                height={260}
                delay={0.5}
                EChartsComponent={ReactECharts}
              />
            ) : null}
          </div>

          <div className="tc-usage-grid">
            <div className="tc-usage-block">
              <h4>按 Key 汇总</h4>
              <div className="tc-usage-table-wrap">
                <table className="tc-usage-table">
                  <thead>
                    <tr>
                      <th>本地 Key</th>
                      <th>请求数</th>
                      <th>输入</th>
                      <th>输出</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageReport.perKey.map((item: any) => (
                      <tr key={`key-${item.keyId}`}>
                        <td>{item.keyName}</td>
                        <td>{formatNumber(item.requestCount)}</td>
                        <td>{formatNumber(item.promptTokens)}</td>
                        <td>{formatNumber(item.completionTokens)}</td>
                        <td>{formatNumber(item.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tc-usage-block">
              <h4>按真实模型汇总</h4>
              <div className="tc-usage-table-wrap">
                <table className="tc-usage-table">
                  <thead>
                    <tr>
                      <th>真实模型（上游）</th>
                      <th>所属 Key</th>
                      <th>请求数</th>
                      <th>输入</th>
                      <th>输出</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageReport.perModel.slice(0, 120).map((item: any, index: number) => (
                      <tr key={`model-${item.keyId}-${item.model}-${index}`}>
                        <td>{item.model}</td>
                        <td>{item.keyName}</td>
                        <td>{formatNumber(item.requestCount)}</td>
                        <td>{formatNumber(item.promptTokens)}</td>
                        <td>{formatNumber(item.completionTokens)}</td>
                        <td>{formatNumber(item.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="tc-usage-block">
            <h4>按分钟明细（真实模型）</h4>
            <div className="tc-usage-table-wrap">
              <table className="tc-usage-table">
                <thead>
                  <tr>
                    <th>分钟</th>
                    <th>Key</th>
                    <th>真实模型（上游）</th>
                    <th>请求数</th>
                    <th>输入</th>
                    <th>输出</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {usageReport.timeline.map((item: any, index: number) => (
                    <tr key={`timeline-${item.minute}-${item.keyId}-${item.model}-${index}`}>
                      <td>{formatCnDate(item.minute)}</td>
                      <td>{item.keyName}</td>
                      <td>{item.model}</td>
                      <td>{formatNumber(item.requestCount)}</td>
                      <td>{formatNumber(item.promptTokens)}</td>
                      <td>{formatNumber(item.completionTokens)}</td>
                      <td>{formatNumber(item.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
