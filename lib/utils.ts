import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind CSS class name merging utility - Avoids class name conflicts
// Tailwind CSS 类名合并工具 - 用于避免类名冲突
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Safe JSON parsing - Falls back to default value on error
// 安全的 JSON 解析 - 出错时回退到默认值
export function safeJsonParse<T = unknown>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// Debounce function - Limits how often a function can fire
// 防抖函数 - 限制函数触发频率
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle function - Ensures a function runs at most once per limit period
// 节流函数 - 确保函数在指定时间周期内最多执行一次
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
