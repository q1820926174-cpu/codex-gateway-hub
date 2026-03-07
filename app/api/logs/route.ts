import { NextResponse } from "next/server";
import { clearApiLogEntries, readApiLogEntries } from "@/lib/api-log-store";
import { requireConsoleApiAuth } from "@/lib/console-api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveLimit(value: string | null) {
  const n = Number(value ?? "100");
  if (!Number.isFinite(n)) {
    return 100;
  }
  return Math.min(500, Math.max(10, Math.floor(n)));
}

export async function GET(req: Request) {
  const authError = requireConsoleApiAuth(req);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const limit = resolveLimit(url.searchParams.get("limit"));
  const items = await readApiLogEntries(limit);
  return NextResponse.json({
    items
  });
}

export async function DELETE(req: Request) {
  const authError = requireConsoleApiAuth(req);
  if (authError) {
    return authError;
  }

  await clearApiLogEntries();
  return NextResponse.json({ ok: true });
}
