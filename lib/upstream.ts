import { prisma } from "@/lib/prisma";
import { sanitizeBaseUrl } from "@/lib/providers";
import {
  normalizeKeyModelMappings,
  normalizeUpstreamModels,
  pickModelFromPool,
  type KeyModelMapping,
  type UpstreamModelConfig,
  type UpstreamWireApi
} from "@/lib/key-config";

type KeyResolveFailure = {
  ok: false;
  status: number;
  body: {
    error: string;
  };
};

type KeyResolveSuccess = {
  ok: true;
  key: {
    id: number;
    name: string;
    localKey: string;
    provider: string;
    wireApi: string;
    upstreamWireApi: UpstreamWireApi;
    upstreamBaseUrl: string;
    upstreamApiKey: string | null;
    upstreamModels: UpstreamModelConfig[];
    modelMappings: KeyModelMapping[];
    defaultModel: string;
    supportsVision: boolean;
    visionChannelId: number | null;
    visionModel: string | null;
    dynamicModelSwitch: boolean;
    contextSwitchThreshold: number;
    contextOverflowModel: string | null;
    activeModelOverride: string | null;
    timeoutMs: number;
    enabled: boolean;
  };
};

export type ResolvedGatewayKey = KeyResolveSuccess["key"];

function buildUpstreamEndpoint(baseUrl: string, resourcePath: "responses" | "chat/completions" | "completions") {
  const normalized = sanitizeBaseUrl(baseUrl);
  if (/\/v\d+(?:\.\d+)?$/i.test(normalized)) {
    return `${normalized}/${resourcePath}`;
  }
  return `${normalized}/v1/${resourcePath}`;
}

function normalizeUpstreamWireApi(value: string): UpstreamWireApi {
  return value === "chat_completions" ? "chat_completions" : "responses";
}

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorizationHeader.slice("bearer ".length).trim() || null;
}

type GatewayKeyCacheEntry = {
  key: ResolvedGatewayKey;
  expiresAt: number;
};

function parsePositiveIntEnv(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const GATEWAY_KEY_CACHE_TTL_MS = parsePositiveIntEnv(
  process.env.GATEWAY_KEY_CACHE_TTL_MS,
  1500,
  0,
  60_000
);
const GATEWAY_KEY_CACHE_MAX = parsePositiveIntEnv(
  process.env.GATEWAY_KEY_CACHE_MAX,
  2048,
  0,
  20_000
);
const gatewayKeyCache = new Map<string, GatewayKeyCacheEntry>();

function isGatewayKeyCacheEnabled() {
  return GATEWAY_KEY_CACHE_TTL_MS > 0 && GATEWAY_KEY_CACHE_MAX > 0;
}

function trimGatewayKeyCache(now: number) {
  if (!isGatewayKeyCacheEnabled()) {
    gatewayKeyCache.clear();
    return;
  }

  for (const [localKey, entry] of gatewayKeyCache.entries()) {
    if (entry.expiresAt <= now) {
      gatewayKeyCache.delete(localKey);
    }
  }

  while (gatewayKeyCache.size > GATEWAY_KEY_CACHE_MAX) {
    const oldest = gatewayKeyCache.keys().next().value;
    if (!oldest) {
      break;
    }
    gatewayKeyCache.delete(oldest);
  }
}

function readGatewayKeyCache(localKey: string): ResolvedGatewayKey | null {
  if (!isGatewayKeyCacheEnabled()) {
    return null;
  }

  const now = Date.now();
  const cached = gatewayKeyCache.get(localKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    gatewayKeyCache.delete(localKey);
    return null;
  }

  // Refresh insertion order to mimic LRU behavior.
  gatewayKeyCache.delete(localKey);
  gatewayKeyCache.set(localKey, cached);
  return cached.key;
}

function writeGatewayKeyCache(localKey: string, key: ResolvedGatewayKey) {
  if (!isGatewayKeyCacheEnabled()) {
    return;
  }
  const now = Date.now();
  trimGatewayKeyCache(now);
  gatewayKeyCache.set(localKey, {
    key,
    expiresAt: now + GATEWAY_KEY_CACHE_TTL_MS
  });
  trimGatewayKeyCache(now);
}

export function clearGatewayKeyCache(localKey?: string | null) {
  if (!localKey) {
    gatewayKeyCache.clear();
    return;
  }
  const normalized = localKey.trim();
  if (!normalized) {
    return;
  }
  gatewayKeyCache.delete(normalized);
}

export async function resolveGatewayKey(
  authorizationHeader: string | null
): Promise<KeyResolveFailure | KeyResolveSuccess> {
  const localKey = parseBearerToken(authorizationHeader);
  if (!localKey) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Missing local key. Use Authorization: Bearer <local_key>."
      }
    };
  }

  const cachedKey = readGatewayKeyCache(localKey);
  if (cachedKey) {
    return {
      ok: true,
      key: cachedKey
    };
  }

  const key = await prisma.providerKey.findUnique({
    where: { localKey },
    include: {
      upstreamChannel: true
    }
  });

  if (!key || !key.enabled) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Invalid local key or key disabled."
      }
    };
  }

  if (key.upstreamChannelId && (!key.upstreamChannel || !key.upstreamChannel.enabled)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Bound upstream channel is missing or disabled."
      }
    };
  }

  const effectiveApiKey =
    key.upstreamChannel?.upstreamApiKey?.trim() || key.upstreamApiKey?.trim() || null;

  if (!effectiveApiKey) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "This local key has no upstream API key configured."
      }
    };
  }

  const effectiveProvider = key.upstreamChannel?.provider ?? key.provider;
  const effectiveUpstreamWireApi = normalizeUpstreamWireApi(
    key.upstreamChannel?.upstreamWireApi ?? key.upstreamWireApi
  );
  const effectiveDefaultModel = key.upstreamChannel?.defaultModel ?? key.defaultModel;
  const upstreamModels = normalizeUpstreamModels(
    key.upstreamChannel?.upstreamModelsJson ?? key.upstreamModelsJson,
    {
      model: effectiveDefaultModel,
      upstreamWireApi: effectiveUpstreamWireApi,
      supportsVision: key.upstreamChannel?.supportsVision ?? key.supportsVision,
      visionModel: key.upstreamChannel?.visionModel ?? key.visionModel
    }
  );
  const defaultProfile =
    pickModelFromPool(upstreamModels, effectiveDefaultModel) ??
    upstreamModels[0] ??
    null;
  const effectiveSupportsVision =
    defaultProfile?.supportsVision ??
    (key.upstreamChannel?.supportsVision ?? key.supportsVision);
  const effectiveVisionChannelId = effectiveSupportsVision
    ? null
    : defaultProfile?.visionChannelId ?? null;
  const effectiveVisionModel = effectiveSupportsVision
    ? null
    : defaultProfile?.visionModel ??
      key.upstreamChannel?.visionModel ??
      key.visionModel ??
      null;

  const resolvedKey: ResolvedGatewayKey = {
    ...key,
    provider: effectiveProvider,
    upstreamWireApi: effectiveUpstreamWireApi,
    upstreamBaseUrl: key.upstreamChannel?.upstreamBaseUrl ?? key.upstreamBaseUrl,
    upstreamApiKey: effectiveApiKey,
    upstreamModels,
    modelMappings: normalizeKeyModelMappings(key.modelMappingsJson),
    defaultModel: effectiveDefaultModel,
    supportsVision: effectiveSupportsVision,
    visionChannelId: effectiveVisionChannelId,
    visionModel: effectiveVisionModel,
    timeoutMs: key.upstreamChannel?.timeoutMs ?? key.timeoutMs
  };
  writeGatewayKeyCache(localKey, resolvedKey);

  return {
    ok: true,
    key: resolvedKey
  };
}

export async function callResponsesApi(payload: unknown, key: ResolvedGatewayKey) {
  const response = await fetch(buildUpstreamEndpoint(key.upstreamBaseUrl, "responses"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key.upstreamApiKey!.trim()}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(key.timeoutMs)
  });

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      body: {
        error: "Upstream responses API error",
        status: response.status,
        upstreamBody: await response.text()
      }
    };
  }

  return {
    ok: true as const,
    status: 200,
    body: await response.json()
  };
}

function buildStreamProxyHeaders(upstreamResponse: Response) {
  const headers = new Headers(upstreamResponse.headers);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/event-stream; charset=utf-8");
  }
  if (!headers.get("cache-control")) {
    headers.set("cache-control", "no-cache");
  }
  headers.delete("content-length");
  return headers;
}

async function callStreamEndpoint(
  resource: "responses" | "chat/completions" | "completions",
  payload: unknown,
  key: ResolvedGatewayKey
) {
  const upstreamResponse = await fetch(buildUpstreamEndpoint(key.upstreamBaseUrl, resource), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key.upstreamApiKey!.trim()}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(key.timeoutMs)
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: buildStreamProxyHeaders(upstreamResponse)
  });
}

export async function callResponsesApiStream(payload: unknown, key: ResolvedGatewayKey) {
  return callStreamEndpoint("responses", payload, key);
}

export async function callChatCompletionsApiStream(payload: unknown, key: ResolvedGatewayKey) {
  return callStreamEndpoint("chat/completions", payload, key);
}

export async function callCompletionsApiStream(payload: unknown, key: ResolvedGatewayKey) {
  return callStreamEndpoint("completions", payload, key);
}

async function callJsonEndpoint(path: string, payload: unknown, key: ResolvedGatewayKey) {
  const resource = path.replace(/^\/v1\//, "").replace(/^\//, "");
  const response = await fetch(
    buildUpstreamEndpoint(
      key.upstreamBaseUrl,
      resource === "chat/completions" ? "chat/completions" : "completions"
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.upstreamApiKey!.trim()}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(key.timeoutMs)
    }
  );

  const contentType = response.headers.get("content-type") ?? "";
  const parsedBody = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : { raw: await response.text() };

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      body: {
        error: "Upstream API error",
        status: response.status,
        upstreamBody: parsedBody
      }
    };
  }

  return {
    ok: true as const,
    status: 200,
    body: parsedBody
  };
}

export async function callChatCompletionsApi(payload: unknown, key: ResolvedGatewayKey) {
  return callJsonEndpoint("/v1/chat/completions", payload, key);
}

export async function callCompletionsApi(payload: unknown, key: ResolvedGatewayKey) {
  return callJsonEndpoint("/v1/completions", payload, key);
}
