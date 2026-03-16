"use client";

import { useEffect, useState } from "react";
import type { EChartsOption } from "echarts";
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
import { Tag, Button } from "tdesign-react";
import dynamic from "next/dynamic";
import {
  formatCompactNumber,
  formatNumber
} from "@/components/console/settings-console-helpers";
import {
  type GatewayKey,
  type UpstreamChannel,
  type UsageReport,
  type UsageMetricKey,
  USAGE_METRIC_META
} from "@/components/console/types";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type T = (zh: string, en: string) => string;

type WorkspaceDashboardProps = {
  keys: GatewayKey[];
  channels: UpstreamChannel[];
  usageReport: UsageReport | null;
  loadingUsage: boolean;
  onNavigate: (module: string) => void;
  onRefreshUsage: () => void;
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
  icon: React.ReactNode;
  accent: string;
};

function useUsageTimeline(usageReport: UsageReport | null, metric: UsageMetricKey) {
  return usageReport?.timeline
    ? usageReport.timeline
        .filter((row) => (metric === "requestCount" ? row.requestCount > 0 : true))
        .slice(-90)
        .reverse()
        .map((row) => ({
          minute: row.minute,
          value: metric === "requestCount"
            ? row.requestCount
            : metric === "promptTokens"
              ? row.promptTokens
              : metric === "completionTokens"
                ? row.completionTokens
                : row.totalTokens
        }))
    : [];
}

function buildTimelineChartOption(
  points: Array<{ minute: string; value: number }>,
  metricMeta: { color: string; label: string }
): EChartsOption | null {
  if (!points.length) return null;
  return {
    color: [metricMeta.color],
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      textStyle: { color: "#f8fafc" },
      extraCssText: "border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);",
      valueFormatter: (value) =>
        typeof value === "number" ? formatCompactNumber(value) : String(value ?? "")
    },
    grid: { top: 32, right: 16, bottom: 36, left: 56 },
    xAxis: {
      type: "category",
      data: points.map((p) => p.minute.slice(11, 16)),
      axisLabel: { fontSize: 11, color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false }
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11,
        color: "#94a3b8",
        formatter: (v: number) => formatCompactNumber(v)
      },
      splitLine: { lineStyle: { color: "#e2e8f0", type: "dashed" } }
    },
    animationDuration: 800,
    animationEasing: "cubicOut",
    series: [
      {
        type: "line",
        data: points.map((p) => p.value),
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, shadowColor: "rgba(59, 130, 246, 0.3)", shadowBlur: 8, shadowOffsetY: 4 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(59, 130, 246, 0.25)" },
              { offset: 0.5, color: "rgba(59, 130, 246, 0.08)" },
              { offset: 1, color: "rgba(59, 130, 246, 0.01)" }
            ]
          }
        }
      }
    ]
  };
}

export function WorkspaceDashboard({
  keys,
  channels,
  usageReport,
  loadingUsage,
  onNavigate,
  onRefreshUsage,
  t,
  enabledKeyCount,
  enabledChannelCount,
  gatewayV1Endpoint
}: WorkspaceDashboardProps) {
  const [now, setNow] = useState("");

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleString());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = usageReport?.summary ?? {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    uniqueKeys: 0,
    uniqueModels: 0
  };

  const timelinePoints = useUsageTimeline(usageReport, "totalTokens");
  const timelineChartOption = buildTimelineChartOption(timelinePoints, USAGE_METRIC_META.totalTokens);

  const quickActions: QuickAction[] = [
    {
      id: "access",
      label: t("Key 管理", "Manage Keys"),
      description: t("新建、编辑本地 Key 与映射策略", "Create and edit local keys & mappings"),
      module: "access",
      icon: <Key size={20} />,
      accent: "#3b82f6"
    },
    {
      id: "upstream",
      label: t("上游渠道", "Upstreams"),
      description: t("管理供应商连接与模型池", "Manage providers, model pools & channels"),
      module: "upstream",
      icon: <Globe size={20} />,
      accent: "#10a37f"
    },
    {
      id: "runtime",
      label: t("运行时调度", "Runtime"),
      description: t("在线切换模型并实时控制 Key", "Switch models and toggle keys in real-time"),
      module: "runtime",
      icon: <Zap size={20} />,
      accent: "#f59e0b"
    },
    {
      id: "logs",
      label: t("请求日志", "Request Logs"),
      description: t("排查网关链路与错误", "Debug gateway chains and errors"),
      module: "logs",
      icon: <Activity size={20} />,
      accent: "#8b5cf6"
    },
    {
      id: "usage",
      label: t("用量报表", "Usage"),
      description: t("观察 Token 消耗趋势", "Track token consumption trends"),
      module: "usage",
      icon: <Database size={20} />,
      accent: "#06b6d4"
    },
    {
      id: "docs",
      label: t("接口文档", "API Docs"),
      description: t("复制即用的示例代码", "Ready-to-run code examples"),
      module: "docs",
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
            <button
              type="button"
              key={action.id}
              className="tc-dashboard-action-card"
              onClick={() => onNavigate(action.module)}
            >
              <div className="tc-dashboard-action-icon" style={{ background: `${action.accent}15`, color: action.accent }}>
                {action.icon}
              </div>
              <div className="tc-dashboard-action-body">
                <strong>{action.label}</strong>
                <p>{action.description}</p>
              </div>
              <ArrowRight size={16} className="tc-dashboard-action-arrow" />
            </button>
          ))}
        </div>
      </section>

      {/* Timeline chart */}
      <section className="tc-dashboard-section">
        <h3>{t("Token 消耗趋势", "Token Consumption Trend")}</h3>
        <div className="tc-dashboard-chart-card">
          {timelineChartOption ? (
            <ReactECharts
              notMerge
              lazyUpdate
              option={timelineChartOption}
              style={{ width: "100%", height: 280 }}
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
              <table className="tc-dashboard-table">
                <thead>
                  <tr>
                    <th>{t("模型", "Model")}</th>
                    <th>{t("请求数", "Requests")}</th>
                    <th>{t("Token", "Tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topModels.map((row, i) => (
                    <tr key={i}>
                      <td><code>{row.model}</code></td>
                      <td>{formatNumber(row.requestCount)}</td>
                      <td>{formatCompactNumber(row.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="tc-dashboard-empty-chart">{t("暂无数据", "No data")}</p>
          )}
        </section>

        <section className="tc-dashboard-section">
          <h3>{t("活跃 Key", "Active Keys")}</h3>
          {topKeys.length > 0 ? (
            <div className="tc-dashboard-table-wrap">
              <table className="tc-dashboard-table">
                <thead>
                  <tr>
                    <th>{t("Key", "Key")}</th>
                    <th>{t("请求数", "Requests")}</th>
                    <th>{t("Token", "Tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeys.map((row, i) => (
                    <tr key={i}>
                      <td><code>{row.keyName}</code></td>
                      <td>{formatNumber(row.requestCount)}</td>
                      <td>{formatCompactNumber(row.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
