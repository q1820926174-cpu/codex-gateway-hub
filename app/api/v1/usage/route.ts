import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleRuntimeUsage } from "@/lib/runtime-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rateLimit = checkRateLimit(req, {
    bucket: "/api/v1/usage",
    limit: 60,
    windowMs: 60_000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "Rate limit exceeded",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      },
      { status: 429 }
    );
  }

  return withApiLog(req, "GET /api/v1/usage", () => handleRuntimeUsage(req));
}
