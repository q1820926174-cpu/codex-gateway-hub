"use client";

import { motion } from "framer-motion";
import { BarChart3, Zap, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export type StatCardVariant = "requests" | "prompt" | "completion" | "total";

const VARIANT_CONFIG: Record<
  StatCardVariant,
  { icon: React.ElementType; gradient: string; iconColor: string; iconBg: string; label: string; labelEn: string }
> = {
  requests: {
    icon: BarChart3,
    gradient: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
    iconColor: "#6366f1",
    iconBg: "rgba(99, 102, 241, 0.12)",
    label: "请求总数",
    labelEn: "Total Requests"
  },
  prompt: {
    icon: ArrowDownToLine,
    gradient: "linear-gradient(135deg, #10b981 0%, #34d399 100%)",
    iconColor: "#10b981",
    iconBg: "rgba(16, 185, 129, 0.12)",
    label: "输入 Token",
    labelEn: "Prompt Tokens"
  },
  completion: {
    icon: ArrowUpFromLine,
    gradient: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)",
    iconColor: "#f59e0b",
    iconBg: "rgba(245, 158, 11, 0.12)",
    label: "输出 Token",
    labelEn: "Completion Tokens"
  },
  total: {
    icon: Zap,
    gradient: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)",
    iconColor: "#3b82f6",
    iconBg: "rgba(59, 130, 246, 0.12)",
    label: "Total Token",
    labelEn: "Total Tokens"
  }
};

type UsageStatCardProps = {
  variant: StatCardVariant;
  value: number;
  delay?: number;
  locale?: "zh-CN" | "en-US";
};

function formatStatNumber(value: number): string {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return value.toLocaleString();
}

export function UsageStatCard({ variant, value, delay = 0, locale = "zh-CN" }: UsageStatCardProps) {
  const cfg = VARIANT_CONFIG[variant];
  const Icon = cfg.icon;
  const displayLabel = locale === "zh-CN" ? cfg.label : cfg.labelEn;

  return (
    <motion.div
      className="tc-stat-card"
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      whileHover={{ y: -3, boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)" }}
    >
      {/* 顶部渐变条 */}
      <div className="tc-stat-card-bar" style={{ background: cfg.gradient }} />

      <div className="tc-stat-card-body">
        <div className="tc-stat-card-header">
          <span className="tc-stat-card-label">{displayLabel}</span>
          <div className="tc-stat-card-icon" style={{ background: cfg.iconBg, color: cfg.iconColor }}>
            <Icon size={18} strokeWidth={2} />
          </div>
        </div>

        <motion.div
          className="tc-stat-card-value"
          key={value}
          initial={{ opacity: 0.4, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: delay + 0.15 }}
        >
          {formatStatNumber(value)}
        </motion.div>

        <div className="tc-stat-card-raw">{value.toLocaleString()}</div>
      </div>
    </motion.div>
  );
}
