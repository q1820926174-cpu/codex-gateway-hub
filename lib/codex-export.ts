export type CodexApplyPatchToolType = "function" | "freeform";

export function parseCodexApplyPatchToolType(
  value: string | null | undefined
): CodexApplyPatchToolType | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "function") {
    return "function";
  }
  if (normalized === "freeform") {
    return "freeform";
  }
  return null;
}

export type CodexExportModelProfile = {
  model: string;
  aliasModel: string | null;
  contextWindow: number | null;
  enabled: boolean;
};

export type CodexExportContextInput = {
  localKey: string;
  provider: string;
  providerName: string;
  gatewayEndpoint: string;
  preferredModel: string;
  modelPool: CodexExportModelProfile[];
  applyPatchToolType: CodexApplyPatchToolType;
};

export type CodexExportContext = CodexExportContextInput & {
  selectedModel: string;
  contextWindow: number | null;
  autoCompactTokenLimit: number | null;
};

export type CodexExportFile = {
  targetPath: string;
  content: string;
};

export type CodexExportBundle = {
  selectedModel: string;
  exportedModels: string[];
  applyPatchToolType: CodexApplyPatchToolType;
  files: {
    envSnippet: CodexExportFile;
    configTomlSnippet: CodexExportFile;
    modelCatalogJson: CodexExportFile;
    modelInstructionsMd: CodexExportFile;
    agentsMd: CodexExportFile;
  };
};

type ResolvedCatalogModel = {
  publicModel: string;
  upstreamModel: string;
  contextWindow: number | null;
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const CODEX_OUTPUT_DIR = "~/.codex/codex-gateway-hub";

function trimOrNull(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeGatewayEndpoint(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeModelCode(provider: string, model: string) {
  const trimmed = model.trim();
  if (provider === "glm") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function sanitizeKey(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "custom";
}

function sanitizeFileBase(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return normalized || "codex-gateway-hub";
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeContextWindow(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function inferContextWindowFromModel(model: string, provider: string) {
  const normalized = model.trim().toLowerCase().replace(/\[[^\]]+\]$/, "");
  if (!normalized) {
    return null;
  }

  if (provider === "glm") {
    if (
      normalized === "glm-5" ||
      normalized.startsWith("glm-5-") ||
      normalized.startsWith("glm-4.5")
    ) {
      return 128000;
    }
  }

  if (provider === "doubao") {
    if (normalized.includes("doubao-seed") || normalized.includes("seed-2.0-code")) {
      return 128000;
    }
  }

  if (normalized.startsWith("gpt-5")) {
    return 272000;
  }

  if (normalized.startsWith("claude-")) {
    return 200000;
  }

  return null;
}

function resolveAutoCompactTokenLimit(contextWindow: number | null) {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return Math.max(4096, Math.floor(contextWindow * 0.85));
}

function normalizeModelPool(
  modelPool: CodexExportModelProfile[],
  provider: string
) {
  return modelPool
    .map((item) => {
      const model = item.model.trim();
      if (!model) {
        return null;
      }
      return {
        model,
        aliasModel: trimOrNull(item.aliasModel),
        contextWindow: normalizeContextWindow(item.contextWindow),
        enabled: item.enabled
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      ...item,
      publicModel: item.aliasModel || normalizeModelCode(provider, item.model)
    }));
}

function resolveSelectedProfile(input: CodexExportContextInput) {
  const preferredModel = input.preferredModel.trim() || DEFAULT_MODEL;
  const normalizedPool = normalizeModelPool(input.modelPool, input.provider);
  return (
    normalizedPool.find(
      (item) => item.model === preferredModel || item.aliasModel === preferredModel
    ) ??
    normalizedPool.find((item) => item.enabled) ??
    normalizedPool[0] ?? {
      model: preferredModel,
      aliasModel: null,
      contextWindow: null,
      enabled: true,
      publicModel: normalizeModelCode(input.provider, preferredModel)
    }
  );
}

function resolveCatalogModels(context: CodexExportContext) {
  const normalizedPool = normalizeModelPool(context.modelPool, context.provider);
  const selectedProfile = resolveSelectedProfile(context);
  const visiblePool = normalizedPool.filter((item) => item.enabled);
  const source = visiblePool.length ? visiblePool : normalizedPool;
  const models: ResolvedCatalogModel[] = [];
  const seen = new Set<string>();

  const pushProfile = (profile: typeof selectedProfile) => {
    const publicModel = profile.publicModel.trim();
    if (!publicModel || seen.has(publicModel)) {
      return;
    }
    seen.add(publicModel);
    models.push({
      publicModel,
      upstreamModel: normalizeModelCode(context.provider, profile.model),
      contextWindow:
        profile.contextWindow ?? inferContextWindowFromModel(publicModel, context.provider)
    });
  };

  pushProfile(selectedProfile);
  for (const profile of source) {
    pushProfile(profile);
  }

  return models;
}

function buildConfigTomlSnippet(context: CodexExportContext) {
  const providerKey = sanitizeKey(context.providerName);
  const fileBase = sanitizeFileBase(`${context.providerName}_${context.selectedModel}`);
  const catalogPath = `${CODEX_OUTPUT_DIR}/${fileBase}.catalog.json`;
  const instructionsPath = `${CODEX_OUTPUT_DIR}/${fileBase}.instructions.md`;
  return [
    `model_provider = "${escapeTomlString(providerKey)}"`,
    `model = "${escapeTomlString(context.selectedModel)}"`,
    ...(context.contextWindow ? [`model_context_window = ${context.contextWindow}`] : []),
    ...(context.autoCompactTokenLimit
      ? [`model_auto_compact_token_limit = ${context.autoCompactTokenLimit}`]
      : []),
    'model_reasoning_effort = "high"',
    "disable_response_storage = true",
    `model_catalog_json = "${escapeTomlString(catalogPath)}"`,
    `model_instructions_file = "${escapeTomlString(instructionsPath)}"`,
    "",
    `[model_providers.${providerKey}]`,
    `name = "${escapeTomlString(context.providerName)}"`,
    `base_url = "${escapeTomlString(context.gatewayEndpoint)}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    ""
  ].join("\n");
}

function buildModelCatalogJson(context: CodexExportContext) {
  const baseInstructions = "";
  const models = resolveCatalogModels(context).map((item, index) => ({
    slug: item.publicModel,
    display_name: item.publicModel,
    description:
      item.publicModel === item.upstreamModel
        ? "Codex Gateway Hub exported coding model."
        : `Codex Gateway Hub exported coding model. Routes to upstream model ${item.upstreamModel}.`,
    supported_reasoning_levels: [],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: index,
    availability_nux: null,
    upgrade: null,
    base_instructions: baseInstructions,
    supports_reasoning_summaries: false,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: context.applyPatchToolType,
    truncation_policy: {
      mode: "bytes",
      limit: 10000
    },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: item.contextWindow,
    experimental_supported_tools: [],
    input_modalities: ["text"],
    prefer_websockets: false,
    supports_search_tool: false
  }));

  return `${JSON.stringify({ models }, null, 2)}\n`;
}

export function resolveCodexExportContext(
  input: CodexExportContextInput
): CodexExportContext {
  const selectedProfile = resolveSelectedProfile(input);
  const selectedModel = selectedProfile.publicModel;
  const contextWindow =
    selectedProfile.contextWindow ??
    inferContextWindowFromModel(selectedModel, input.provider);

  return {
    ...input,
    localKey: input.localKey.trim(),
    providerName: input.providerName.trim() || "gateway",
    gatewayEndpoint: normalizeGatewayEndpoint(input.gatewayEndpoint),
    preferredModel: input.preferredModel.trim() || DEFAULT_MODEL,
    selectedModel,
    contextWindow,
    autoCompactTokenLimit: resolveAutoCompactTokenLimit(contextWindow)
  };
}

export function buildCodexExportBundle(
  context: CodexExportContext
): CodexExportBundle {
  const fileBase = sanitizeFileBase(`${context.providerName}_${context.selectedModel}`);
  const exportedModels = resolveCatalogModels(context).map((item) => item.publicModel);

  return {
    selectedModel: context.selectedModel,
    exportedModels,
    applyPatchToolType: context.applyPatchToolType,
    files: {
      envSnippet: {
        targetPath: "~/.codex/.env",
        content: `OPENAI_API_KEY=${context.localKey}\n`
      },
      configTomlSnippet: {
        targetPath: "~/.codex/config.toml",
        content: buildConfigTomlSnippet(context)
      },
      modelCatalogJson: {
        targetPath: `${CODEX_OUTPUT_DIR}/${fileBase}.catalog.json`,
        content: buildModelCatalogJson(context)
      },
      modelInstructionsMd: {
        targetPath: `${CODEX_OUTPUT_DIR}/${fileBase}.instructions.md`,
        content: ""
      },
      agentsMd: {
        targetPath: "./AGENTS.md",
        content: ""
      }
    }
  };
}

export function createCodexExportBundle(
  input: CodexExportContextInput
) {
  return buildCodexExportBundle(resolveCodexExportContext(input));
}
