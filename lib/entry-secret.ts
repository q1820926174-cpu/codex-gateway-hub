import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Cookie name for gateway secret entry authentication
// 网关密钥入口认证的 Cookie 名称
export const SECRET_ENTRY_COOKIE = "gateway_secret_entry";
// Default redirect path after successful entry
// 成功进入后的默认重定向路径
const DEFAULT_NEXT_PATH = "/console/access";
// Default max age for entry cookie (7 days)
// 入口 Cookie 的默认最大有效期（7 天）
const DEFAULT_ENTRY_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// Compute SHA256 hash of a string and return as hex
// 计算字符串的 SHA256 哈希并返回十六进制格式
function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Safe string comparison using timing-safe equal to prevent timing attacks
// 使用时序安全比较来防止时序攻击的安全字符串比较
function safeCompareString(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

// Get the console entry secret from environment variable
// 从环境变量获取控制台入口密钥
export function getEntrySecret() {
  return (process.env.CONSOLE_ENTRY_SECRET ?? "").trim();
}

// Check if entry secret authentication is enabled
// 检查是否启用了入口密钥认证
export function isEntrySecretEnabled() {
  return Boolean(getEntrySecret());
}

// Build entry cookie value from secret
// 从密钥构建入口 Cookie 值
export function buildEntryCookieValue(secret = getEntrySecret()) {
  if (!secret) {
    return "";
  }
  return `v1.${sha256Hex(`console-entry:${secret}`)}`;
}

// Verify user input secret against expected secret
// 验证用户输入的密钥与预期密钥是否匹配
export function verifyEntrySecret(inputSecret: string) {
  const expectedSecret = getEntrySecret();
  if (!expectedSecret) {
    return true;
  }
  return safeCompareString(inputSecret.trim(), expectedSecret);
}

// Validate entry cookie value
// 验证入口 Cookie 值
export function isEntryCookieValid(cookieValue: string) {
  const expectedCookieValue = buildEntryCookieValue();
  if (!expectedCookieValue) {
    return true;
  }
  return safeCompareString(cookieValue, expectedCookieValue);
}

// Normalize and validate the next path for redirection
// 标准化并验证用于重定向的下一路径
export function normalizeEntryNextPath(rawNextPath: string | undefined | null) {
  if (typeof rawNextPath !== "string") {
    return DEFAULT_NEXT_PATH;
  }
  const trimmed = rawNextPath.trim();
  // Ensure path starts with single slash and not double slashes
  // 确保路径以单斜杠开头而不是双斜杠
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }
  // Prevent redirect loops back to secret-entry
  // 防止重定向回 secret-entry 造成循环
  if (trimmed.startsWith("/secret-entry")) {
    return DEFAULT_NEXT_PATH;
  }
  return trimmed || DEFAULT_NEXT_PATH;
}

// Parse boolean value from environment variable
// 从环境变量解析布尔值
function parseBooleanEnv(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}

// Resolve whether entry cookie should be secure
// 解析入口 Cookie 是否应该为安全 Cookie
export function resolveEntryCookieSecure(req?: Request) {
  const overrideSecure = parseBooleanEnv(process.env.CONSOLE_ENTRY_COOKIE_SECURE);
  if (typeof overrideSecure === "boolean") {
    return overrideSecure;
  }

  if (req) {
    // Check x-forwarded-proto header for proxy scenarios
    // 检查代理场景下的 x-forwarded-proto 头
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const firstForwardedProto = forwardedProto?.split(",")[0]?.trim().toLowerCase() ?? "";
    if (firstForwardedProto) {
      return firstForwardedProto === "https";
    }

    try {
      // Check protocol from request URL
      // 从请求 URL 检查协议
      return new URL(req.url).protocol === "https:";
    } catch {
      // Fall back to NODE_ENV check
      // 回退到 NODE_ENV 检查
      return process.env.NODE_ENV === "production";
    }
  }

  // Default secure based on production environment
  // 基于生产环境的默认安全设置
  return process.env.NODE_ENV === "production";
}

// Get entry cookie options
// 获取入口 Cookie 选项
export function entryCookieOptions(options?: { maxAge?: number; secure?: boolean }) {
  const maxAge = options?.maxAge ?? DEFAULT_ENTRY_COOKIE_MAX_AGE;
  const secure = typeof options?.secure === "boolean" ? options.secure : resolveEntryCookieSecure();
  return {
    // HttpOnly prevents XSS access to cookie
    // HttpOnly 防止 XSS 访问 Cookie
    httpOnly: true,
    // SameSite lax provides CSRF protection
    // SameSite lax 提供 CSRF 保护
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge
  };
}

// Check if user is authenticated via entry secret
// 检查用户是否通过入口密钥认证
export async function isEntryAuthenticated() {
  if (!isEntrySecretEnabled()) {
    return true;
  }
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SECRET_ENTRY_COOKIE)?.value ?? "";
  return isEntryCookieValid(cookieValue);
}

// Ensure user has entry access, redirect to secret entry if not
// 确保用户有入口访问权限，否则重定向到密钥入口
export async function ensureEntryAccess(nextPath = DEFAULT_NEXT_PATH) {
  if (!isEntrySecretEnabled()) {
    return;
  }
  if (await isEntryAuthenticated()) {
    return;
  }
  const safeNextPath = normalizeEntryNextPath(nextPath);
  redirect(`/secret-entry?next=${encodeURIComponent(safeNextPath)}`);
}
