"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AntVDonutChart } from "@/components/ui/AntVPlots";

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
};

function formatPieValue(value: number) {
  return value >= 1_000
    ? (value / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
    : value.toLocaleString();
}

export function UsagePieChart({ title, slices, height = 280, delay = 0 }: UsagePieChartProps) {
  const shouldReduceMotion = useReducedMotion() ?? false;

  if (slices.length === 0) {
    return (
      <motion.div
        className="tc-pie-empty"
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={shouldReduceMotion ? { duration: 0 } : { delay }}
      >
        <p>{title} - 暂无数据</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="tc-usage-chart-card"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5, delay }}
    >
      <h4>{title}</h4>
      <p className="tc-usage-chart-note">环形分布占比，悬停查看详情。</p>
      <div style={{ width: "100%", height }}>
        <AntVDonutChart
          data={slices}
          height={height}
          colors={PIE_COLORS}
          formatValue={formatPieValue}
        />
      </div>
    </motion.div>
  );
}

export { PIE_COLORS };
export type { PieSlice };
