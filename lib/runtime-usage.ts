import { NextResponse } from "next/server";
import {
  readKeyDailyUsageSnapshot,
  type KeyDailyUsageSnapshot
} from "@/lib/usage-report";
import {
  resolveGatewayKey,
  type ResolvedGatewayKey
} from "@/lib/upstream";

type RuntimeUsagePlan = {
  planName: string;
  total?: number;
  used?: number;
  remaining?: number;
  unit?: string;
  extra?: string;
  isValid?: boolean;
  invalidMessage?: string;
};

function joinExtra(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" · ");
}

function buildRuntimeUsagePlans(
  key: ResolvedGatewayKey,
  snapshot: KeyDailyUsageSnapshot
): RuntimeUsagePlan[] {
  const plans: RuntimeUsagePlan[] = [];
  const effectiveModel = key.activeModelOverride?.trim() || key.defaultModel;
  const resetAt = snapshot.resetAt;

  if (typeof key.dailyTokenLimit === "number" && key.dailyTokenLimit > 0) {
    plans.push({
      planName: "Daily Token Quota",
      total: key.dailyTokenLimit,
      used: snapshot.totalTokens,
      remaining: Math.max(key.dailyTokenLimit - snapshot.totalTokens, 0),
      unit: "tokens",
      extra: joinExtra([
        `requests=${snapshot.requestCount}`,
        effectiveModel ? `model=${effectiveModel}` : null,
        `reset_at=${resetAt}`
      ])
    });
  }

  if (typeof key.dailyRequestLimit === "number" && key.dailyRequestLimit > 0) {
    plans.push({
      planName: "Daily Request Quota",
      total: key.dailyRequestLimit,
      used: snapshot.requestCount,
      remaining: Math.max(key.dailyRequestLimit - snapshot.requestCount, 0),
      unit: "requests",
      extra: joinExtra([
        `tokens=${snapshot.totalTokens}`,
        effectiveModel ? `model=${effectiveModel}` : null,
        `reset_at=${resetAt}`
      ])
    });
  }

  if (plans.length > 0) {
    return plans;
  }

  return [
    {
      planName: "Gateway Usage Today",
      used: snapshot.totalTokens,
      unit: "tokens",
      extra: joinExtra([
        `requests=${snapshot.requestCount}`,
        effectiveModel ? `model=${effectiveModel}` : null,
        `reset_at=${resetAt}`
      ])
    }
  ];
}

export async function handleRuntimeUsage(req: Request) {
  const resolved = await resolveGatewayKey(
    req.headers.get("authorization"),
    req.headers.get("x-api-key")
  );
  if (!resolved.ok) {
    return NextResponse.json(
      {
        success: false,
        error: resolved.body.error
      },
      { status: resolved.status }
    );
  }

  const key = resolved.key;
  const snapshot = await readKeyDailyUsageSnapshot(key.id);
  const effectiveModel = key.activeModelOverride?.trim() || key.defaultModel;

  return NextResponse.json({
    success: true,
    data: buildRuntimeUsagePlans(key, snapshot),
    meta: {
      keyId: key.id,
      keyName: key.name,
      provider: key.provider,
      model: effectiveModel,
      rangeFrom: snapshot.rangeFrom,
      rangeTo: snapshot.rangeTo,
      resetAt: snapshot.resetAt,
      generatedAt: new Date().toISOString()
    }
  });
}
