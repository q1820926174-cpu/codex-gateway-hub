export type CodexApplyPatchToolType = "function" | "freeform";

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

function buildToolModeLine(toolType: CodexApplyPatchToolType) {
  if (toolType === "function") {
    return 'The `apply_patch` tool in this provider uses function mode. Call it with JSON and place the full patch in the `"input"` field.';
  }
  return "The `apply_patch` tool in this provider uses freeform mode. Send only the raw patch text and do not wrap it in JSON.";
}

/**
 * 构建 Codex / Gateway Hub 场景下的系统指令正文。
 *
 * 设计目标：
 * 1. 保持系统提示词整体为英文，降低多语言混杂带来的行为漂移。
 * 2. 明确 apply_patch 的唯一编辑职责，避免模型擅自输出补丁文本或改用其他编辑方式。
 * 3. 将“用户回复语言”单独放入 Language 区块，减少与工具规则相互干扰。
 * 4. 增加 instruction priority，提升多规则并存时的稳定性。
 *
 * 注意：
 * - 这里假设 `buildToolModeLine(toolType)` 已在你的项目中存在。
 * - `CodexApplyPatchToolType` 也沿用你现有的类型定义。
 */
function buildInstructionBody(toolType: CodexApplyPatchToolType) {
  return [
    "You are a coding agent running inside Codex CLI through a Codex Gateway Hub provider.",
    "",
    "## Instruction Priority",
    "- Safety and platform constraints always apply.",
    "- Tool-use and file-editing rules override style preferences.",
    "- If the user explicitly requests a language, follow the user's language choice.",
    "- Otherwise, default to Chinese for user-facing replies.",
    "",
    "## Language",
    "- If the user specifies a language, reply in that language.",
    "- Otherwise, reply in Chinese.",
    "- Never translate tool names, patch headers, file paths, code, identifiers, or command names unless the user explicitly asks for translation.",
    "",
    "## File Editing",
    "- When you need to create, modify, rename, or delete files, you MUST use the `apply_patch` tool.",
    "- Never print patch text in a normal assistant message.",
    "- Never use `applypatch` or `apply-patch`.",
    "- Use only relative file paths inside patches.",
    "- Do not use shell editors for normal code edits when `apply_patch` is available.",
    "",
    "## Tool Mode",
    buildToolModeLine(toolType),
    "",
    "## Patch Format",
    "*** Begin Patch",
    "*** Add File: relative/path",
    "+file contents",
    "*** Update File: relative/path",
    "@@",
    "-old text",
    "+new text",
    "*** Delete File: relative/path",
    "*** End Patch",
    "",
    "## Patch Rules",
    "- Always include one file action header for each file.",
    "- Prefix every added line in a new file with `+`.",
    "- For updates, include enough surrounding context to uniquely match the target.",
    "- If a patch fails, inspect the file and retry with a smaller, more specific hunk.",
    "- Keep edits minimal and targeted to the requested task.",
    "- Preserve existing style unless the user asks for a refactor or formatting change.",
    "",
    "## Completion",
    "- After successful edits, briefly summarize which files changed.",
    "- Keep the final user-facing summary concise and do not include raw patch text unless the user explicitly asks for it."
  ].join("\n");
}

function buildAgentsInstructions(toolType: CodexApplyPatchToolType) {
  return [
    "## File editing rules",
    "",
    "When you need to create, modify, rename, or delete files, you MUST use the `apply_patch` tool.",
    "Do NOT print patch text in a normal assistant message.",
    "Do NOT use `applypatch` or `apply-patch`; the only valid name is `apply_patch`.",
    "Use only relative file paths.",
    "",
    buildToolModeLine(toolType),
    "",
    "For `apply_patch`:",
    "- Wrap every patch in `*** Begin Patch` and `*** End Patch`.",
    "- Use exactly one of `*** Add File: <relative/path>`, `*** Update File: <relative/path>`, or `*** Delete File: <relative/path>` for each file.",
    "- Prefix every newly added line with `+`.",
    "- For updates, use `@@` hunks with enough surrounding context to uniquely locate the change.",
    "- If the first patch attempt fails, read the file again and retry with a smaller, more specific hunk.",
    "",
    "Never use `sed`, `perl -pi`, Python one-liners, or here-doc overwrites for normal code edits when `apply_patch` is available.",
    "After a successful edit, briefly summarize which files changed."
  ].join("\n");
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
  const baseInstructions = buildInstructionBody(context.applyPatchToolType);
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
        content: `${buildInstructionBody(context.applyPatchToolType)}\n`
      },
      agentsMd: {
        targetPath: "./AGENTS.md",
        content: `${buildAgentsInstructions(context.applyPatchToolType)}\n`
      }
    }
  };
}

export function createCodexExportBundle(
  input: CodexExportContextInput
) {
  return buildCodexExportBundle(resolveCodexExportContext(input));
}
