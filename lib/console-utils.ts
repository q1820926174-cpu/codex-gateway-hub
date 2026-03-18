// ID generation utility functions
// ID 生成工具函数
import { MessagePlugin } from "tdesign-react";
export function generateLocalKey() {
  // Generate a random local key in OpenAI format (sk-...)
  // 生成 OpenAI 格式的随机本地密钥 (sk-...)
  const random = crypto.getRandomValues(new Uint8Array(24));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sk-${suffix}`;
}

export function generateModelId() {
  // Generate a random model ID (mdl_...)
  // 生成随机的模型 ID (mdl_...)
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `mdl_${suffix}`;
}

export function generateMappingId() {
  // Generate a random mapping ID (map_...)
  // 生成随机的映射 ID (map_...)
  const random = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(random)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `map_${suffix}`;
}

// Number formatting utility
// 格式化工具
export function formatNumber(num: number): string {
  // Format number with Chinese locale
  // 使用中文区域设置格式化数字
  return new Intl.NumberFormat("zh-CN").format(num);
}

// Copy text to clipboard utility
// 复制到剪贴板
export async function copyTextToClipboard(text: string, successMessage?: string) {
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) {
      void MessagePlugin.success(successMessage);
    }
  } catch (err) {
    console.error("Failed to copy text:", err);
    void MessagePlugin.error("复制失败，请手动复制。");
  }
}

export function resolveDownloadFileName(
  suggestedPath: string | null | undefined,
  fallbackFileName: string
) {
  if (!suggestedPath) {
    return fallbackFileName;
  }
  const trimmed = suggestedPath.trim();
  if (!trimmed) {
    return fallbackFileName;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const candidate = normalized.split("/").pop()?.trim();
  return candidate || fallbackFileName;
}

export function inferTextFileMimeType(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  if (normalized.endsWith(".toml")) {
    return "application/toml";
  }
  if (normalized.endsWith(".md")) {
    return "text/markdown";
  }
  if (normalized.endsWith(".sh")) {
    return "text/x-shellscript";
  }
  if (normalized.endsWith(".env")) {
    return "text/plain";
  }
  return "text/plain";
}

export function downloadTextAsFile(
  fileName: string,
  content: string,
  mimeType = inferTextFileMimeType(fileName)
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
