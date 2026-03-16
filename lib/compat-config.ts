import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

export const DEFAULT_AGENTS_MD_KEYWORDS = [
  "AGENTS.md",
  "AGENTS.MD",
  "agents.md"
] as const;

export const DEFAULT_CHINESE_REPLY_HINT = `
You are a Codex-compatible coding agent routed to a third-party model.
Primary objective: correct tool calls and verifiable execution results.

Tool-call correctness rules (highest priority):
- Use only tools that are actually exposed by the runtime.
- Before calling a tool, strictly follow that tool's exact schema:
  tool name, parameter names, required fields, enum values, and value types must match.
- Never invent tools, parameters, enum values, or fake tool outputs.
- Never output pseudo tool calls (JSON/XML/markdown blocks) as a replacement for real tool invocation.
- If a tool call fails, read the error message, fix the call, and retry.
- Never claim a file/command/check succeeded unless the tool result actually succeeded.

apply_patch and file-edit rules:
- When \`apply_patch\` is available, prefer it for create/modify/delete/rename.
- If \`apply_patch\` is FREEFORM, pass raw patch text only (no JSON wrapper, no code fences).
- If \`apply_patch\` is FUNCTION style, pass valid patch text in the expected function parameter.
- Never print patch text directly in normal assistant messages.
- Keep edits minimal and do not revert unrelated user changes.

Command/session rules:
- Prefer dedicated tools over shell when equivalent tools exist.
- For search, prefer \`rg\` or \`rg --files\`.
- If a command returns \`session_id\`, continue with \`write_stdin\` in the same session.

Execution protocol:
1) Inspect relevant files/context first.
2) Execute the required changes.
3) Verify results with concrete checks.
4) Then provide final response.

Completion guard (critical):
- If the user gives ordered steps, execute in the same order.
- After each key step, run a concrete verification check.
- Before final response, run an end-state check for the whole task.
- If any verification fails, continue fixing instead of claiming completion.
- If the user asks for only \`DONE\`, output \`DONE\` only when all checks pass.

Response style:
- Default to concise Chinese unless user requests another language.
- Keep progress updates short and factual.
`.trim();

const MAX_PATTERN_FIELD_LENGTH = 200;
const MAX_RULE_HINT_LENGTH = 20_000;
const MAX_RULE_ID_LENGTH = 120;
const MAX_MODEL_PROMPT_RULES = 128;

type CompatPromptRuleSource = {
  id?: unknown;
  enabled?: unknown;
  provider?: unknown;
  upstreamModelPattern?: unknown;
  hint?: unknown;
};

export type CompatPromptRule = {
  id: string;
  enabled: boolean;
  provider: string;
  upstreamModelPattern: string;
  hint: string;
};

export type CompatPromptConfig = {
  agentsMdKeywords: string[];
  chineseReplyHint: string;
  modelPromptRules: CompatPromptRule[];
};

export type CompatPromptConfigInput = {
  agentsMdKeywords?: unknown;
  chineseReplyHint?: unknown;
  modelPromptRules?: unknown;
};

type GatewayConfigFile = {
  compatPromptConfig?: Partial<CompatPromptConfig>;
};

const DEFAULT_COMPAT_PROMPT_CONFIG: CompatPromptConfig = {
  agentsMdKeywords: [...DEFAULT_AGENTS_MD_KEYWORDS],
  chineseReplyHint: DEFAULT_CHINESE_REPLY_HINT,
  modelPromptRules: []
};

const COMPAT_CONFIG_PATH = path.resolve(process.cwd(), "data", "gateway-config.json");
const CACHE_TTL_MS = 2000;

let compatPromptConfigCache:
  | {
      value: CompatPromptConfig;
      expiresAt: number;
    }
  | null = null;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAgentsMdKeywords(value: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_COMPAT_PROMPT_CONFIG.agentsMdKeywords];
  }

  const deduped = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );

  return deduped.length ? deduped : [...DEFAULT_COMPAT_PROMPT_CONFIG.agentsMdKeywords];
}

function normalizeChineseReplyHint(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_COMPAT_PROMPT_CONFIG.chineseReplyHint;
  }
  return value.trim();
}

function normalizePatternField(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= MAX_PATTERN_FIELD_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_PATTERN_FIELD_LENGTH);
}

function normalizeRuleHint(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= MAX_RULE_HINT_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_RULE_HINT_LENGTH);
}

function normalizeRuleId(value: unknown, index: number) {
  const fallback = `rule-${index + 1}`;
  const normalized = trimText(value);
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= MAX_RULE_ID_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_RULE_ID_LENGTH);
}

function normalizeModelPromptRule(value: unknown, index: number): CompatPromptRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as CompatPromptRuleSource;
  const hint = normalizeRuleHint(source.hint);
  if (!hint) {
    return null;
  }

  return {
    id: normalizeRuleId(source.id, index),
    enabled: source.enabled !== false,
    provider: normalizePatternField(source.provider),
    upstreamModelPattern: normalizePatternField(source.upstreamModelPattern),
    hint
  };
}

function normalizeModelPromptRules(value: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_COMPAT_PROMPT_CONFIG.modelPromptRules];
  }

  const rules: CompatPromptRule[] = [];
  for (let index = 0; index < value.length && rules.length < MAX_MODEL_PROMPT_RULES; index += 1) {
    const normalized = normalizeModelPromptRule(value[index], index);
    if (normalized) {
      rules.push(normalized);
    }
  }

  return rules;
}

function cloneModelPromptRule(rule: CompatPromptRule): CompatPromptRule {
  return {
    id: rule.id,
    enabled: rule.enabled,
    provider: rule.provider,
    upstreamModelPattern: rule.upstreamModelPattern,
    hint: rule.hint
  };
}

function cloneCompatPromptConfig(config: CompatPromptConfig): CompatPromptConfig {
  return {
    agentsMdKeywords: [...config.agentsMdKeywords],
    chineseReplyHint: config.chineseReplyHint,
    modelPromptRules: config.modelPromptRules.map((rule) => cloneModelPromptRule(rule))
  };
}

function normalizeModelMatchValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function splitPatternTokens(pattern: string) {
  return pattern
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string) {
  const escaped = escapeRegExp(pattern)
    .replace(/\\\*/g, ".*")
    .replace(/\\\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

type PatternMatchRank = -1 | 0 | 1 | 2;

function rankPatternMatch(pattern: string, target: string): PatternMatchRank {
  const tokens = splitPatternTokens(pattern);
  if (!tokens.length) {
    return 0;
  }
  if (!target) {
    return -1;
  }

  let rank: PatternMatchRank = -1;
  for (const token of tokens) {
    if (token === "*" || token === "all" || token === "any") {
      rank = rank < 1 ? 1 : rank;
      continue;
    }
    if (token.includes("*") || token.includes("?")) {
      if (wildcardToRegExp(token).test(target)) {
        rank = rank < 1 ? 1 : rank;
      }
      continue;
    }
    if (token === target) {
      rank = 2;
      break;
    }
  }

  return rank;
}

type CompatPromptHintMatchInput = {
  provider: string | null | undefined;
  upstreamModel: string | null | undefined;
  clientModel: string | null | undefined;
};

type CompatPromptRuleScoreDetail = {
  providerRank: PatternMatchRank;
  upstreamRank: PatternMatchRank;
  hasProvider: boolean;
  hasUpstream: boolean;
  score: number;
};

export type CompatPromptHintResolutionDebug = {
  hint: string;
  hintSource: "default" | "rule";
  matchedRuleId: string | null;
  matchedRuleIndex: number | null;
  scoreBreakdown: CompatPromptRuleScoreDetail | null;
};

function buildRuleScoreDetail(rule: CompatPromptRule, provider: string, upstreamModel: string) {
  const providerRank = rankPatternMatch(rule.provider, provider);
  if (providerRank < 0) {
    return null;
  }

  const upstreamRank = rankPatternMatch(rule.upstreamModelPattern, upstreamModel);
  if (upstreamRank < 0) {
    return null;
  }

  const hasProvider = !!rule.provider.trim();
  const hasUpstream = !!rule.upstreamModelPattern.trim();
  const score =
    upstreamRank * 100 +
    providerRank * 25 +
    (hasUpstream ? 8 : 0) +
    (hasProvider ? 4 : 0);

  return {
    providerRank,
    upstreamRank,
    hasProvider,
    hasUpstream,
    score
  } satisfies CompatPromptRuleScoreDetail;
}

function findBestCompatPromptRuleMatch(
  rules: CompatPromptRule[],
  input: CompatPromptHintMatchInput
) {
  const provider = normalizeModelMatchValue(input.provider);
  const upstreamModel = normalizeModelMatchValue(input.upstreamModel);

  let best: {
    hint: string;
    ruleId: string;
    ruleIndex: number;
    score: CompatPromptRuleScoreDetail;
  } | null = null;

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule.enabled || !rule.hint) {
      continue;
    }

    const score = buildRuleScoreDetail(rule, provider, upstreamModel);
    if (!score) {
      continue;
    }

    if (!best || score.score > best.score.score || (score.score === best.score.score && index < best.ruleIndex)) {
      best = {
        hint: rule.hint,
        ruleId: rule.id,
        ruleIndex: index,
        score
      };
    }
  }

  return best;
}

function resolveCompatPromptHintFromRules(
  rules: CompatPromptRule[],
  input: CompatPromptHintMatchInput
) {
  return findBestCompatPromptRuleMatch(rules, input)?.hint ?? "";
}

function readCompatPromptConfigFromDisk(): CompatPromptConfig {
  try {
    if (!existsSync(COMPAT_CONFIG_PATH)) {
      return getCompatPromptDefaults();
    }

    const raw = readFileSync(COMPAT_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as GatewayConfigFile;
    return {
      agentsMdKeywords: normalizeAgentsMdKeywords(parsed.compatPromptConfig?.agentsMdKeywords),
      chineseReplyHint: normalizeChineseReplyHint(parsed.compatPromptConfig?.chineseReplyHint),
      modelPromptRules: normalizeModelPromptRules(parsed.compatPromptConfig?.modelPromptRules)
    };
  } catch {
    return getCompatPromptDefaults();
  }
}

export function getCompatPromptDefaults(): CompatPromptConfig {
  return cloneCompatPromptConfig(DEFAULT_COMPAT_PROMPT_CONFIG);
}

export function getCompatPromptConfig(): CompatPromptConfig {
  const now = Date.now();
  if (compatPromptConfigCache && compatPromptConfigCache.expiresAt > now) {
    return cloneCompatPromptConfig(compatPromptConfigCache.value);
  }

  const value = readCompatPromptConfigFromDisk();
  compatPromptConfigCache = {
    value,
    expiresAt: now + CACHE_TTL_MS
  };

  return cloneCompatPromptConfig(value);
}

export async function saveCompatPromptConfig(input: CompatPromptConfigInput) {
  const normalized: CompatPromptConfig = {
    agentsMdKeywords: normalizeAgentsMdKeywords(input.agentsMdKeywords),
    chineseReplyHint: normalizeChineseReplyHint(input.chineseReplyHint),
    modelPromptRules: normalizeModelPromptRules(input.modelPromptRules)
  };

  await mkdir(path.dirname(COMPAT_CONFIG_PATH), { recursive: true });
  await writeFile(
    COMPAT_CONFIG_PATH,
    JSON.stringify(
      {
        compatPromptConfig: normalized
      } satisfies GatewayConfigFile,
      null,
      2
    ),
    "utf8"
  );

  compatPromptConfigCache = {
    value: normalized,
    expiresAt: Date.now() + CACHE_TTL_MS
  };

  return cloneCompatPromptConfig(normalized);
}

export function resolveCompatPromptHintForModel(input: CompatPromptHintMatchInput) {
  const config = getCompatPromptConfig();
  return resolveCompatPromptHintFromRules(config.modelPromptRules, input);
}

export function resolveCompatPromptHintDebugForModel(
  input: CompatPromptHintMatchInput
): CompatPromptHintResolutionDebug {
  const config = getCompatPromptConfig();
  const match = findBestCompatPromptRuleMatch(config.modelPromptRules, input);
  if (!match) {
    return {
      hint: config.chineseReplyHint,
      hintSource: "default",
      matchedRuleId: null,
      matchedRuleIndex: null,
      scoreBreakdown: null
    };
  }

  return {
    hint: match.hint,
    hintSource: "rule",
    matchedRuleId: match.ruleId,
    matchedRuleIndex: match.ruleIndex,
    scoreBreakdown: match.score
  };
}
