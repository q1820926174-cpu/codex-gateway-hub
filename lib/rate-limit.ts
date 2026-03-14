// Rate limit policy configuration
// 速率限制策略配置
type RateLimitPolicy = {
  // Bucket identifier for grouping rate limits
  // 用于分组速率限制的桶标识符
  bucket: string;
  // Maximum requests allowed per window
  // 每个时间窗口允许的最大请求数
  limit: number;
  // Time window in milliseconds
  // 时间窗口（毫秒）
  windowMs: number;
};

// Result of rate limit check
// 速率限制检查结果
type RateLimitResult = {
  // Whether the request is allowed
  // 请求是否被允许
  allowed: boolean;
  // Seconds to wait before retrying
  // 重试前需要等待的秒数
  retryAfterSeconds: number;
  // Total limit for the window
  // 窗口的总限制
  limit: number;
  // Remaining requests in window
  // 窗口中剩余的请求数
  remaining: number;
  // Epoch timestamp when the window resets
  // 窗口重置的时间戳
  resetEpochSeconds: number;
};

// Internal record for tracking rate limits
// 用于跟踪速率限制的内部记录
type RateLimitRecord = {
  // Number of requests made in current window
  // 当前窗口的请求数量
  count: number;
  // Timestamp when the window resets
  // 窗口重置的时间戳
  resetAt: number;
};

// Global state for rate limiting (persists across hot reloads in dev)
// 速率限制的全局状态（开发模式下跨热重载持久化）
const globalRateLimitState = globalThis as typeof globalThis & {
  __rateLimitStore?: Map<string, RateLimitRecord>;
  __rateLimitLastCleanupAt?: number;
};

// Rate limit store - uses global state for development persistence
// 速率限制存储 - 使用全局状态实现开发模式持久化
const rateLimitStore = globalRateLimitState.__rateLimitStore ?? new Map<string, RateLimitRecord>();
if (!globalRateLimitState.__rateLimitStore) {
  globalRateLimitState.__rateLimitStore = rateLimitStore;
}

// Extract client identifier from request headers
// 从请求头提取客户端标识符
function getClientIdentifier(req: Request) {
  // Try x-forwarded-for first (for proxies)
  // 首先尝试 x-forwarded-for（用于代理场景）
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  // Try x-real-ip
  // 尝试 x-real-ip
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  // Try Cloudflare CF-Connecting-IP
  // 尝试 Cloudflare CF-Connecting-IP
  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return "unknown";
}

// Clean up expired rate limit records
// 清理过期的速率限制记录
function cleanupRateLimitStore(now: number) {
  // Only clean up once per minute to avoid overhead
  // 每分钟只清理一次以避免开销
  const lastCleanupAt = globalRateLimitState.__rateLimitLastCleanupAt ?? 0;
  if (now - lastCleanupAt < 60_000) {
    return;
  }
  globalRateLimitState.__rateLimitLastCleanupAt = now;

  // Delete records where the window has expired
  // 删除窗口已过期的记录
  for (const [key, record] of rateLimitStore) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

// Check rate limit for a request
// 检查请求的速率限制
export function checkRateLimit(req: Request, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  // Clean up expired records first
  // 首先清理过期记录
  cleanupRateLimitStore(now);

  // Validate policy parameters
  // 验证策略参数
  const windowMs = Math.max(1, Math.floor(policy.windowMs));
  const limit = Math.max(1, Math.floor(policy.limit));
  // Calculate window boundaries
  // 计算窗口边界
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  // Build rate limit key from bucket and client identifier
  // 从桶和客户端标识符构建速率限制键
  const key = `${policy.bucket}:${getClientIdentifier(req)}`;
  const existing = rateLimitStore.get(key);
  // Use existing record if it's for the current window, otherwise create new
  // 如果是当前窗口则使用现有记录，否则创建新记录
  const record =
    existing && existing.resetAt === resetAt
      ? existing
      : {
          count: 0,
          resetAt
        };

  // Check if request is allowed
  // 检查请求是否被允许
  const allowed = record.count < limit;
  if (allowed) {
    // Increment count and update store
    // 增加计数并更新存储
    record.count += 1;
    rateLimitStore.set(key, record);
  }

  // Calculate retry after seconds
  // 计算重试等待秒数
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return {
    allowed,
    retryAfterSeconds,
    limit,
    remaining: allowed ? Math.max(0, limit - record.count) : 0,
    resetEpochSeconds: Math.floor(resetAt / 1000)
  };
}
