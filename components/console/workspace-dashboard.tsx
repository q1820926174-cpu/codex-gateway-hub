"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Database,
  Globe,
  Key,
  Plug,
  RefreshCw,
  Settings,
  TrendingUp,
  Zap
} from "lucide-react";
import { Button, DateRangePicker, Select, Tag } from "tdesign-react";
import {
  formatCompactNumber,
  formatMinuteLabel,
  formatNumber
} from "@/components/console/settings-console-helpers";
import { AntVAreaChart } from "@/components/ui/AntVPlots";
import { StaticTable } from "@/components/ui/StaticTable";
import {
  type GatewayKey,
  type UpstreamChannel,
  type UsageReport,
  type UsageMetricKey,
  USAGE_METRIC_META
} from "@/components/console/types";
import type { TableProps } from "tdesign-react";

type T = (zh: string, en: string) => string;
type DashboardRangePresetId =
  | "today"
  | "yesterday"
  | "last3Days"
  | "last7Days"
  | "last14Days"
  | "last30Days"
  | "thisMonth"
  | "lastMonth";
type DashboardGranularity = "auto" | "minute" | "hour" | "day";

type WorkspaceDashboardProps = {
  keys: GatewayKey[];
  channels: UpstreamChannel[];
  usageReport: UsageReport | null;
  loadingUsage: boolean;
  onNavigate: (module: string) => void;
  onRefreshUsage: () => void;
  usageMinutes: number;
  setUsageMinutes: (value: number) => void;
  usageDateRange: string[];
  setUsageDateRange: (value: string[]) => void;
  t: T;
  enabledKeyCount: number;
  enabledChannelCount: number;
  gatewayV1Endpoint: string;
};

type QuickAction = {
  id: string;
  label: string;
  description: string;
  module: string;
  href?: string;
  icon: React.ReactNode;
  accent: string;
  onClick?: () => void;
};

type DashboardTimelinePoint = {
  label: string;
  value: number;
};

type DashboardModelRow = {
  id: string;
  model: string;
  requestCount: number;
  totalTokens: number;
};

type DashboardKeyRow = {
  id: string;
  keyName: string;
  requestCount: number;
  totalTokens: number;
};

const DASHBOARD_RANGE_PRESETS: Array<{ id: DashboardRangePresetId; zh: string; en: string }> = [
  { id: "today", zh: "今天", en: "Today" },
  { id: "yesterday", zh: "昨天", en: "Yesterday" },
  { id: "last3Days", zh: "近 3 天", en: "Last 3 Days" },
  { id: "last7Days", zh: "近 7 天", en: "Last 7 Days" },
  { id: "last14Days", zh: "近 14 天", en: "Last 14 Days" },
  { id: "last30Days", zh: "近 30 天", en: "Last 30 Days" },
  { id: "thisMonth", zh: "本月", en: "This Month" },
  { id: "lastMonth", zh: "上月", en: "Last Month" }
] as const;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function shiftDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 0);
}

function formatRangeDateTime(value: string, isEnd: boolean) {
  return `${value} ${isEnd ? "23:59:59" : "00:00:00"}`;
}

function diffCalendarDays(start: Date, end: Date) {
  const startValue = startOfDay(start).getTime();
  const endValue = startOfDay(end).getTime();
  return Math.max(0, Math.round((endValue - startValue) / 86_400_000));
}

function formatShortRange(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    return "";
  }
  const [startYear, startMonth, startDay] = startDate.split("-");
  const [endYear, endMonth, endDay] = endDate.split("-");
  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
    return `${startDate} - ${endDate}`;
  }
  if (startYear === endYear) {
    return `${startMonth}/${startDay} - ${endMonth}/${endDay}`;
  }
  return `${startYear}/${startMonth}/${startDay} - ${endYear}/${endMonth}/${endDay}`;
}

function resolveUsageWindowMinutesForRange(start: Date, end: Date) {
  return diffCalendarDays(start, end) <= 0 ? 1440 : 10080;
}

function resolvePresetDateDraft(presetId: DashboardRangePresetId, now: Date) {
  const today = startOfDay(now);
  switch (presetId) {
    case "today":
      return {
        startDate: toDateInputValue(today),
        endDate: toDateInputValue(today)
      };
    case "yesterday": {
      const yesterday = shiftDays(today, -1);
      return {
        startDate: toDateInputValue(yesterday),
        endDate: toDateInputValue(yesterday)
      };
    }
    case "last3Days": {
      const start = shiftDays(today, -2);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(today)
      };
    }
    case "last7Days": {
      const start = shiftDays(today, -6);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(today)
      };
    }
    case "last14Days": {
      const start = shiftDays(today, -13);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(today)
      };
    }
    case "last30Days": {
      const start = shiftDays(today, -29);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(today)
      };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(today)
      };
    }
    case "lastMonth": {
      const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const start = startOfMonth(previousMonth);
      const end = endOfMonth(previousMonth);
      return {
        startDate: toDateInputValue(start),
        endDate: toDateInputValue(end)
      };
    }
    default:
      return {
        startDate: toDateInputValue(today),
        endDate: toDateInputValue(today)
      };
  }
}

function inferPresetIdFromDateDraft(
  startDate: string,
  endDate: string,
  now: Date
): DashboardRangePresetId | null {
  if (!startDate || !endDate) {
    return null;
  }
  const matchedPreset = DASHBOARD_RANGE_PRESETS.find((preset) => {
    const draft = resolvePresetDateDraft(preset.id, now);
    return draft.startDate === startDate && draft.endDate === endDate;
  });
  return matchedPreset?.id ?? null;
}

function getAppliedDateDraft(usageMinutes: number, usageDateRange: string[], now: Date) {
  if (usageDateRange[0]?.trim() && usageDateRange[1]?.trim()) {
    return {
      startDate: usageDateRange[0].slice(0, 10),
      endDate: usageDateRange[1].slice(0, 10)
    };
  }
  const today = startOfDay(now);
  const spanDays = Math.max(1, Math.ceil(usageMinutes / 1440));
  const start = shiftDays(today, -(spanDays - 1));
  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(today)
  };
}

function resolveCurrentRangeLabel(
  usageMinutes: number,
  usageDateRange: string[],
  now: Date,
  t: T
) {
  const hasCustomRange = Boolean(usageDateRange[0]?.trim() && usageDateRange[1]?.trim());
  if (hasCustomRange) {
    const startDate = usageDateRange[0].slice(0, 10);
    const endDate = usageDateRange[1].slice(0, 10);
    const presetId = inferPresetIdFromDateDraft(startDate, endDate, now);
    if (presetId) {
      const preset = DASHBOARD_RANGE_PRESETS.find((item) => item.id === presetId);
      if (preset) {
        return t(preset.zh, preset.en);
      }
    }
    return formatShortRange(startDate, endDate);
  }
  if (usageMinutes >= 1440 && usageMinutes % 1440 === 0) {
    const days = usageMinutes / 1440;
    return days === 1
      ? t("最近 24 小时", "Last 24 Hours")
      : t(`近 ${days} 天`, `Last ${days} Days`);
  }
  if (usageMinutes >= 60 && usageMinutes % 60 === 0) {
    const hours = usageMinutes / 60;
    return t(`近 ${hours} 小时`, `Last ${hours} Hours`);
  }
  return t(`最近 ${usageMinutes} 分钟`, `Last ${usageMinutes} Minutes`);
}

function resolveAutoGranularity(windowMinutes: number) {
  if (windowMinutes >= 3 * 24 * 60) {
    return "day" as const;
  }
  if (windowMinutes >= 12 * 60) {
    return "hour" as const;
  }
  return "minute" as const;
}

function startOfBucket(date: Date, granularity: Exclude<DashboardGranularity, "auto">) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  if (granularity === "day") {
    next.setHours(0, 0, 0, 0);
    return next;
  }
  if (granularity === "hour") {
    next.setMinutes(0, 0, 0);
    return next;
  }
  return next;
}

function formatBucketLabel(date: Date, granularity: Exclude<DashboardGranularity, "auto">, windowMinutes: number) {
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  if (granularity === "day") {
    return `${month}-${day}`;
  }
  if (granularity === "hour") {
    return windowMinutes >= 24 * 60 ? `${month}-${day} ${hour}:00` : `${hour}:00`;
  }
  if (windowMinutes >= 24 * 60) {
    return `${month}-${day} ${hour}:${minute}`;
  }
  return formatMinuteLabel(date.toISOString());
}

function buildUsageTimeline(
  usageReport: UsageReport | null,
  metric: UsageMetricKey,
  granularity: DashboardGranularity
) {
  if (!usageReport?.timeline.length) {
    return [];
  }

  const windowMinutes = usageReport.windowMinutes || 180;
  const resolvedGranularity = granularity === "auto" ? resolveAutoGranularity(windowMinutes) : granularity;
  const bucketMap = new Map<string, { at: number; label: string; value: number }>();

  for (const row of usageReport.timeline) {
    const rawDate = new Date(row.minute);
    if (Number.isNaN(rawDate.getTime())) {
      continue;
    }
    const bucketDate = startOfBucket(rawDate, resolvedGranularity);
    const key = bucketDate.toISOString();
    const current = bucketMap.get(key) ?? {
      at: bucketDate.getTime(),
      label: formatBucketLabel(bucketDate, resolvedGranularity, windowMinutes),
      value: 0
    };
    current.value += metric === "requestCount"
      ? row.requestCount
      : metric === "promptTokens"
        ? row.promptTokens
        : metric === "completionTokens"
          ? row.completionTokens
          : row.totalTokens;
    bucketMap.set(key, current);
  }

  return Array.from(bucketMap.values())
    .sort((a, b) => a.at - b.at)
    .slice(-120)
    .map((item) => ({
      label: item.label,
      value: item.value
    }));
}

export function WorkspaceDashboard({
  keys,
  channels,
  usageReport,
  loadingUsage,
  onNavigate,
  onRefreshUsage,
  usageMinutes,
  setUsageMinutes,
  usageDateRange,
  setUsageDateRange,
  t,
  enabledKeyCount,
  enabledChannelCount,
  gatewayV1Endpoint
}: WorkspaceDashboardProps) {
  const router = useRouter();
  const [now, setNow] = useState("");
  const [dashboardGranularity, setDashboardGranularity] = useState<DashboardGranularity>("auto");

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleString());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayReference = useMemo(() => new Date(), [now]);
  const appliedDateDraft = useMemo(
    () => getAppliedDateDraft(usageMinutes, usageDateRange, todayReference),
    [todayReference, usageDateRange, usageMinutes]
  );
  const currentRangeLabel = useMemo(
    () => resolveCurrentRangeLabel(usageMinutes, usageDateRange, todayReference, t),
    [todayReference, t, usageDateRange, usageMinutes]
  );
  const rangePickerValue = useMemo(
    () =>
      usageDateRange[0]?.trim() && usageDateRange[1]?.trim()
        ? [usageDateRange[0].slice(0, 10), usageDateRange[1].slice(0, 10)]
        : usageMinutes >= 1440
          ? [appliedDateDraft.startDate, appliedDateDraft.endDate]
          : [],
    [appliedDateDraft.endDate, appliedDateDraft.startDate, usageDateRange, usageMinutes]
  );
  const dashboardRangePresets = useMemo(
    (): Record<string, [string, string]> =>
      Object.fromEntries(
        DASHBOARD_RANGE_PRESETS.map((preset) => {
          const draft = resolvePresetDateDraft(preset.id, todayReference);
          return [
            t(preset.zh, preset.en),
            [draft.startDate, draft.endDate]
          ];
        })
      ),
    [t, todayReference]
  );

  const summary = usageReport?.summary ?? {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    uniqueKeys: 0,
    uniqueModels: 0
  };

  const timelinePoints = useMemo(
    () => buildUsageTimeline(usageReport, "totalTokens", dashboardGranularity),
    [dashboardGranularity, usageReport]
  );
  const dashboardGranularityOptions = useMemo(
    () => [
      { label: t("自动", "Auto"), value: "auto" },
      { label: t("按分钟", "By Minute"), value: "minute" },
      { label: t("按小时", "By Hour"), value: "hour" },
      { label: t("按天", "By Day"), value: "day" }
    ],
    [t]
  );

  const quickActions: QuickAction[] = [
    {
      id: "access",
      label: t("Key 管理", "Manage Keys"),
      description: t("新建、编辑本地 Key 与映射策略", "Create and edit local keys & mappings"),
      module: "access",
      href: "/console/access",
      icon: <Key size={20} />,
      accent: "#3b82f6"
    },
    {
      id: "upstream",
      label: t("上游渠道", "Upstreams"),
      description: t("管理供应商连接与模型池", "Manage providers, model pools & channels"),
      module: "upstream",
      href: "/console/upstream",
      icon: <Globe size={20} />,
      accent: "#10a37f"
    },
    {
      id: "runtime",
      label: t("运行时调度", "Runtime"),
      description: t("在线切换模型并实时控制 Key", "Switch models and toggle keys in real-time"),
      module: "runtime",
      href: "/console/runtime",
      icon: <Zap size={20} />,
      accent: "#f59e0b"
    },
    {
      id: "logs",
      label: t("请求日志", "Request Logs"),
      description: t("排查网关链路与错误", "Debug gateway chains and errors"),
      module: "logs",
      href: "/console/logs",
      icon: <Activity size={20} />,
      accent: "#8b5cf6"
    },
    {
      id: "usage",
      label: t("用量报表", "Usage"),
      description: t("观察 Token 消耗趋势", "Track token consumption trends"),
      module: "usage",
      href: "/console/usage",
      icon: <Database size={20} />,
      accent: "#06b6d4"
    },
    {
      id: "docs",
      label: t("接口文档", "API Docs"),
      description: t("复制即用的示例代码", "Ready-to-run code examples"),
      module: "docs",
      href: "/console/docs",
      icon: <Plug size={20} />,
      accent: "#ec4899"
    }
  ];

  const topModels = usageReport?.perModel
    ? [...usageReport.perModel].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6)
    : [];

  const topKeys = usageReport?.perKey
    ? [...usageReport.perKey].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 6)
    : [];
  const topModelRows: DashboardModelRow[] = topModels.map((row, index) => ({
    id: `model-${row.model}-${index}`,
    model: row.model,
    requestCount: row.requestCount,
    totalTokens: row.totalTokens
  }));
  const topKeyRows: DashboardKeyRow[] = topKeys.map((row, index) => ({
    id: `key-${row.keyId}-${index}`,
    keyName: row.keyName,
    requestCount: row.requestCount,
    totalTokens: row.totalTokens
  }));
  const topModelColumns: NonNullable<TableProps<DashboardModelRow>["columns"]> = [
    { colKey: "model", title: t("模型", "Model"), cell: ({ row }) => <code>{row.model}</code> },
    { colKey: "requestCount", title: t("请求数", "Requests"), align: "right", cell: ({ row }) => formatNumber(row.requestCount) },
    { colKey: "totalTokens", title: t("Token", "Tokens"), align: "right", cell: ({ row }) => formatCompactNumber(row.totalTokens) }
  ];
  const topKeyColumns: NonNullable<TableProps<DashboardKeyRow>["columns"]> = [
    { colKey: "keyName", title: t("Key", "Key"), cell: ({ row }) => <code>{row.keyName}</code> },
    { colKey: "requestCount", title: t("请求数", "Requests"), align: "right", cell: ({ row }) => formatNumber(row.requestCount) },
    { colKey: "totalTokens", title: t("Token", "Tokens"), align: "right", cell: ({ row }) => formatCompactNumber(row.totalTokens) }
  ];

  return (
    <div className="tc-dashboard">
      {/* Header */}
      <section className="tc-dashboard-hero">
        <div className="tc-dashboard-hero-left">
          <h2>{t("系统运行概览", "System Overview")}</h2>
          <p>
            {now
              ? t(`最后更新: ${now}`, `Last updated: ${now}`)
              : t("加载中...", "Loading...")}
          </p>
        </div>
        <div className="tc-dashboard-hero-right">
          <Tag variant="light-outline">
            <Settings size={13} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
            {t("Key", "Keys")} {enabledKeyCount}/{keys.length}
          </Tag>
          <Tag variant="light-outline">
            <Globe size={13} style={{ marginRight: 4, verticalAlign: "text-bottom" }} />
            {t("渠道", "Channels")} {enabledChannelCount}/{channels.length}
          </Tag>
          <Button
            variant="outline"
            size="small"
            icon={<RefreshCw size={14} />}
            loading={loadingUsage}
            onClick={onRefreshUsage}
          >
            {t("刷新", "Refresh")}
          </Button>
        </div>
      </section>

      {/* Stat cards */}
      <div className="tc-dashboard-stats">
        <article className="tc-dashboard-stat-card">
          <div className="tc-dashboard-stat-icon" style={{ background: "#eff6ff", color: "#3b82f6" }}>
            <Activity size={22} />
          </div>
          <div className="tc-dashboard-stat-body">
            <span>{t("总请求数", "Total Requests")}</span>
            <strong>{formatNumber(summary.requestCount)}</strong>
          </div>
        </article>

        <article className="tc-dashboard-stat-card">
          <div className="tc-dashboard-stat-icon" style={{ background: "#f0fdf4", color: "#10a37f" }}>
            <TrendingUp size={22} />
          </div>
          <div className="tc-dashboard-stat-body">
            <span>{t("输入 Token", "Prompt Tokens")}</span>
            <strong>{formatCompactNumber(summary.promptTokens)}</strong>
          </div>
        </article>

        <article className="tc-dashboard-stat-card">
          <div className="tc-dashboard-stat-icon" style={{ background: "#fefce8", color: "#f59e0b" }}>
            <Database size={22} />
          </div>
          <div className="tc-dashboard-stat-body">
            <span>{t("输出 Token", "Completion Tokens")}</span>
            <strong>{formatCompactNumber(summary.completionTokens)}</strong>
          </div>
        </article>

        <article className="tc-dashboard-stat-card">
          <div className="tc-dashboard-stat-icon" style={{ background: "#faf5ff", color: "#8b5cf6" }}>
            <Key size={22} />
          </div>
          <div className="tc-dashboard-stat-body">
            <span>{t("Total Token", "Total Tokens")}</span>
            <strong>{formatCompactNumber(summary.totalTokens)}</strong>
          </div>
        </article>
      </div>

      {/* Quick actions */}
      <section className="tc-dashboard-section">
        <h3>{t("快速操作", "Quick Actions")}</h3>
        <div className="tc-dashboard-actions-grid">
          {quickActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant="text"
              theme="default"
              block
              className="tc-dashboard-action-card"
              onClick={() => {
                action.onClick?.();
                if (action.href) {
                  router.push(action.href);
                  return;
                }
                onNavigate(action.module);
              }}
            >
              <div className="tc-dashboard-action-icon" style={{ background: `${action.accent}15`, color: action.accent }}>
                {action.icon}
              </div>
              <div className="tc-dashboard-action-body">
                <strong>{action.label}</strong>
                <p>{action.description}</p>
              </div>
              <ArrowRight size={16} className="tc-dashboard-action-arrow" />
            </Button>
          ))}
        </div>
      </section>

      {/* Timeline chart */}
      <section className="tc-dashboard-section">
        <h3>{t("Token 消耗趋势", "Token Consumption Trend")}</h3>
        <div className="tc-dashboard-range-bar">
          <div className="tc-dashboard-range-field">
            <div className="tc-dashboard-range-head">
              <span className="tc-dashboard-range-label">{t("时间范围", "Time Range")}</span>
              <Tag variant="light-outline" className="tc-dashboard-range-status">
                {currentRangeLabel}
              </Tag>
            </div>
            <DateRangePicker
              className="tc-dashboard-range-picker"
              clearable
              needConfirm={false}
              format="YYYY-MM-DD"
              valueType="YYYY-MM-DD"
              presets={dashboardRangePresets}
              presetsPlacement="left"
              placeholder={[t("开始日期", "Start Date"), t("结束日期", "End Date")]}
              popupProps={{ overlayClassName: "tc-dashboard-range-picker-popup" }}
              value={rangePickerValue}
              onChange={(value) => {
                if (!Array.isArray(value)) {
                  setUsageDateRange([]);
                  return;
                }
                const next = value.map((item) => String(item ?? "").trim()).slice(0, 2);
                if (!(next[0] && next[1])) {
                  setUsageDateRange([]);
                  return;
                }
                const start = next[0];
                const end = next[1];
                const startDate = new Date(`${start}T00:00:00`);
                const endDate = new Date(`${end}T00:00:00`);
                if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
                  setUsageDateRange([]);
                  return;
                }
                const [resolvedStart, resolvedEnd] = startDate.getTime() <= endDate.getTime()
                  ? [startDate, endDate]
                  : [endDate, startDate];
                setUsageMinutes(resolveUsageWindowMinutesForRange(resolvedStart, resolvedEnd));
                setUsageDateRange([
                  formatRangeDateTime(toDateInputValue(resolvedStart), false),
                  formatRangeDateTime(toDateInputValue(resolvedEnd), true)
                ]);
              }}
            />
          </div>

          <div className="tc-dashboard-range-field tc-dashboard-range-field--compact">
            <span className="tc-dashboard-range-label">{t("粒度", "Granularity")}</span>
            <Select
              className="tc-dashboard-range-select"
              value={dashboardGranularity}
              options={dashboardGranularityOptions}
              onChange={(value) => {
                const next = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
                if (next === "auto" || next === "minute" || next === "hour" || next === "day") {
                  setDashboardGranularity(next);
                }
              }}
            />
          </div>
        </div>

        <div className="tc-dashboard-chart-card">
          {timelinePoints.length > 0 ? (
            <AntVAreaChart
              color={USAGE_METRIC_META.totalTokens.color}
              data={timelinePoints}
              formatValue={formatCompactNumber}
              height={280}
              seriesLabel={USAGE_METRIC_META.totalTokens.label}
              xLabelRotate={timelinePoints.length > 14 ? 24 : 0}
            />
          ) : (
            <p className="tc-dashboard-empty-chart">
              {t("暂无用量数据，发起一次请求后自动显示趋势图。", "No usage data yet. Send a request to see the trend chart.")}
            </p>
          )}
        </div>
      </section>

      {/* Top tables */}
      <div className="tc-dashboard-two-col">
        <section className="tc-dashboard-section">
          <h3>{t("热门模型", "Top Models")}</h3>
          {topModels.length > 0 ? (
            <div className="tc-dashboard-table-wrap">
              <StaticTable className="tc-static-table tc-dashboard-static-table" columns={topModelColumns} data={topModelRows} />
            </div>
          ) : (
            <p className="tc-dashboard-empty-chart">{t("暂无数据", "No data")}</p>
          )}
        </section>

        <section className="tc-dashboard-section">
          <h3>{t("活跃 Key", "Active Keys")}</h3>
          {topKeys.length > 0 ? (
            <div className="tc-dashboard-table-wrap">
              <StaticTable className="tc-static-table tc-dashboard-static-table" columns={topKeyColumns} data={topKeyRows} />
            </div>
          ) : (
            <p className="tc-dashboard-empty-chart">{t("暂无数据", "No data")}</p>
          )}
        </section>
      </div>

      {/* Endpoint info */}
      <section className="tc-dashboard-section">
        <h3>{t("网关地址", "Gateway Endpoint")}</h3>
        <div className="tc-dashboard-endpoint">
          <code>{gatewayV1Endpoint}</code>
          <Button
            variant="outline"
            size="small"
            onClick={() => { void navigator.clipboard.writeText(gatewayV1Endpoint); }}
          >
            {t("复制", "Copy")}
          </Button>
        </div>
      </section>
    </div>
  );
}
