type EntrySecretGuardPolicy = {
  bucket: string;
  maxFailures: number;
  windowMs: number;
  lockMs: number;
};

type EntrySecretGuardState = {
  failureCount: number;
  firstFailureAt: number;
  lockUntil: number;
};

type EntrySecretGuardResult = {
  blocked: boolean;
  retryAfterSeconds: number;
  remainingFailures: number;
};

const globalEntrySecretGuardState = globalThis as typeof globalThis & {
  __entrySecretGuardStore?: Map<string, EntrySecretGuardState>;
  __entrySecretGuardLastCleanupAt?: number;
};

const entrySecretGuardStore = globalEntrySecretGuardState.__entrySecretGuardStore ?? new Map<string, EntrySecretGuardState>();
if (!globalEntrySecretGuardState.__entrySecretGuardStore) {
  globalEntrySecretGuardState.__entrySecretGuardStore = entrySecretGuardStore;
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

function normalizeMs(value: number, fallback: number) {
  const rounded = Math.floor(value);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return fallback;
  }
  return rounded;
}

function normalizeCount(value: number, fallback: number) {
  const rounded = Math.floor(value);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return fallback;
  }
  return rounded;
}

function normalizePolicy(policy: EntrySecretGuardPolicy) {
  return {
    bucket: policy.bucket,
    maxFailures: normalizeCount(policy.maxFailures, 6),
    windowMs: normalizeMs(policy.windowMs, 5 * 60_000),
    lockMs: normalizeMs(policy.lockMs, 15 * 60_000)
  };
}

function cleanupEntrySecretGuardStore(now: number) {
  const lastCleanupAt = globalEntrySecretGuardState.__entrySecretGuardLastCleanupAt ?? 0;
  if (now - lastCleanupAt < 60_000) {
    return;
  }
  globalEntrySecretGuardState.__entrySecretGuardLastCleanupAt = now;

  for (const [key, state] of entrySecretGuardStore) {
    const windowExpired = state.firstFailureAt + 30 * 60_000 <= now;
    const lockInactiveOrExpired = state.lockUntil === 0 || state.lockUntil <= now;
    if (windowExpired && lockInactiveOrExpired) {
      entrySecretGuardStore.delete(key);
    }
  }
}

function getPolicyKey(req: Request, policy: EntrySecretGuardPolicy) {
  return `${policy.bucket}:${getClientIdentifier(req)}`;
}

function getRetryAfterSeconds(deadline: number, now: number) {
  if (deadline <= now) {
    return 0;
  }
  return Math.max(1, Math.ceil((deadline - now) / 1000));
}

export function getEntrySecretGuardStatus(
  req: Request,
  inputPolicy: EntrySecretGuardPolicy
): EntrySecretGuardResult {
  const now = Date.now();
  cleanupEntrySecretGuardStore(now);
  const policy = normalizePolicy(inputPolicy);
  const key = getPolicyKey(req, policy);
  const state = entrySecretGuardStore.get(key);

  if (!state) {
    return {
      blocked: false,
      retryAfterSeconds: 0,
      remainingFailures: policy.maxFailures
    };
  }

  if (state.lockUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: getRetryAfterSeconds(state.lockUntil, now),
      remainingFailures: 0
    };
  }

  if (state.firstFailureAt + policy.windowMs <= now) {
    entrySecretGuardStore.delete(key);
    return {
      blocked: false,
      retryAfterSeconds: 0,
      remainingFailures: policy.maxFailures
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
    remainingFailures: Math.max(0, policy.maxFailures - state.failureCount)
  };
}

export function recordEntrySecretFailure(
  req: Request,
  inputPolicy: EntrySecretGuardPolicy
): EntrySecretGuardResult {
  const now = Date.now();
  cleanupEntrySecretGuardStore(now);
  const policy = normalizePolicy(inputPolicy);
  const key = getPolicyKey(req, policy);
  const state = entrySecretGuardStore.get(key);

  let nextState: EntrySecretGuardState;
  if (!state || state.firstFailureAt + policy.windowMs <= now || state.lockUntil > 0) {
    nextState = {
      failureCount: 1,
      firstFailureAt: now,
      lockUntil: 0
    };
  } else {
    nextState = {
      failureCount: state.failureCount + 1,
      firstFailureAt: state.firstFailureAt,
      lockUntil: 0
    };
  }

  if (nextState.failureCount >= policy.maxFailures) {
    nextState.lockUntil = now + policy.lockMs;
  }

  entrySecretGuardStore.set(key, nextState);

  if (nextState.lockUntil > now) {
    return {
      blocked: true,
      retryAfterSeconds: getRetryAfterSeconds(nextState.lockUntil, now),
      remainingFailures: 0
    };
  }

  return {
    blocked: false,
    retryAfterSeconds: 0,
    remainingFailures: Math.max(0, policy.maxFailures - nextState.failureCount)
  };
}

export function clearEntrySecretFailures(req: Request, inputPolicy: EntrySecretGuardPolicy) {
  const policy = normalizePolicy(inputPolicy);
  const key = getPolicyKey(req, policy);
  entrySecretGuardStore.delete(key);
}
