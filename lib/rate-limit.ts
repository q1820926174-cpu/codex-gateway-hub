type RateLimitPolicy = {
  bucket: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const globalRateLimitState = globalThis as typeof globalThis & {
  __rateLimitStore?: Map<string, RateLimitRecord>;
  __rateLimitLastCleanupAt?: number;
};

const rateLimitStore = globalRateLimitState.__rateLimitStore ?? new Map<string, RateLimitRecord>();
if (!globalRateLimitState.__rateLimitStore) {
  globalRateLimitState.__rateLimitStore = rateLimitStore;
}

function getClientIdentifier(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return "unknown";
}

function cleanupRateLimitStore(now: number) {
  const lastCleanupAt = globalRateLimitState.__rateLimitLastCleanupAt ?? 0;
  if (now - lastCleanupAt < 60_000) {
    return;
  }
  globalRateLimitState.__rateLimitLastCleanupAt = now;

  for (const [key, record] of rateLimitStore) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export function checkRateLimit(req: Request, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const windowMs = Math.max(1, Math.floor(policy.windowMs));
  const limit = Math.max(1, Math.floor(policy.limit));
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  const key = `${policy.bucket}:${getClientIdentifier(req)}`;
  const existing = rateLimitStore.get(key);
  const record =
    existing && existing.resetAt === resetAt
      ? existing
      : {
          count: 0,
          resetAt
        };

  const allowed = record.count < limit;
  if (allowed) {
    record.count += 1;
    rateLimitStore.set(key, record);
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return {
    allowed,
    retryAfterSeconds,
    limit,
    remaining: allowed ? Math.max(0, limit - record.count) : 0,
    resetEpochSeconds: Math.floor(resetAt / 1000)
  };
}
