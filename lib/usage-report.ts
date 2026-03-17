import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type UsageValue = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type RecordUsageInput = {
  keyId: number;
  keyName: string;
  route: string;
  requestWireApi: string;
  upstreamWireApi: string;
  requestedModel: string;
  clientModel: string;
  upstreamModel: string;
  stream: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  createdAt?: Date;
};

type UsageReportQuery = {
  minutes?: number;
  keyId?: number | null;
  timelineLimit?: number;
  fromTime?: Date | null;
  toTime?: Date | null;
};

export type KeyDailyUsageSnapshot = {
  keyId: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  rangeFrom: string;
  rangeTo: string;
  resetAt: string;
};

export type KeyDailyLimitCheckResult =
  | {
      allowed: true;
      snapshot: KeyDailyUsageSnapshot;
    }
  | {
      allowed: false;
      status: number;
      body: {
        error: string;
        type: "daily_request_limit" | "daily_token_limit";
        scope: "daily";
        limit: number;
        used: number;
        remaining: number;
        projectedUsed: number;
        promptTokensEstimate: number;
        rangeFrom: string;
        rangeTo: string;
        resetAt: string;
      };
      snapshot: KeyDailyUsageSnapshot;
    };

export type UsageFilterOptions = {
  upstreamModels: string[];
  routes: string[];
  requestWireApis: string[];
  upstreamWireApis: string[];
  streams: string[];
};

export const EMPTY_USAGE_FILTER_OPTIONS: UsageFilterOptions = {
  upstreamModels: [],
  routes: [],
  requestWireApis: [],
  upstreamWireApis: [],
  streams: []
};

type TokenUsageDelegate = {
  create: (args: any) => Promise<any>;
  deleteMany: (args?: any) => Promise<any>;
  groupBy: (args: any) => Promise<any[]>;
};

function toSafeInt(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.floor(n);
}

function tokenUsageDelegate(): TokenUsageDelegate | null {
  const candidate = (prisma as unknown as { tokenUsageEvent?: TokenUsageDelegate }).tokenUsageEvent;
  if (!candidate || typeof candidate.groupBy !== "function") {
    return null;
  }
  return candidate;
}

function clampMinutes(value?: number) {
  const n = Number(value ?? 180);
  if (!Number.isFinite(n)) {
    return 180;
  }
  return Math.min(7 * 24 * 60, Math.max(5, Math.floor(n)));
}

function clampTimelineLimit(value?: number) {
  const n = Number(value ?? 600);
  if (!Number.isFinite(n)) {
    return 600;
  }
  return Math.min(3000, Math.max(50, Math.floor(n)));
}

const MAX_CUSTOM_RANGE_MINUTES = 180 * 24 * 60;

function toMinuteBucket(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

function startOfLocalDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfNextLocalDay(date: Date) {
  const next = startOfLocalDay(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function toUsageObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function readTokenNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const n = toSafeInt(source[key]);
    if (n > 0) {
      return n;
    }
  }
  return 0;
}

export function extractTokenUsageFromPayload(payload: unknown): UsageValue | null {
  const root = toUsageObject(payload);
  if (!root) {
    return null;
  }

  const nestedUsage = toUsageObject(root.usage);
  const responseUsage = toUsageObject(toUsageObject(root.response)?.usage);
  const messageUsage = toUsageObject(toUsageObject(root.message)?.usage);
  const usage = nestedUsage ?? responseUsage ?? messageUsage ?? root;

  const promptTokens = readTokenNumber(usage, ["prompt_tokens", "input_tokens"]);
  const completionTokens = readTokenNumber(usage, ["completion_tokens", "output_tokens"]);
  const totalTokens = readTokenNumber(usage, ["total_tokens"]);

  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) {
    return null;
  }

  if (totalTokens > 0) {
    return {
      promptTokens: promptTokens || Math.max(totalTokens - completionTokens, 0),
      completionTokens: completionTokens || Math.max(totalTokens - promptTokens, 0),
      totalTokens
    };
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}

export async function recordTokenUsageEvent(input: RecordUsageInput) {
  const delegate = tokenUsageDelegate();
  if (!delegate) {
    return;
  }

  const promptTokens = toSafeInt(input.promptTokens);
  const completionTokens = toSafeInt(input.completionTokens);
  const totalTokens = Math.max(
    toSafeInt(input.totalTokens),
    promptTokens + completionTokens
  );

  const createdAt = input.createdAt ?? new Date();
  const minuteBucket = toMinuteBucket(createdAt);

  await delegate.create({
    data: {
      keyId: input.keyId,
      keyName: input.keyName,
      route: input.route,
      requestWireApi: input.requestWireApi,
      upstreamWireApi: input.upstreamWireApi,
      requestedModel: input.requestedModel,
      clientModel: input.clientModel,
      upstreamModel: input.upstreamModel,
      stream: input.stream,
      promptTokens,
      completionTokens,
      totalTokens,
      minuteBucket,
      createdAt
    }
  });
}

export async function clearTokenUsageEvents() {
  const delegate = tokenUsageDelegate();
  if (!delegate) {
    return;
  }
  await delegate.deleteMany({});
}

export async function readKeyDailyUsageSnapshot(
  keyId: number,
  now = new Date()
): Promise<KeyDailyUsageSnapshot> {
  const keyIdNumber = Number(keyId);
  const safeKeyId = Number.isInteger(keyIdNumber) && keyIdNumber > 0 ? keyIdNumber : 0;
  const rangeFromDate = startOfLocalDay(now);
  const rangeToDate = startOfNextLocalDay(now);
  const rangeFromBucket = toMinuteBucket(rangeFromDate);
  const rangeToBucket = toMinuteBucket(rangeToDate);
  const delegate = tokenUsageDelegate();

  if (!delegate || safeKeyId <= 0) {
    return {
      keyId: safeKeyId,
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      rangeFrom: rangeFromDate.toISOString(),
      rangeTo: rangeToDate.toISOString(),
      resetAt: rangeToDate.toISOString()
    };
  }

  const grouped = await delegate.groupBy({
    by: ["keyId"],
    where: {
      keyId: safeKeyId,
      minuteBucket: {
        gte: rangeFromBucket,
        lt: rangeToBucket
      }
    },
    _count: { _all: true },
    _sum: {
      promptTokens: true,
      completionTokens: true,
      totalTokens: true
    }
  });
  const row = grouped[0];

  return {
    keyId: safeKeyId,
    requestCount: row?._count?._all ?? 0,
    promptTokens: row?._sum?.promptTokens ?? 0,
    completionTokens: row?._sum?.completionTokens ?? 0,
    totalTokens: row?._sum?.totalTokens ?? 0,
    rangeFrom: rangeFromDate.toISOString(),
    rangeTo: rangeToDate.toISOString(),
    resetAt: rangeToDate.toISOString()
  };
}

export async function checkKeyDailyLimits(input: {
  keyId: number;
  dailyRequestLimit?: number | null;
  dailyTokenLimit?: number | null;
  promptTokensEstimate?: number;
  now?: Date;
}): Promise<KeyDailyLimitCheckResult> {
  const snapshot = await readKeyDailyUsageSnapshot(input.keyId, input.now ?? new Date());
  const dailyRequestLimit = toSafeInt(input.dailyRequestLimit);
  const dailyTokenLimit = toSafeInt(input.dailyTokenLimit);
  const promptTokensEstimate = Math.max(0, toSafeInt(input.promptTokensEstimate));

  if (dailyRequestLimit > 0) {
    const projectedUsed = snapshot.requestCount + 1;
    if (projectedUsed > dailyRequestLimit) {
      return {
        allowed: false,
        status: 429,
        body: {
          error: "Daily request limit exceeded for this key.",
          type: "daily_request_limit",
          scope: "daily",
          limit: dailyRequestLimit,
          used: snapshot.requestCount,
          remaining: Math.max(dailyRequestLimit - snapshot.requestCount, 0),
          projectedUsed,
          promptTokensEstimate,
          rangeFrom: snapshot.rangeFrom,
          rangeTo: snapshot.rangeTo,
          resetAt: snapshot.resetAt
        },
        snapshot
      };
    }
  }

  if (dailyTokenLimit > 0) {
    const projectedUsed = snapshot.totalTokens + promptTokensEstimate;
    if (snapshot.totalTokens >= dailyTokenLimit || projectedUsed > dailyTokenLimit) {
      return {
        allowed: false,
        status: 429,
        body: {
          error: "Daily token limit exceeded for this key.",
          type: "daily_token_limit",
          scope: "daily",
          limit: dailyTokenLimit,
          used: snapshot.totalTokens,
          remaining: Math.max(dailyTokenLimit - snapshot.totalTokens, 0),
          projectedUsed,
          promptTokensEstimate,
          rangeFrom: snapshot.rangeFrom,
          rangeTo: snapshot.rangeTo,
          resetAt: snapshot.resetAt
        },
        snapshot
      };
    }
  }

  return {
    allowed: true,
    snapshot
  };
}

function normalizeFilterString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function toOptionList(rows: Array<Record<string, unknown>>, key: string) {
  return rows
    .map((item) => String(item[key] ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function readTokenUsageReport(query: UsageReportQuery & {
  upstreamModel?: string | null;
  route?: string | null;
  requestWireApi?: string | null;
  upstreamWireApi?: string | null;
  stream?: boolean | null;
}) {
  const minutes = clampMinutes(query.minutes);
  const timelineLimit = clampTimelineLimit(query.timelineLimit);
  const now = new Date();
  let rangeFrom = new Date(now.getTime() - minutes * 60_000);
  let rangeTo = now;

  if (query.fromTime || query.toTime) {
    rangeFrom = query.fromTime ? new Date(query.fromTime) : new Date(rangeTo.getTime() - minutes * 60_000);
    rangeTo = query.toTime ? new Date(query.toTime) : now;

    if (Number.isNaN(rangeFrom.getTime())) {
      rangeFrom = new Date(now.getTime() - minutes * 60_000);
    }
    if (Number.isNaN(rangeTo.getTime())) {
      rangeTo = now;
    }
    if (rangeFrom.getTime() > rangeTo.getTime()) {
      const swapped = rangeFrom;
      rangeFrom = rangeTo;
      rangeTo = swapped;
    }

    const rangeMinutes = Math.floor((rangeTo.getTime() - rangeFrom.getTime()) / 60_000);
    if (rangeMinutes > MAX_CUSTOM_RANGE_MINUTES) {
      rangeFrom = new Date(rangeTo.getTime() - MAX_CUSTOM_RANGE_MINUTES * 60_000);
    }
  }

  const fromBucket = toMinuteBucket(rangeFrom);
  const toBucket = toMinuteBucket(rangeTo);
  const effectiveWindowMinutes = Math.max(
    1,
    Math.floor((toBucket.getTime() - fromBucket.getTime()) / 60_000) + 1
  );
  const delegate = tokenUsageDelegate();
  if (!delegate) {
    return {
      windowMinutes: effectiveWindowMinutes,
      keyId: query.keyId ?? null,
      generatedAt: now.toISOString(),
      rangeFrom: fromBucket.toISOString(),
      rangeTo: toBucket.toISOString(),
      summary: {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        uniqueKeys: 0,
        uniqueModels: 0
      },
      perKey: [],
      perModel: [],
      timeline: [],
      filterOptions: EMPTY_USAGE_FILTER_OPTIONS
    };
  }

  const where: Prisma.TokenUsageEventWhereInput = {
    minuteBucket: {
      gte: fromBucket,
      lte: toBucket
    }
  };

  if (query.keyId && query.keyId > 0) {
    where.keyId = query.keyId;
  }
  const upstreamModelFilter = normalizeFilterString(query.upstreamModel);
  if (upstreamModelFilter) {
    where.upstreamModel = upstreamModelFilter;
  }
  const routeFilter = normalizeFilterString(query.route);
  if (routeFilter) {
    where.route = routeFilter;
  }
  const requestWireApiFilter = normalizeFilterString(query.requestWireApi);
  if (requestWireApiFilter) {
    where.requestWireApi = requestWireApiFilter;
  }
  const upstreamWireApiFilter = normalizeFilterString(query.upstreamWireApi);
  if (upstreamWireApiFilter) {
    where.upstreamWireApi = upstreamWireApiFilter;
  }
  const streamFilter = query.stream ?? null;
  if (streamFilter !== null) {
    where.stream = streamFilter;
  }

  const [
    perKeyRaw,
    perModelRaw,
    timelineRaw,
    upstreamModelFiltersRaw,
    routeFiltersRaw,
    requestWireApiFiltersRaw,
    upstreamWireApiFiltersRaw,
    streamFiltersRaw
  ] = await Promise.all([
    delegate.groupBy({
      by: ["keyId", "keyName"],
      where,
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true
      }
    }),
    delegate.groupBy({
      by: ["keyId", "keyName", "upstreamModel"],
      where,
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true
      }
    }),
    delegate.groupBy({
      by: ["minuteBucket", "keyId", "keyName", "upstreamModel"],
      where,
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true
      }
    }),
    delegate.groupBy({
      by: ["upstreamModel"],
      where,
      _count: { _all: true }
    }),
    delegate.groupBy({
      by: ["route"],
      where,
      _count: { _all: true }
    }),
    delegate.groupBy({
      by: ["requestWireApi"],
      where,
      _count: { _all: true }
    }),
    delegate.groupBy({
      by: ["upstreamWireApi"],
      where,
      _count: { _all: true }
    }),
    delegate.groupBy({
      by: ["stream"],
      where,
      _count: { _all: true }
    })
  ]);

  const perKey = perKeyRaw
    .map((item) => ({
      keyId: item.keyId,
      keyName: item.keyName,
      requestCount: item._count._all,
      promptTokens: item._sum.promptTokens ?? 0,
      completionTokens: item._sum.completionTokens ?? 0,
      totalTokens: item._sum.totalTokens ?? 0
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const perModel = perModelRaw
    .map((item) => ({
      keyId: item.keyId,
      keyName: item.keyName,
      model: item.upstreamModel,
      requestCount: item._count._all,
      promptTokens: item._sum.promptTokens ?? 0,
      completionTokens: item._sum.completionTokens ?? 0,
      totalTokens: item._sum.totalTokens ?? 0
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const timeline = timelineRaw
    .map((item) => ({
      minute: item.minuteBucket.toISOString(),
      keyId: item.keyId,
      keyName: item.keyName,
      model: item.upstreamModel,
      requestCount: item._count._all,
      promptTokens: item._sum.promptTokens ?? 0,
      completionTokens: item._sum.completionTokens ?? 0,
      totalTokens: item._sum.totalTokens ?? 0
    }))
    .sort((a, b) => {
      if (a.minute === b.minute) {
        return b.totalTokens - a.totalTokens;
      }
      return a.minute > b.minute ? -1 : 1;
    })
    .slice(0, timelineLimit);

  const summary = perKey.reduce(
    (acc, item) => {
      acc.requestCount += item.requestCount;
      acc.promptTokens += item.promptTokens;
      acc.completionTokens += item.completionTokens;
      acc.totalTokens += item.totalTokens;
      return acc;
    },
    {
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  );

  const filterOptions = {
    upstreamModels: toOptionList(upstreamModelFiltersRaw, "upstreamModel"),
    routes: toOptionList(routeFiltersRaw, "route"),
    requestWireApis: toOptionList(requestWireApiFiltersRaw, "requestWireApi"),
    upstreamWireApis: toOptionList(upstreamWireApiFiltersRaw, "upstreamWireApi"),
    streams: streamFiltersRaw
      .map((item) => (item.stream ? "stream" : "non_stream"))
      .filter(Boolean)
  };

  return {
    windowMinutes: effectiveWindowMinutes,
    keyId: query.keyId ?? null,
    generatedAt: now.toISOString(),
    rangeFrom: fromBucket.toISOString(),
    rangeTo: toBucket.toISOString(),
    summary: {
      ...summary,
      uniqueKeys: perKey.length,
      uniqueModels: perModel.length
    },
    filterOptions,
    perKey,
    perModel,
    timeline
  };
}
