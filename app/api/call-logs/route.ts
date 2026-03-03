import { NextResponse } from "next/server";
import {
  clearAiCallLogEntries,
  readAiCallLogEntries,
  type AiCallType
} from "@/lib/ai-call-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveLimit(value: string | null) {
  const n = Number(value ?? "100");
  if (!Number.isFinite(n)) {
    return 100;
  }
  return Math.min(500, Math.max(10, Math.floor(n)));
}

function resolveKeyId(value: string | null) {
  const n = Number(value ?? "");
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.floor(n);
}

function resolveCallType(value: string | null): AiCallType | null {
  if (value === "vision_fallback") {
    return "vision_fallback";
  }
  if (value === "main") {
    return "main";
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = resolveLimit(url.searchParams.get("limit"));
  const keyId = resolveKeyId(url.searchParams.get("keyId"));
  const model = url.searchParams.get("model")?.trim() || null;
  const callType = resolveCallType(url.searchParams.get("callType"));
  const { items, models, stats } = await readAiCallLogEntries({
    limit,
    keyId,
    model,
    callType
  });
  return NextResponse.json({
    items,
    models,
    stats
  });
}

export async function DELETE() {
  await clearAiCallLogEntries();
  return NextResponse.json({ ok: true });
}
