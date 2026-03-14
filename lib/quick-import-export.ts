
import type { UpstreamModelConfig } from "@/lib/key-config";

// Serializable snapshot of an upstream model pool (no internal IDs, API keys, etc.)
export type QuickExportPayload = {
  version: 1;
  exportedAt: string;
  models: Array<{
    name: string;
    aliasModel: string | null;
    model: string;
    contextWindow: number | null;
    upstreamWireApi: string;
    glmCodexThinkingThreshold: string;
    supportsVision: boolean;
    visionChannelId: number | null;
    visionModel: string | null;
    enabled: boolean;
  }>;
};

export function quickExportModels(models: UpstreamModelConfig[]): string {
  const payload: QuickExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    models: models.map((m) => ({
      name: m.name,
      aliasModel: m.aliasModel,
      model: m.model,
      contextWindow: m.contextWindow,
      upstreamWireApi: m.upstreamWireApi,
      glmCodexThinkingThreshold: m.glmCodexThinkingThreshold,
      supportsVision: m.supportsVision,
      visionChannelId: m.visionChannelId,
      visionModel: m.visionModel,
      enabled: m.enabled
    }))
  };
  return JSON.stringify(payload, null, 2);
}

export function quickImportModels(
  json: string
): { ok: true; models: Array<Omit<UpstreamModelConfig, "id">>; note: string } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Invalid payload: expected a JSON object." };
  }

  const obj = parsed as Record<string, unknown>;

  // Support bare array (version 0 / manual paste) as well
  let items: unknown[];
  if (Array.isArray(obj.models)) {
    items = obj.models;
  } else if (Array.isArray(obj)) {
    items = obj;
  } else {
    return { ok: false, error: "Invalid payload: expected { models: [...] } or [...]." };
  }

  if (!items.length) {
    return { ok: false, error: "Model list is empty." };
  }

  if (items.length > 128) {
    return { ok: false, error: "Too many models (max 128)." };
  }

  const VALID_THRESHOLDS = new Set(["off", "low", "medium", "high"]);
  const models: Array<Omit<UpstreamModelConfig, "id">> = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const m = entry as Record<string, unknown>;
    const model = typeof m.model === "string" ? m.model.trim() : "";
    if (!model) {
      continue;
    }
    const rawThreshold = String(m.glmCodexThinkingThreshold ?? "low");
    const threshold = VALID_THRESHOLDS.has(rawThreshold) ? rawThreshold : "low";
    models.push({
      name: typeof m.name === "string" ? m.name.trim() : model,
      aliasModel: typeof m.aliasModel === "string" ? (m.aliasModel.trim() || null) : null,
      model,
      contextWindow: typeof m.contextWindow === "number" && m.contextWindow > 0 ? m.contextWindow : null,
      upstreamWireApi: m.upstreamWireApi === "chat_completions" || m.upstreamWireApi === "anthropic_messages" ? m.upstreamWireApi : "responses",
      glmCodexThinkingThreshold: threshold as "off" | "low" | "medium" | "high",
      supportsVision: m.supportsVision !== false,
      visionChannelId: typeof m.visionChannelId === "number" && m.visionChannelId > 0 ? m.visionChannelId : null,
      visionModel: typeof m.visionModel === "string" ? (m.visionModel.trim() || null) : null,
      enabled: m.enabled !== false
    });
  }

  if (!models.length) {
    return { ok: false, error: "No valid model entries found in payload." };
  }

  const exportedAt = typeof obj.exportedAt === "string" ? obj.exportedAt.trim() : "";
  const note = exportedAt
    ? `Imported ${models.length} model(s) from snapshot exported at ${exportedAt}.`
    : `Imported ${models.length} model(s) from pasted JSON.`;

  return { ok: true, models, note };
}
