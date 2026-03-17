import type { KeyModelMapping, UpstreamModelConfig } from "@/lib/key-config";
import type { CompatPromptRule } from "@/lib/compat-config";
import { parseOverflowModelSelection } from "@/lib/overflow-model";

export const MAX_UPSTREAM_MODELS = 64;
export const MAX_KEY_MODEL_MAPPINGS = 128;
export const MAX_COMPAT_PROMPT_RULES = 128;
const MAX_RULE_ID_LENGTH = 120;
const MAX_RULE_PATTERN_LENGTH = 200;
const MAX_RULE_HINT_LENGTH = 20_000;

export type BulkImportIssue = {
  level: "warn" | "error";
  message: string;
};

export type BulkImportPreview<T extends { enabled?: boolean }> = {
  state: "idle" | "error" | "ready";
  items: T[];
  enabledCount: number;
  appendTotal: number;
  replaceTotal: number;
  warnCount: number;
  errorCount: number;
  issues: BulkImportIssue[];
  errorMessage: string;
};

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

export type QuickExportKeyMappingPayload = {
  version: 1;
  exportedAt: string;
  mappings: Array<{
    clientModel: string;
    targetModel: string;
    upstreamChannelId: number | null;
    upstreamChannelName: string | null;
    thinkingType: "enabled" | "disabled" | "auto" | null;
    enabled: boolean;
    dynamicModelSwitch: boolean;
    contextSwitchThreshold: number;
    contextOverflowModel: string | null;
    contextOverflowChannelId: number | null;
    contextOverflowChannelName: string | null;
  }>;
};

export type QuickExportPromptRulePayload = {
  version: 1;
  exportedAt: string;
  modelPromptRules: Array<{
    id: string;
    enabled: boolean;
    provider: string;
    upstreamModelPattern: string;
    hint: string;
  }>;
};

export type QuickImportedKeyMapping = {
  clientModel: string;
  targetModel: string;
  upstreamChannelId: number | null;
  upstreamChannelName: string | null;
  thinkingType: "enabled" | "disabled" | "auto" | null;
  enabled: boolean;
  dynamicModelSwitch: boolean;
  contextSwitchThreshold: number;
  contextOverflowModel: string | null;
  contextOverflowChannelId: number | null;
  contextOverflowChannelName: string | null;
};

export type QuickImportedPromptRule = CompatPromptRule;

export type QuickCompatPromptRule = {
  id: string;
  enabled: boolean;
  provider: string;
  upstreamModelPattern: string;
  hint: string;
};

export type QuickExportCompatPromptRulePayload = {
  version: 1;
  exportedAt: string;
  modelPromptRules: QuickCompatPromptRule[];
};

function normalizePositiveInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength);
}

function parseJsonPayload(json: string) {
  try {
    return { ok: true as const, value: JSON.parse(json) as unknown };
  } catch {
    return { ok: false as const, error: "Invalid JSON." };
  }
}

function readExportedAt(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const exportedAt = (value as Record<string, unknown>).exportedAt;
  return typeof exportedAt === "string" ? exportedAt.trim() : "";
}

function extractNamedArrayPayload(
  value: unknown,
  field: string
): { items: unknown[]; exportedAt: string } | { error: string } {
  if (Array.isArray(value)) {
    return { items: value, exportedAt: "" };
  }
  if (!value || typeof value !== "object") {
    return { error: "Invalid payload: expected a JSON object." };
  }

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj[field])) {
    return { items: obj[field], exportedAt: readExportedAt(obj) };
  }

  return { error: `Invalid payload: expected { ${field}: [...] } or [...].` };
}

function extractPromptRulePayload(
  value: unknown
): { items: unknown[]; exportedAt: string } | { error: string } {
  if (Array.isArray(value)) {
    return { items: value, exportedAt: "" };
  }
  if (!value || typeof value !== "object") {
    return { error: "Invalid payload: expected a JSON object." };
  }

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.modelPromptRules)) {
    return { items: obj.modelPromptRules, exportedAt: readExportedAt(obj) };
  }
  const nested = obj.compatPromptConfig;
  if (
    nested &&
    typeof nested === "object" &&
    Array.isArray((nested as Record<string, unknown>).modelPromptRules)
  ) {
    return {
      items: (nested as Record<string, unknown>).modelPromptRules as unknown[],
      exportedAt: readExportedAt(obj)
    };
  }

  return {
    error:
      "Invalid payload: expected [...], { modelPromptRules: [...] }, or { compatPromptConfig: { modelPromptRules: [...] } }."
  };
}

function buildImportedNote(itemLabel: string, itemCount: number, exportedAt: string) {
  return exportedAt
    ? `Imported ${itemCount} ${itemLabel} from snapshot exported at ${exportedAt}.`
    : `Imported ${itemCount} ${itemLabel} from pasted JSON.`;
}

export function buildBulkImportPreview<T extends { enabled?: boolean }>(input: {
  raw: string;
  currentCount: number;
  parse: (raw: string) => T[];
  inspect?: (items: T[]) => BulkImportIssue[];
}): BulkImportPreview<T> {
  const trimmed = input.raw.trim();
  if (!trimmed) {
    return {
      state: "idle",
      items: [],
      enabledCount: 0,
      appendTotal: input.currentCount,
      replaceTotal: 0,
      warnCount: 0,
      errorCount: 0,
      issues: [],
      errorMessage: ""
    };
  }

  try {
    const items = input.parse(trimmed);
    const issues = input.inspect?.(items) ?? [];
    return {
      state: "ready",
      items,
      enabledCount: items.filter((item) => item.enabled !== false).length,
      appendTotal: input.currentCount + items.length,
      replaceTotal: items.length,
      warnCount: issues.filter((item) => item.level === "warn").length,
      errorCount: issues.filter((item) => item.level === "error").length,
      issues,
      errorMessage: ""
    };
  } catch (err) {
    return {
      state: "error",
      items: [],
      enabledCount: 0,
      appendTotal: input.currentCount,
      replaceTotal: 0,
      warnCount: 0,
      errorCount: 0,
      issues: [],
      errorMessage: err instanceof Error ? err.message : "Invalid JSON."
    };
  }
}

function extractCompatPromptRulesPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const source = payload as {
    modelPromptRules?: unknown;
    compatPromptConfig?: {
      modelPromptRules?: unknown;
    };
  };

  if (Array.isArray(source.modelPromptRules)) {
    return source.modelPromptRules;
  }
  if (source.compatPromptConfig && Array.isArray(source.compatPromptConfig.modelPromptRules)) {
    return source.compatPromptConfig.modelPromptRules;
  }
  return null;
}

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

export function quickExportKeyMappings(
  mappings: KeyModelMapping[],
  resolveChannelName?: (channelId: number) => string | null
): string {
  const payload: QuickExportKeyMappingPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    mappings: mappings.map((mapping) => {
      const overflowSelection = parseOverflowModelSelection(mapping.contextOverflowModel);
      const upstreamChannelName =
        typeof mapping.upstreamChannelId === "number"
          ? resolveChannelName?.(mapping.upstreamChannelId) ?? null
          : null;
      const overflowChannelId = overflowSelection?.upstreamChannelId ?? null;
      return {
        clientModel: mapping.clientModel,
        targetModel: mapping.targetModel,
        upstreamChannelId: mapping.upstreamChannelId ?? null,
        upstreamChannelName,
        thinkingType: mapping.thinkingType ?? null,
        enabled: mapping.enabled,
        dynamicModelSwitch: mapping.dynamicModelSwitch,
        contextSwitchThreshold: mapping.contextSwitchThreshold,
        contextOverflowModel: overflowSelection?.model ?? null,
        contextOverflowChannelId: overflowChannelId,
        contextOverflowChannelName:
          typeof overflowChannelId === "number"
            ? resolveChannelName?.(overflowChannelId) ?? null
            : null
      };
    })
  };
  return JSON.stringify(payload, null, 2);
}

export function quickExportPromptRules(rules: CompatPromptRule[]): string {
  const payload: QuickExportPromptRulePayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    modelPromptRules: rules.map((rule) => ({
      id: rule.id,
      enabled: rule.enabled,
      provider: rule.provider,
      upstreamModelPattern: rule.upstreamModelPattern,
      hint: rule.hint
    }))
  };
  return JSON.stringify(payload, null, 2);
}

export function quickExportCompatPromptRules(
  rules: QuickCompatPromptRule[],
  format: "array" | "wrapped" = "wrapped"
): string {
  const normalized = rules.map((rule) => ({
    id: rule.id,
    enabled: rule.enabled,
    provider: rule.provider,
    upstreamModelPattern: rule.upstreamModelPattern,
    hint: rule.hint
  }));

  if (format === "array") {
    return JSON.stringify(normalized, null, 2);
  }

  const payload: QuickExportCompatPromptRulePayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    modelPromptRules: normalized
  };
  return JSON.stringify(payload, null, 2);
}

export function quickImportModels(
  json: string
): { ok: true; models: Array<Omit<UpstreamModelConfig, "id">>; note: string } | { ok: false; error: string } {
  const parsed = parseJsonPayload(json);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const extracted = extractNamedArrayPayload(parsed.value, "models");
  if ("error" in extracted) {
    return { ok: false, error: extracted.error };
  }
  const { items, exportedAt } = extracted;

  if (!items.length) {
    return { ok: false, error: "Model list is empty." };
  }

  if (items.length > MAX_UPSTREAM_MODELS) {
    return { ok: false, error: `Too many models (max ${MAX_UPSTREAM_MODELS}).` };
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

  return { ok: true, models, note: buildImportedNote("model(s)", models.length, exportedAt) };
}

export function quickImportKeyMappings(
  json: string
): { ok: true; mappings: QuickImportedKeyMapping[]; note: string } | { ok: false; error: string } {
  const parsed = parseJsonPayload(json);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const extracted = extractNamedArrayPayload(parsed.value, "mappings");
  if ("error" in extracted) {
    return { ok: false, error: extracted.error };
  }
  const { items, exportedAt } = extracted;

  if (!items.length) {
    return { ok: false, error: "Mapping list is empty." };
  }

  if (items.length > MAX_KEY_MODEL_MAPPINGS) {
    return {
      ok: false,
      error: `Too many mappings (max ${MAX_KEY_MODEL_MAPPINGS}).`
    };
  }

  const VALID_THINKING_TYPES = new Set(["enabled", "disabled", "auto"]);
  const mappings: QuickImportedKeyMapping[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const clientModel = typeof item.clientModel === "string" ? item.clientModel.trim() : "";
    const targetModel = typeof item.targetModel === "string" ? item.targetModel.trim() : "";
    if (!clientModel || !targetModel) {
      continue;
    }

    const parsedOverflow = parseOverflowModelSelection(
      typeof item.contextOverflowModel === "string" ? item.contextOverflowModel : null
    );
    const contextSwitchThreshold =
      typeof item.contextSwitchThreshold === "number" &&
      Number.isInteger(item.contextSwitchThreshold) &&
      item.contextSwitchThreshold >= 256 &&
      item.contextSwitchThreshold <= 2_000_000
        ? item.contextSwitchThreshold
        : 128000;
    const rawThinkingType = normalizeOptionalString(item.thinkingType);
    mappings.push({
      clientModel,
      targetModel,
      upstreamChannelId: normalizePositiveInteger(item.upstreamChannelId),
      upstreamChannelName: normalizeOptionalString(item.upstreamChannelName),
      thinkingType:
        rawThinkingType && VALID_THINKING_TYPES.has(rawThinkingType)
          ? (rawThinkingType as "enabled" | "disabled" | "auto")
          : null,
      enabled: item.enabled !== false,
      dynamicModelSwitch: item.dynamicModelSwitch === true,
      contextSwitchThreshold,
      contextOverflowModel: parsedOverflow?.model ?? null,
      contextOverflowChannelId:
        normalizePositiveInteger(item.contextOverflowChannelId) ??
        parsedOverflow?.upstreamChannelId ??
        null,
      contextOverflowChannelName: normalizeOptionalString(item.contextOverflowChannelName)
    });
  }

  if (!mappings.length) {
    return { ok: false, error: "No valid mapping entries found in payload." };
  }

  return {
    ok: true,
    mappings,
    note: buildImportedNote("mapping(s)", mappings.length, exportedAt)
  };
}

export function quickImportPromptRules(
  json: string
): { ok: true; rules: QuickImportedPromptRule[]; note: string } | { ok: false; error: string } {
  const parsed = parseJsonPayload(json);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const extracted = extractPromptRulePayload(parsed.value);
  if ("error" in extracted) {
    return { ok: false, error: extracted.error };
  }
  const { items, exportedAt } = extracted;

  if (!items.length) {
    return { ok: false, error: "Rule list is empty." };
  }

  if (items.length > MAX_COMPAT_PROMPT_RULES) {
    return {
      ok: false,
      error: `Too many rules (max ${MAX_COMPAT_PROMPT_RULES}).`
    };
  }

  const rules: QuickImportedPromptRule[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const hint = normalizeTrimmedString(item.hint, MAX_RULE_HINT_LENGTH);
    if (!hint) {
      return {
        ok: false,
        error: `Rule #${index + 1} is missing hint.`
      };
    }
    rules.push({
      id:
        normalizeTrimmedString(item.id, MAX_RULE_ID_LENGTH) ||
        `rule-${index + 1}`,
      enabled: item.enabled !== false,
      provider: normalizeTrimmedString(item.provider, MAX_RULE_PATTERN_LENGTH),
      upstreamModelPattern: normalizeTrimmedString(
        item.upstreamModelPattern,
        MAX_RULE_PATTERN_LENGTH
      ),
      hint
    });
  }

  if (!rules.length) {
    return { ok: false, error: "No valid rule entries found in payload." };
  }

  return {
    ok: true,
    rules,
    note: buildImportedNote("rule(s)", rules.length, exportedAt)
  };
}

export function quickImportCompatPromptRules(
  json: string
): { ok: true; rules: QuickCompatPromptRule[]; note: string } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }

  const items = extractCompatPromptRulesPayload(parsed);
  if (!items) {
    return {
      ok: false,
      error:
        "Invalid payload: expected [...], { modelPromptRules: [...] }, or { compatPromptConfig: { modelPromptRules: [...] } }."
    };
  }

  if (!items.length) {
    return { ok: false, error: "Rule list is empty." };
  }

  if (items.length > MAX_COMPAT_PROMPT_RULES) {
    return {
      ok: false,
      error: `Too many rules (max ${MAX_COMPAT_PROMPT_RULES}).`
    };
  }

  const rules: QuickCompatPromptRule[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: `Rule #${index + 1} must be an object.` };
    }

    const item = entry as Record<string, unknown>;
    const hint = typeof item.hint === "string" ? item.hint.trim() : "";
    if (!hint) {
      return { ok: false, error: `Rule #${index + 1} is missing hint.` };
    }

    rules.push({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `rule-${index + 1}`,
      enabled: item.enabled !== false,
      provider: typeof item.provider === "string" ? item.provider.trim() : "",
      upstreamModelPattern:
        typeof item.upstreamModelPattern === "string"
          ? item.upstreamModelPattern.trim()
          : "",
      hint
    });
  }

  const sourceObject = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const exportedAt = sourceObject && typeof sourceObject.exportedAt === "string"
    ? sourceObject.exportedAt.trim()
    : "";
  const note = exportedAt
    ? `Imported ${rules.length} rule(s) from snapshot exported at ${exportedAt}.`
    : `Imported ${rules.length} rule(s) from pasted JSON.`;

  return { ok: true, rules, note };
}
