import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";

export function GET(req: Request) {
  return withApiLog(req, "GET /api/health", () => NextResponse.json({ ok: true }));
}
