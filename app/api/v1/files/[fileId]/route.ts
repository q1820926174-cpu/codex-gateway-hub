import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { handleDeleteFile, handleGetFile } from "@/lib/files-handlers";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enforceRateLimit(req: Request) {
  const rateLimit = checkRateLimit(req, {
    bucket: "/api/v1/files/:id",
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

export async function GET(
  req: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  const blocked = enforceRateLimit(req);
  if (blocked) {
    return blocked;
  }

  const { fileId } = await context.params;
  return withApiLog(req, "GET /api/v1/files/:id", () => handleGetFile(req, fileId));
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  const blocked = enforceRateLimit(req);
  if (blocked) {
    return blocked;
  }

  const { fileId } = await context.params;
  return withApiLog(req, "DELETE /api/v1/files/:id", () => handleDeleteFile(req, fileId));
}
