import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";

// Health check endpoint - Returns simple ok response
// 健康检查端点 - 返回简单的 ok 响应
export function GET(req: Request) {
  // Wrap with API logging middleware
  // 使用 API 日志中间件包装
  return withApiLog(req, "GET /api/health", () => NextResponse.json({ ok: true }));
}
