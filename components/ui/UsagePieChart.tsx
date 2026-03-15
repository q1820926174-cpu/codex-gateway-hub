"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import type { ComponentType } from "react";
import { motion } from "framer-motion";

import type { EChartsReactProps } from "echarts-for-react";

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
  "#ef4444"
];

type PieSlice = {
  name: string;
  value: number;
};

type UsagePieChartProps = {
  title: string;
  slices: PieSlice[];
  height?: number;
  delay?: number;
  /** ECharts renderer component injected from parent (e.g. dynamic-imported echarts-for-react) */
  EChartsComponent?: ComponentType<EChartsReactProps>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pieFormatter(params: any): string {
  const name = params?.name ?? "";
  const rawVal = typeof params?.value === "number" ? params.value : 0;
  const pct = typeof params?.percent === "number" ? params.percent : 0;
  const formatted = rawVal >= 1_000
    ? (rawVal / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
    : rawVal.toLocaleString();
  return `<strong>${name}</strong><br/>${formatted} (${pct}%)`;
}

export function UsagePieChart({ title, slices, height = 280, delay = 0, EChartsComponent }: UsagePieChartProps) {
  const option = useMemo<EChartsOption | Record<string, unknown>>(() => {
    const total = slices.reduce((s, item) => s + item.value, 0);
    return {
      tooltip: {
        trigger: "item",
        formatter: pieFormatter,
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        borderColor: "#e2e8f0",
        borderWidth: 1,
        textStyle: { color: "#334155", fontSize: 12 },
        padding: [8, 12]
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 8,
        top: "center",
        textStyle: { color: "#475569", fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 8,
        pageTextStyle: { color: "#94a3b8" },
        pageIconColor: "#64748b",
        pageIconInactiveColor: "#cbd5e1"
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "70%"],
          center: ["35%", "50%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: "#fff",
            borderWidth: 2
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 600,
              color: "#0f172a"
            },
            itemStyle: {
              shadowBlur: 12,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.15)"
            }
          },
          animationType: "scale",
          animationEasing: "elasticOut",
          animationDelay: (idx: number) => idx * 60,
          color: PIE_COLORS,
          data: slices.map((item) => ({
            name: item.name,
            value: item.value
          }))
        },
        // inner ring decoration — ensure at least value=1 so the ring always renders
        {
          type: "pie",
          radius: ["34%", "38%"],
          center: ["35%", "50%"],
          silent: true,
          label: { show: false },
          data: [{ value: Math.max(total, 1), name: "", itemStyle: { color: "#f1f5f9" } }],
          animation: false
        }
      ]
    };
  }, [slices]);

  if (slices.length === 0) {
    return (
      <motion.div
        className="tc-pie-empty"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay }}
      >
        <p>{title} - 暂无数据</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="tc-usage-chart-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <h4>{title}</h4>
      <p className="tc-usage-chart-note">环形分布占比，悬停查看详情。</p>
      <div style={{ width: "100%", height }}>
        {EChartsComponent ? (
          <EChartsComponent
            notMerge
            lazyUpdate
            option={option as EChartsOption}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <PieChartFallback option={option as EChartsOption} />
        )}
      </div>
    </motion.div>
  );
}

/** Fallback renderer using dynamic import (only runs on client) */
function PieChartFallback({ option }: { option: EChartsOption }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactECharts = require("echarts-for-react").default;
  return (
    <ReactECharts
      notMerge
      lazyUpdate
      option={option}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

export { PIE_COLORS };
export type { PieSlice };
