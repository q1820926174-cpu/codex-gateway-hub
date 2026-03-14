// ID generation utility functions
// ID 生成工具函数
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
    // Use clipboard API to write text
    // 使用剪贴板 API 写入文本
    await navigator.clipboard.writeText(text);
    if (successMessage) {
      // Could call toast or message component here
      // 这里可以调用 toast 或 message 组件
      console.log(successMessage);
    }
  } catch (err) {
    console.error("Failed to copy text:", err);
  }
}
