import { NextResponse } from "next/server";
import { withApiLog } from "@/lib/api-log";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";
import { clearTokenUsageEvents, readTokenUsageReport } from "@/lib/usage-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveMinutes(value: string | null) {
  const n = Number(value ?? "180");
  if (!Number.isFinite(n)) {
    return 180;
  }
  return Math.min(7 * 24 * 60, Math.max(5, Math.floor(n)));
}

function resolveTimelineLimit(value: string | null) {
  const n = Number(value ?? "600");
  if (!Number.isFinite(n)) {
    return 600;
  }
  return Math.min(3000, Math.max(50, Math.floor(n)));
}

function resolveKeyId(value: string | null) {
  if (!value) {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.floor(n);
}

function resolveDateTime(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export async function GET(req: Request) {
  return withApiLog(req, "GET /api/usage", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    const url = new URL(req.url);
    const report = await readTokenUsageReport({
      minutes: resolveMinutes(url.searchParams.get("minutes")),
      timelineLimit: resolveTimelineLimit(url.searchParams.get("limit")),
      keyId: resolveKeyId(url.searchParams.get("keyId")),
      fromTime: resolveDateTime(url.searchParams.get("from")),
      toTime: resolveDateTime(url.searchParams.get("to"))
    });
    return NextResponse.json(report);
  });
}

export async function DELETE(req: Request) {
  return withApiLog(req, "DELETE /api/usage", async () => {
    const authError = requireConsoleApiAuth(req);
    if (authError) {
      return authError;
    }

    await clearTokenUsageEvents();
    return NextResponse.json({ ok: true });
  });
}
