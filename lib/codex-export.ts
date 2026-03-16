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

function isDoubaoCodexAlias(model: string) {
  const normalized = model.trim().toLowerCase().replace(/\[[^\]]+\]$/, "");
  return normalized === "gpt-5.2-codex" || normalized.startsWith("gpt-5.2-codex-");
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
    if (
      normalized.includes("doubao-seed") ||
      normalized.includes("seed-2.0-code") ||
      isDoubaoCodexAlias(normalized)
    ) {
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
  const httpHeadersToml = `http_headers = { "x-codex-gateway-client" = "codex", "x-codex-apply-patch-tool-type" = "${escapeTomlString(
    context.applyPatchToolType
  )}" }`;
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
    httpHeadersToml,
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

function buildModelInstructionsMd(context: CodexExportContext) {
  const normalizedProvider = context.provider.trim().toLowerCase();
  const normalizedSelectedModel = context.selectedModel.trim().toLowerCase();
  const useDoubaoCodexProfile =
    normalizedProvider === "doubao" || isDoubaoCodexAlias(normalizedSelectedModel);
  const applyPatchSection =
    context.applyPatchToolType === "freeform"
      ? [
          "Apply patch policy (freeform):",
          "- When you need to edit files and `apply_patch` is available as a FREEFORM tool, send raw patch text only.",
          "- Do not wrap the patch payload in JSON or Markdown code fences.",
          "- Keep patches minimal and use correct unified diff headers and hunks."
        ]
      : [
          "Apply patch policy (function):",
          "- When you need to edit files and `apply_patch` is available as a function tool, call it through the runtime tool interface.",
          "- Pass valid patch text using the tool's expected function parameter shape.",
          "- Keep patches minimal and use correct unified diff headers and hunks."
        ];
  const modelSpecificSection = useDoubaoCodexProfile
    ? [
        "",
        "Doubao + gpt-5.2-codex compatibility profile:",
        "- Tool-call accuracy is more important than long narrative output.",
        "- For `apply_patch` function calls, always pass a JSON object with a single `input` string field containing patch text.",
        "- Do not emit half-complete tool arguments; ensure arguments are complete before finalizing the tool call.",
        "- For ordered tasks, execute strictly in order and verify each step before moving on.",
        "- Before final completion markers (e.g. `DONE`), run an explicit end-state check."
      ]
    : [];

  return (
    [
      "# Codex Gateway Hub Model Instructions",
      "",
      "You are a coding agent routed through Codex Gateway Hub.",
      "Your target behavior should be close to a high-quality GPT-5.4 coding assistant:",
      "- Inspect before editing.",
      "- Prefer minimal, surgical changes.",
      "- Keep outputs concise and practical.",
      "- Never fabricate tool calls, command outputs, or verification results.",
      "",
      "Tool execution policy:",
      "- Use only tools actually exposed by the runtime.",
      "- If a tool fails, read the error, correct the call, and retry when appropriate.",
      "- Prefer dedicated tools over shell commands when equivalent dedicated tools exist.",
      "- When shell search is needed, prefer `rg` or `rg --files`.",
      ...applyPatchSection,
      "",
      "Editing and verification policy:",
      "- Preserve existing user changes; do not revert unrelated modifications.",
      "- Avoid destructive commands unless explicitly requested.",
      "- After edits, run targeted verification checks when practical and report outcomes honestly.",
      "",
      "Response policy:",
      "- Match the user's language by default.",
      "- Provide short progress updates while working, then a clear final summary of changed files and verification results.",
      "- If blocked by runtime constraints, report the exact blocker and the next actionable step.",
      ...modelSpecificSection,
      ""
    ].join("\n")
  );
}

function buildAgentsMdTemplate(context: CodexExportContext) {
  return (
    [
      "# AGENTS.md",
      "",
      "This workspace is configured for Codex Gateway Hub third-party model alignment.",
      "",
      "Working rules:",
      "- Inspect before editing.",
      "- Edit with minimal scope.",
      "- Verify practical outcomes before claiming completion.",
      "- Do not fabricate tool usage or command results.",
      "- Prefer dedicated tools when available.",
      "- Preserve user changes you did not make.",
      "",
      "Patch rules:",
      "- Prefer `apply_patch` for focused manual edits when available.",
      `- Expected apply_patch mode: ${context.applyPatchToolType}.`,
      "- Never print fake patch text as normal chat output.",
      "",
      "Communication rules:",
      "- Use concise progress updates.",
      "- In final responses, summarize what changed and what was verified.",
      ""
    ].join("\n")
  );
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
        content: buildModelInstructionsMd(context)
      },
      agentsMd: {
        targetPath: "./AGENTS.md",
        content: buildAgentsMdTemplate(context)
      }
    }
  };
}

export function createCodexExportBundle(
  input: CodexExportContextInput
) {
  return buildCodexExportBundle(resolveCodexExportContext(input));
}
