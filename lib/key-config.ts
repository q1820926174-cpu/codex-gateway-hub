import { z } from "zod";
import { defaultBaseUrlForProvider, PROVIDERS, sanitizeBaseUrl, type ProviderName } from "@/lib/providers";

export const UPSTREAM_WIRE_APIS = ["responses", "chat_completions", "anthropic_messages"] as const;
export type UpstreamWireApi = (typeof UPSTREAM_WIRE_APIS)[number];
export const GLM_CODEX_THINKING_THRESHOLDS = ["off", "low", "medium", "high"] as const;
export type GlmCodexThinkingThreshold = (typeof GLM_CODEX_THINKING_THRESHOLDS)[number];

export function normalizeUpstreamWireApiValue(value: string | null | undefined): UpstreamWireApi {
  if (value === "chat_completions") {
    return "chat_completions";
  }
  if (value === "anthropic_messages") {
    return "anthropic_messages";
  }
  return "responses";
}

export function normalizeGlmCodexThinkingThresholdValue(
  value: string | null | undefined
): GlmCodexThinkingThreshold {
  if (value === "off") {
    return "off";
  }
  if (value === "medium") {
    return "medium";
  }
  if (value === "high") {
    return "high";
  }
  return "low";
}

const MAX_UPSTREAM_MODELS = 64;
const MAX_KEY_MODEL_MAPPINGS = 128;
export const OPENAI_STYLE_LOCAL_KEY_REGEX = /^sk-(?:proj-)?[A-Za-z0-9_-]{20,}$/;
export const OPENAI_STYLE_LOCAL_KEY_MESSAGE =
  "localKey must follow OpenAI style, e.g. sk-... or sk-proj-...";

const upstreamModelSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(80),
    aliasModel: z.string().min(1).max(256).nullable().optional(),
    model: z.string().min(1).max(256),
    contextWindow: z.number().int().min(256).max(20_000_000).nullable().optional(),
    upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).default("responses"),
    glmCodexThinkingThreshold: z
      .enum(GLM_CODEX_THINKING_THRESHOLDS)
      .default("low")
      .optional(),
    supportsVision: z.boolean().default(true),
    visionChannelId: z.number().int().positive().nullable().optional(),
    visionModel: z.string().min(1).max(256).nullable().optional(),
    enabled: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (!value.supportsVision && !(value.visionModel && value.visionModel.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visionModel"],
        message: "visionModel is required when supportsVision is false."
      });
    }
  });

const keyModelMappingSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  clientModel: z.string().min(1).max(256),
  targetModel: z.string().min(1).max(256),
  enabled: z.boolean().default(true)
});

type ParsedUpstreamModel = z.infer<typeof upstreamModelSchema>;
type ParsedKeyModelMapping = z.infer<typeof keyModelMappingSchema>;
export type UpstreamModelConfig = {
  id: string;
  name: string;
  aliasModel: string | null;
  model: string;
  contextWindow: number | null;
  upstreamWireApi: UpstreamWireApi;
  glmCodexThinkingThreshold: GlmCodexThinkingThreshold;
  supportsVision: boolean;
  visionChannelId: number | null;
  visionModel: string | null;
  enabled: boolean;
};

export type KeyModelMapping = {
  id: string;
  clientModel: string;
  targetModel: string;
  enabled: boolean;
};

type UpstreamModelFallback = {
  model: string;
  upstreamWireApi: UpstreamWireApi;
  supportsVision: boolean;
  visionModel: string | null;
};

function createModelId() {
  return `mdl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createMappingId() {
  return `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function coerceRawModelArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function coerceRawMappingArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function fallbackModel(fallback: UpstreamModelFallback): UpstreamModelConfig {
  const normalizedVisionModel = fallback.visionModel?.trim() || null;
  const useSupportsVision = fallback.supportsVision || !normalizedVisionModel;
  return {
    id: createModelId(),
    name: "默认模型",
    aliasModel: null,
    model: fallback.model.trim(),
    contextWindow: null,
    upstreamWireApi: fallback.upstreamWireApi,
    glmCodexThinkingThreshold: "low",
    supportsVision: useSupportsVision,
    visionChannelId: null,
    visionModel: useSupportsVision ? null : normalizedVisionModel,
    enabled: true
  };
}

export function normalizeUpstreamModels(
  raw: unknown,
  fallback?: UpstreamModelFallback
): UpstreamModelConfig[] {
  const parsed: UpstreamModelConfig[] = [];
  for (const entry of coerceRawModelArray(raw)) {
    const modelResult = upstreamModelSchema.safeParse(entry);
    if (!modelResult.success) {
      continue;
    }
    const item = modelResult.data as ParsedUpstreamModel;
    parsed.push({
      id: item.id?.trim() || createModelId(),
      name: item.name.trim(),
      aliasModel: item.aliasModel?.trim() || null,
      model: item.model.trim(),
      contextWindow: typeof item.contextWindow === "number" ? item.contextWindow : null,
      upstreamWireApi: item.upstreamWireApi,
      glmCodexThinkingThreshold: normalizeGlmCodexThinkingThresholdValue(
        item.glmCodexThinkingThreshold
      ),
      supportsVision: item.supportsVision,
      visionChannelId: item.visionChannelId ?? null,
      visionModel: item.supportsVision ? null : item.visionModel?.trim() ?? null,
      enabled: item.enabled
    });
  }

  const resolved = parsed.length
    ? parsed
    : fallback && fallback.model.trim()
      ? [fallbackModel(fallback)]
      : [];

  const usedIds = new Set<string>();
  return resolved.slice(0, MAX_UPSTREAM_MODELS).map((item) => {
    let nextId = item.id.trim();
    while (!nextId || usedIds.has(nextId)) {
      nextId = createModelId();
    }
    usedIds.add(nextId);
    return {
      ...item,
      id: nextId
    };
  });
}

export function ensureModelExistsInPool(
  models: UpstreamModelConfig[],
  model: string,
  fallback: Omit<UpstreamModelFallback, "model">
): UpstreamModelConfig[] {
  const targetModel = model.trim();
  if (!targetModel) {
    return models;
  }
  if (models.some((item) => item.model === targetModel)) {
    return models;
  }

  if (models.length >= MAX_UPSTREAM_MODELS) {
    return models;
  }

  const normalizedVisionModel = fallback.visionModel?.trim() || null;
  const useSupportsVision = fallback.supportsVision || !normalizedVisionModel;
  return [
    ...models,
    {
      id: createModelId(),
      name: targetModel,
      aliasModel: null,
      model: targetModel,
      contextWindow: null,
      upstreamWireApi: fallback.upstreamWireApi,
      glmCodexThinkingThreshold: "low",
      supportsVision: useSupportsVision,
      visionChannelId: null,
      visionModel: useSupportsVision ? null : normalizedVisionModel,
      enabled: true
    }
  ];
}

export function pickModelFromPool(models: UpstreamModelConfig[], model: string | null | undefined) {
  const targetModel = model?.trim();
  if (!targetModel) {
    return null;
  }

  return (
    models.find((item) => item.model === targetModel && item.enabled) ??
    models.find((item) => item.model === targetModel) ??
    null
  );
}

export function serializeUpstreamModels(models: UpstreamModelConfig[]) {
  return JSON.stringify(models);
}

export function normalizeKeyModelMappings(raw: unknown): KeyModelMapping[] {
  const parsed: KeyModelMapping[] = [];
  for (const entry of coerceRawMappingArray(raw)) {
    const mappingResult = keyModelMappingSchema.safeParse(entry);
    if (!mappingResult.success) {
      continue;
    }
    const item = mappingResult.data as ParsedKeyModelMapping;
    const clientModel = item.clientModel.trim();
    const targetModel = item.targetModel.trim();
    if (!clientModel || !targetModel) {
      continue;
    }
    parsed.push({
      id: item.id?.trim() || createMappingId(),
      clientModel,
      targetModel,
      enabled: item.enabled
    });
  }

  const usedIds = new Set<string>();
  return parsed.slice(0, MAX_KEY_MODEL_MAPPINGS).map((item) => {
    let nextId = item.id.trim();
    while (!nextId || usedIds.has(nextId)) {
      nextId = createMappingId();
    }
    usedIds.add(nextId);
    return {
      ...item,
      id: nextId
    };
  });
}

export function serializeKeyModelMappings(mappings: KeyModelMapping[]) {
  return JSON.stringify(mappings);
}

export function mapModelByKeyMappings(model: string, mappings: KeyModelMapping[]) {
  const requested = model.trim();
  if (!requested) {
    return requested;
  }
  const requestedLower = requested.toLowerCase();

  const matched =
    mappings.find((item) => item.clientModel.trim().toLowerCase() === requestedLower && item.enabled) ??
    mappings.find((item) => item.clientModel.trim().toLowerCase() === requestedLower) ??
    null;
  return matched?.targetModel ?? requested;
}

export const createGatewayKeySchema = z.object({
  name: z.string().min(1).max(80),
  localKey: z
    .string()
    .min(24)
    .max(256)
    .regex(OPENAI_STYLE_LOCAL_KEY_REGEX, OPENAI_STYLE_LOCAL_KEY_MESSAGE),
  provider: z.enum(PROVIDERS).default("openai"),
  upstreamChannelId: z.number().int().positive().optional(),
  upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).default("responses"),
  upstreamBaseUrl: z.string().url().optional(),
  upstreamApiKey: z.string().max(4096).optional(),
  defaultModel: z.string().min(1).max(256).default("gpt-4.1-mini"),
  supportsVision: z.boolean().default(true),
  visionModel: z.string().min(1).max(256).optional(),
  upstreamModels: z.array(upstreamModelSchema).min(1).max(MAX_UPSTREAM_MODELS).optional(),
  dynamicModelSwitch: z.boolean().default(false),
  contextSwitchThreshold: z.number().int().min(256).max(2_000_000).default(12000),
  contextOverflowModel: z.string().min(1).max(256).optional(),
  activeModelOverride: z.string().min(1).max(256).optional(),
  modelMappings: z.array(keyModelMappingSchema).max(MAX_KEY_MODEL_MAPPINGS).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  enabled: z.boolean().default(true)
}).superRefine((value, ctx) => {
  if (!value.supportsVision && !(value.visionModel && value.visionModel.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visionModel"],
      message: "visionModel is required when supportsVision is false."
    });
  }
  if (value.dynamicModelSwitch && !(value.contextOverflowModel && value.contextOverflowModel.trim())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contextOverflowModel"],
      message: "contextOverflowModel is required when dynamicModelSwitch is true."
    });
  }
});

export const updateGatewayKeySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  localKey: z
    .string()
    .min(24)
    .max(256)
    .regex(OPENAI_STYLE_LOCAL_KEY_REGEX, OPENAI_STYLE_LOCAL_KEY_MESSAGE)
    .optional(),
  provider: z.enum(PROVIDERS).optional(),
  upstreamChannelId: z.number().int().positive().nullable().optional(),
  upstreamWireApi: z.enum(UPSTREAM_WIRE_APIS).optional(),
  upstreamBaseUrl: z.string().url().optional(),
  upstreamApiKey: z.string().max(4096).optional(),
  clearUpstreamApiKey: z.boolean().optional(),
  defaultModel: z.string().min(1).max(256).optional(),
  supportsVision: z.boolean().optional(),
  visionModel: z.string().min(1).max(256).optional(),
  clearVisionModel: z.boolean().optional(),
  upstreamModels: z.array(upstreamModelSchema).min(1).max(MAX_UPSTREAM_MODELS).optional(),
  dynamicModelSwitch: z.boolean().optional(),
  contextSwitchThreshold: z.number().int().min(256).max(2_000_000).optional(),
  contextOverflowModel: z.string().min(1).max(256).optional(),
  clearContextOverflowModel: z.boolean().optional(),
  activeModelOverride: z.string().min(1).max(256).optional(),
  clearActiveModelOverride: z.boolean().optional(),
  modelMappings: z.array(keyModelMappingSchema).max(MAX_KEY_MODEL_MAPPINGS).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  enabled: z.boolean().optional()
});

export function resolveUpstreamBaseUrl(provider: ProviderName, upstreamBaseUrl?: string) {
  if (upstreamBaseUrl && upstreamBaseUrl.trim()) {
    return sanitizeBaseUrl(upstreamBaseUrl);
  }

  const preset = defaultBaseUrlForProvider(provider);
  if (preset) {
    return sanitizeBaseUrl(preset);
  }

  throw new Error("Custom provider requires upstreamBaseUrl.");
}

export function gatewayKeyDto<
  T extends {
    id: number;
    name: string;
    localKey: string;
    upstreamChannelId?: number | null;
    upstreamChannel?: {
      id: number;
      name: string;
      provider?: string;
      upstreamWireApi?: string;
      upstreamBaseUrl?: string;
      upstreamApiKey: string | null;
      upstreamModelsJson?: string | null;
      defaultModel?: string;
      supportsVision?: boolean;
      visionModel?: string | null;
      timeoutMs?: number;
    } | null;
    provider: string;
    wireApi: string;
    upstreamWireApi: string;
    upstreamBaseUrl: string;
    upstreamApiKey: string | null;
    upstreamModelsJson?: string | null;
    modelMappingsJson?: string | null;
    defaultModel: string;
    supportsVision: boolean;
    visionModel: string | null;
    dynamicModelSwitch: boolean;
    contextSwitchThreshold: number;
    contextOverflowModel: string | null;
    activeModelOverride: string | null;
    timeoutMs: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }
>(key: T) {
  const effectiveProvider = key.upstreamChannel?.provider ?? key.provider;
  const effectiveUpstreamWireApi = normalizeUpstreamWireApiValue(
    key.upstreamChannel?.upstreamWireApi ?? key.upstreamWireApi
  );
  const effectiveDefaultModel = key.upstreamChannel?.defaultModel ?? key.defaultModel;
  const effectiveSupportsVision = key.upstreamChannel?.supportsVision ?? key.supportsVision;
  const effectiveVisionModel = key.upstreamChannel?.visionModel ?? key.visionModel;
  const upstreamModels = normalizeUpstreamModels(
    key.upstreamChannel?.upstreamModelsJson ?? key.upstreamModelsJson,
    {
      model: effectiveDefaultModel,
      upstreamWireApi: effectiveUpstreamWireApi,
      supportsVision: effectiveSupportsVision,
      visionModel: effectiveVisionModel
    }
  );
  const defaultProfile =
    pickModelFromPool(upstreamModels, effectiveDefaultModel) ?? upstreamModels[0] ?? null;
  const resolvedSupportsVision = defaultProfile?.supportsVision ?? effectiveSupportsVision;
  const resolvedVisionModel = resolvedSupportsVision
    ? null
    : defaultProfile?.visionModel ?? effectiveVisionModel ?? null;

  const resolvedUpstreamWireApi = defaultProfile?.upstreamWireApi ?? effectiveUpstreamWireApi;
  const resolvedDefaultModel = defaultProfile?.model ?? effectiveDefaultModel;

  const modelMappings = normalizeKeyModelMappings(key.modelMappingsJson);

  return {
    id: key.id,
    name: key.name,
    localKey: key.localKey,
    upstreamChannelId: key.upstreamChannelId ?? null,
    upstreamChannelName: key.upstreamChannel?.name ?? null,
    provider: effectiveProvider,
    wireApi: key.wireApi,
    upstreamWireApi: resolvedUpstreamWireApi,
    upstreamBaseUrl: key.upstreamChannel?.upstreamBaseUrl ?? key.upstreamBaseUrl,
    hasUpstreamApiKey: Boolean(key.upstreamChannel?.upstreamApiKey ?? key.upstreamApiKey),
    upstreamModels,
    modelMappings,
    defaultModel: resolvedDefaultModel,
    supportsVision: resolvedSupportsVision,
    visionModel: resolvedVisionModel,
    dynamicModelSwitch: key.dynamicModelSwitch,
    contextSwitchThreshold: key.contextSwitchThreshold,
    contextOverflowModel: key.contextOverflowModel,
    activeModelOverride: key.activeModelOverride,
    timeoutMs: key.upstreamChannel?.timeoutMs ?? key.timeoutMs,
    enabled: key.enabled,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt
  };
}
