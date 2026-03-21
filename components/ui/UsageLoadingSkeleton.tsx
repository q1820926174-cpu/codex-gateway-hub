"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** 骨架屏加载动画组件 */
export function UsageLoadingSkeleton() {
  // 预计算骨架行宽度，避免 Math.random() 重渲染抖动
  const rowWidths = useMemo(() => [40, 55, 35, 48, 62], []);
  const shouldReduceMotion = useReducedMotion() ?? false;

  const cardMotion = (delay: number) =>
    shouldReduceMotion
      ? {
          initial: false,
          animate: { opacity: 1 },
          transition: { duration: 0 }
        }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay }
        };

  const sectionMotion = shouldReduceMotion
    ? {
        initial: false,
        animate: { opacity: 1 },
        transition: { duration: 0 }
      }
    : {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, delay: 0.35 }
      };

  const tableMotion = (delay: number) =>
    shouldReduceMotion
      ? {
          initial: false,
          animate: { opacity: 1 },
          transition: { duration: 0 }
        }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay }
        };

  return (
    <div className="tc-skeleton-container">
      {/* 顶部统计卡片骨架 */}
      <div className="tc-skeleton-cards">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={`card-${i}`}
            className="tc-skeleton-card"
            {...cardMotion(i * 0.08)}
          >
            <div className="tc-skeleton-line tc-skeleton-line-sm" />
            <div className="tc-skeleton-line tc-skeleton-line-lg" />
            <div className="tc-skeleton-line tc-skeleton-line-xs" />
          </motion.div>
        ))}
      </div>

      {/* 趋势图骨架 */}
      <motion.div className="tc-skeleton-chart" {...sectionMotion}>
        <div className="tc-skeleton-line tc-skeleton-line-sm" />
        <div className="tc-skeleton-chart-area">
          <svg viewBox="0 0 400 80" preserveAspectRatio="none" className="tc-skeleton-wave">
            <path
              d="M0,60 C50,55 100,20 150,30 C200,40 250,10 300,25 C350,40 380,15 400,20 L400,80 L0,80 Z"
              fill="url(#tc-skeleton-grad)"
            />
            <defs>
              <linearGradient id="tc-skeleton-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c5d9ff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#c5d9ff" stopOpacity="0.05" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </motion.div>

      {/* 底部表格骨架 */}
      <div className="tc-skeleton-tables">
        {[0, 1].map((i) => (
          <motion.div
            key={`table-${i}`}
            className="tc-skeleton-table"
            {...tableMotion(0.5 + i * 0.1)}
          >
            <div className="tc-skeleton-line tc-skeleton-line-sm" />
            <div className="tc-skeleton-rows">
              {[0, 1, 2, 3, 4].map((r) => (
                <div key={`row-${r}`} className="tc-skeleton-row">
                  <div className="tc-skeleton-cell" style={{ width: `${rowWidths[r]}%` }} />
                  <div className="tc-skeleton-cell tc-skeleton-cell-short" />
                  <div className="tc-skeleton-cell tc-skeleton-cell-short" />
                  <div className="tc-skeleton-cell tc-skeleton-cell-short" />
                  <div className="tc-skeleton-cell tc-skeleton-cell-short" />
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** 页面级加载动画（带脉冲圆点） */
export function UsagePulseLoader({ label }: { label?: string }) {
  const shouldReduceMotion = useReducedMotion() ?? false;

  return (
    <div className="tc-pulse-loader">
      <div className="tc-pulse-dots">
        {[0, 1, 2].map((i) => (
          shouldReduceMotion ? (
            <span key={i} className="tc-pulse-dot" />
          ) : (
            <motion.span
              key={i}
              className="tc-pulse-dot"
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.4, 1, 0.4]
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut"
              }}
            />
          )
        ))}
      </div>
      {label && <span className="tc-pulse-label">{label}</span>}
    </div>
  );
}
