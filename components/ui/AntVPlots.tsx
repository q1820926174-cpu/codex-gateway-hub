"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => null
});

export type ChartDatum = {
  label: string;
  value: number;
};

export type PieDatum = {
  name: string;
  value: number;
};

function truncateLabel(label: string, limit: number | undefined) {
  if (!limit || label.length <= limit) {
    return label;
  }
  return `${label.slice(0, limit)}...`;
}

function toRgba(hex: string, alpha: number) {
  if (!hex.startsWith("#")) {
    return hex;
  }

  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;

  const value = normalized.slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type AntVAreaChartProps = {
  data: ChartDatum[];
  height: number;
  color: string;
  seriesLabel: string;
  formatValue?: (value: number) => string;
  xLabelRotate?: number;
};

export function AntVAreaChart({
  data,
  height,
  color,
  seriesLabel,
  formatValue = (value) => value.toLocaleString(),
  xLabelRotate = 0
}: AntVAreaChartProps) {
  const option = useMemo<EChartsOption>(
    () => ({
      color: [color],
      animationDuration: 600,
      animationEasing: "cubicOut",
      grid: {
        top: 24,
        right: 20,
        bottom: 36,
        left: 56
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(15, 23, 42, 0.94)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc"
        },
        valueFormatter: (value) =>
          typeof value === "number" ? formatValue(value) : String(value ?? "")
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: data.map((item) => item.label),
        axisLabel: {
          color: "#64748b",
          rotate: xLabelRotate
        },
        axisLine: {
          lineStyle: {
            color: "#e2e8f0"
          }
        },
        axisTick: {
          show: false
        }
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatValue(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0",
            type: "dashed"
          }
        }
      },
      series: [
        {
          name: seriesLabel,
          type: "line",
          smooth: 0.35,
          showSymbol: data.length <= 14,
          symbolSize: 6,
          data: data.map((item) => item.value),
          lineStyle: {
            width: 2.5,
            color
          },
          itemStyle: {
            color,
            borderColor: "#ffffff",
            borderWidth: 1.5
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: toRgba(color, 0.24) },
                { offset: 0.55, color: toRgba(color, 0.08) },
                { offset: 1, color: toRgba(color, 0.02) }
              ]
            }
          }
        }
      ]
    }),
    [color, data, formatValue, seriesLabel, xLabelRotate]
  );

  return <ReactECharts notMerge lazyUpdate option={option} style={{ width: "100%", height }} />;
}

type AntVBarChartProps = {
  data: ChartDatum[];
  height: number;
  color: string;
  seriesLabel: string;
  formatValue?: (value: number) => string;
  truncateLabelAt?: number;
};

export function AntVBarChart({
  data,
  height,
  color,
  seriesLabel,
  formatValue = (value) => value.toLocaleString(),
  truncateLabelAt
}: AntVBarChartProps) {
  const option = useMemo<EChartsOption>(
    () => ({
      color: [color],
      animationDuration: 500,
      animationEasing: "cubicOut",
      grid: {
        top: 12,
        right: 68,
        bottom: 20,
        left: truncateLabelAt ? 180 : 120
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow"
        },
        backgroundColor: "rgba(15, 23, 42, 0.94)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc"
        },
        formatter: (params: any) => {
          const row = Array.isArray(params) ? params[0] : params;
          return `${seriesLabel}<br/>${row?.name ?? ""}: ${formatValue(Number(row?.value ?? 0))}`;
        }
      },
      xAxis: {
        type: "value",
        axisLabel: {
          color: "#64748b",
          formatter: (value: number) => formatValue(value)
        },
        splitLine: {
          lineStyle: {
            color: "#e2e8f0",
            type: "dashed"
          }
        }
      },
      yAxis: {
        type: "category",
        data: data.map((item) => truncateLabel(item.label, truncateLabelAt)),
        axisLabel: {
          color: "#334155"
        },
        axisTick: {
          show: false
        },
        axisLine: {
          show: false
        }
      },
      series: [
        {
          name: seriesLabel,
          type: "bar",
          data: data.map((item) => item.value),
          barWidth: 16,
          label: {
            show: true,
            position: "right",
            color: "#475569",
            fontSize: 12,
            formatter: (params: { value?: unknown }) => formatValue(Number(params.value ?? 0))
          },
          itemStyle: {
            color,
            borderRadius: [0, 6, 6, 0]
          }
        }
      ]
    }),
    [color, data, formatValue, seriesLabel, truncateLabelAt]
  );

  return <ReactECharts notMerge lazyUpdate option={option} style={{ width: "100%", height }} />;
}

type AntVDonutChartProps = {
  data: PieDatum[];
  height: number;
  colors: string[];
  formatValue?: (value: number) => string;
};

export function AntVDonutChart({
  data,
  height,
  colors,
  formatValue = (value) => value.toLocaleString()
}: AntVDonutChartProps) {
  const option = useMemo<EChartsOption>(
    () => ({
      color: colors,
      animationDuration: 500,
      animationEasing: "cubicOut",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(15, 23, 42, 0.94)",
        borderWidth: 0,
        textStyle: {
          color: "#f8fafc"
        },
        formatter: (params: any) => {
          const current = Array.isArray(params) ? params[0] : params;
          return `${current?.name ?? ""}: ${formatValue(Number(current?.value ?? 0))}`;
        }
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 8,
        top: "middle",
        textStyle: {
          color: "#475569"
        }
      },
      series: [
        {
          type: "pie",
          radius: ["62%", "90%"],
          center: ["36%", "50%"],
          avoidLabelOverlap: true,
          label: {
            show: false
          },
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 2
          },
          data: data.map((item) => ({
            name: item.name,
            value: item.value
          }))
        }
      ]
    }),
    [colors, data, formatValue]
  );

  return <ReactECharts notMerge lazyUpdate option={option} style={{ width: "100%", height }} />;
}
