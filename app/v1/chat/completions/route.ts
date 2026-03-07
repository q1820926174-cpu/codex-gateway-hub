import { NextResponse } from "next/server";
import { handleLegacyChatCompletions } from "@/lib/compat-handlers";
import { withApiLog } from "@/lib/api-log";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rateLimit = checkRateLimit(req, {
    bucket: "/v1/chat/completions",
    limit: 120,
    windowMs: 60_000
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfterSeconds: rateLimit.retryAfterSeconds
      },
      { status: 429 }
    );
  }

  return withApiLog(req, "POST /v1/chat/completions", () =>
    handleLegacyChatCompletions(req, "/v1/chat/completions")
  );
}
