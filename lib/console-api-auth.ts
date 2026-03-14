import { NextResponse } from "next/server";
import {
  getEntrySecret,
  isEntryCookieValid,
  SECRET_ENTRY_COOKIE,
  verifyEntrySecret
} from "@/lib/entry-secret";

// Resolve Bearer token from Authorization header
// 从 Authorization 头解析 Bearer 令牌
function resolveBearerToken(authorization: string | null) {
  if (!authorization) {
    return "";
  }
  const trimmed = authorization.trim();
  if (!trimmed.startsWith("Bearer ")) {
    return "";
  }
  return trimmed.slice("Bearer ".length).trim();
}

// Read cookie value from request headers
// 从请求头读取 Cookie 值
function readCookieValue(req: Request, cookieName: string) {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return "";
  }
  // Parse cookie header and find the requested cookie
  // 解析 Cookie 头并查找请求的 Cookie
  const cookieItems = cookieHeader.split(";");
  for (const cookieItem of cookieItems) {
    const [rawName, ...rawValueParts] = cookieItem.split("=");
    if (!rawName || rawValueParts.length === 0) {
      continue;
    }
    if (rawName.trim() !== cookieName) {
      continue;
    }
    const rawValue = rawValueParts.join("=").trim();
    if (!rawValue) {
      return "";
    }
    try {
      // Try to decode URI component in case it's encoded
      // 尝试解码 URI 组件，以防它被编码
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return "";
}

// Require console API authentication
// 要求控制台 API 认证
export function requireConsoleApiAuth(req: Request): NextResponse | null {
  const entrySecret = getEntrySecret();
  if (!entrySecret) {
    // No secret configured - allow access in development, block in production
    // 未配置密钥 - 开发环境允许访问，生产环境阻止
    if (process.env.NODE_ENV !== "production") {
      return null;
    }
    return NextResponse.json(
      {
        error: "CONSOLE_ENTRY_SECRET is required in production."
      },
      { status: 503 }
    );
  }

  // First, try Bearer token authentication
  // 首先尝试 Bearer 令牌认证
  const bearerToken = resolveBearerToken(req.headers.get("authorization"));
  if (bearerToken && verifyEntrySecret(bearerToken)) {
    return null;
  }

  // Then, try cookie authentication
  // 然后尝试 Cookie 认证
  const entryCookieValue = readCookieValue(req, SECRET_ENTRY_COOKIE);
  if (entryCookieValue && isEntryCookieValid(entryCookieValue)) {
    return null;
  }

  // Neither authentication method succeeded
  // 两种认证方法都未成功
  return NextResponse.json(
    {
      error: "Unauthorized."
    },
    { status: 401 }
  );
}
