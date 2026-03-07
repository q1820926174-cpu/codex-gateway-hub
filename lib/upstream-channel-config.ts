import { z } from "zod";
import {
  ensureModelExistsInPool,
  normalizeUpstreamModels,
  pickModelFromPool,
  resolveUpstreamBaseUrl,
  serializeUpstreamModels,
  UPSTREAM_WIRE_APIS,
  normalizeUpstreamWireApiValue
} from "@/lib/key-config";
import { PROVIDERS } from "@/lib/providers";

export const createUpstreamChannelSchema = z.object({
  name: z.string().min(1).max(120),
  provider: z.enum(PROVIDERS).default("openai"),
  upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).default("responses"),
  upstreamBaseUrl: z.string().url().optional(),
  upstreamApiKey: z.string().max(4096).optional(),
  upstreamModels: z.array(
    z.object({
      id: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(80),
      aliasModel: z.string().min(1).max(256).nullable().optional(),
      model: z.string().min(1).max(256),
      upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).default("responses"),
      supportsVision: z.boolean().default(true),
      visionChannelId: z.number().int().positive().nullable().optional(),
      visionModel: z.string().min(1).max(256).nullable().optional(),
      enabled: z.boolean().default(true)
    })
  ).min(1).max(64).optional(),
  defaultModel: z.string().min(1).max(256).default("gpt-4.1-mini"),
  supportsVision: z.boolean().default(true),
  visionModel: z.string().min(1).max(256).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  enabled: z.boolean().default(true)
});

export const updateUpstreamChannelSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  provider: z.enum(PROVIDERS).optional(),
  upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).optional(),
  upstreamBaseUrl: z.string().url().optional(),
  upstreamApiKey: z.string().max(4096).optional(),
  clearUpstreamApiKey: z.boolean().optional(),
  upstreamModels: z.array(
    z.object({
      id: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(80),
      aliasModel: z.string().min(1).max(256).nullable().optional(),
      model: z.string().min(1).max(256),
      upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).default("responses"),
      supportsVision: z.boolean().default(true),
      visionChannelId: z.number().int().positive().nullable().optional(),
      visionModel: z.string().min(1).max(256).nullable().optional(),
      enabled: z.boolean().default(true)
    })
  ).min(1).max(64).optional(),
  defaultModel: z.string().min(1).max(256).optional(),
  supportsVision: z.boolean().optional(),
  visionModel: z.string().min(1).max(256).optional(),
  clearVisionModel: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  enabled: z.boolean().optional()
});

export function normalizeChannelPayload(payload: {
  provider: (typeof PROVIDERS)[number];
  upstreamWireApi: (typeof UPSTREAM_WIRE_APIS)[number];
  upstreamBaseUrl?: string;
  defaultModel: string;
  supportsVision: boolean;
  visionModel?: string | null;
  upstreamModels?: unknown;
}) {
  const upstreamBaseUrl = resolveUpstreamBaseUrl(payload.provider, payload.upstreamBaseUrl);
  const defaultModel = payload.defaultModel.trim();
  const normalizedPool = normalizeUpstreamModels(payload.upstreamModels, {
    model: defaultModel,
    upstreamWireApi: payload.upstreamWireApi,
    supportsVision: payload.supportsVision,
    visionModel: payload.visionModel?.trim() || null
  });
  const upstreamModels = ensureModelExistsInPool(normalizedPool, defaultModel, {
    upstreamWireApi: payload.upstreamWireApi,
    supportsVision: payload.supportsVision,
    visionModel: payload.visionModel?.trim() || null
  });
  const defaultProfile =
    pickModelFromPool(upstreamModels, defaultModel) ?? upstreamModels[0] ?? null;
  if (!defaultProfile) {
    throw new Error("At least one upstream model is required.");
  }

  return {
    upstreamBaseUrl,
    upstreamModelsJson: serializeUpstreamModels(upstreamModels),
    upstreamWireApi: defaultProfile.upstreamWireApi,
    defaultModel: defaultProfile.model,
    supportsVision: defaultProfile.supportsVision,
    visionModel: defaultProfile.supportsVision ? null : defaultProfile.visionModel ?? null,
    upstreamModels
  };
}

export function upstreamChannelDto<
  T extends {
    id: number;
    name: string;
    provider: string;
    upstreamWireApi: string;
    upstreamBaseUrl: string;
    upstreamApiKey: string | null;
    upstreamModelsJson?: string | null;
    defaultModel: string;
    supportsVision: boolean;
    visionModel: string | null;
    timeoutMs: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: {
      keys?: number;
    };
  }
>(channel: T) {
  const upstreamModels = normalizeUpstreamModels(channel.upstreamModelsJson, {
    model: channel.defaultModel,
    upstreamWireApi: normalizeUpstreamWireApiValue(channel.upstreamWireApi),
    supportsVision: channel.supportsVision,
    visionModel: channel.visionModel
  });

  return {
    id: channel.id,
    name: channel.name,
    provider: channel.provider,
    upstreamWireApi: channel.upstreamWireApi,
    upstreamBaseUrl: channel.upstreamBaseUrl,
    hasUpstreamApiKey: Boolean(channel.upstreamApiKey),
    upstreamModels,
    defaultModel: channel.defaultModel,
    supportsVision: channel.supportsVision,
    visionModel: channel.visionModel,
    timeoutMs: channel.timeoutMs,
    enabled: channel.enabled,
    keyCount: channel._count?.keys ?? 0,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}
