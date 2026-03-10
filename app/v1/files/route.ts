import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { handleCreateFile, handleListFiles } from "@/lib/files-handlers";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enforceRateLimit(req: Request) {
  const rateLimit = checkRateLimit(req, {
    bucket: "/v1/files",
    limit: 60,
    windowMs: 60_000
  });

  if (rateLimit.allowed) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Rate limit exceeded",
      retryAfterSeconds: rateLimit.retryAfterSeconds
    },
    { status: 429 }
  );
}

export async function GET(req: Request) {
  const blocked = enforceRateLimit(req);
  if (blocked) {
    return blocked;
  }

  return withApiLog(req, "GET /v1/files", () => handleListFiles(req));
}

export async function POST(req: Request) {
  const blocked = enforceRateLimit(req);
  if (blocked) {
    return blocked;
  }

  return withApiLog(req, "POST /v1/files", () => handleCreateFile(req));
}
