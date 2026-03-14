import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

export const DEFAULT_AGENTS_MD_KEYWORDS = [
  "AGENTS.md",
  "AGENTS.MD",
  "agents.md"
] as const;

export const DEFAULT_CHINESE_REPLY_HINT = `
You are a coding agent with access to the \`apply_patch\` tool.

When you need to create, modify, rename, or delete files, you MUST use \`apply_patch\`.
Never output patch text in a normal assistant message.
Never use shell editors or ad-hoc file rewrite commands when \`apply_patch\` is available.

## apply_patch rules

1. Patch envelope
Always wrap patches in this format:

*** Begin Patch
...patch body...
*** End Patch

2. File operations
Use one of these headers:
- *** Update File: relative/path/to/file
- *** Add File: relative/path/to/file
- *** Delete File: relative/path/to/file

3. Paths
Always use relative file paths.
Never use absolute paths unless the tool specification explicitly requires them.

4. Hunks
For modifications, use hunks introduced by:
@@

Within a hunk:
- Lines starting with a single space are context lines and MUST exactly match the current file content.
- Lines starting with \`-\` are lines to remove and MUST exactly match the current file content.
- Lines starting with \`+\` are lines to add.

5. Matching discipline
Do not guess old content.
Before writing a patch, make sure the removed lines and context lines exactly match the current file.
If patch application fails, re-read the file and regenerate the patch from the actual content.

6. Minimality
Only change the lines that are necessary.
Keep enough surrounding context to make the patch unambiguous.

7. No extra formatting
Do not wrap the patch in Markdown code fences.
Do not explain the patch outside the tool call.
Only send the patch text as the \`input\` to \`apply_patch\`.

## Examples

### Update an existing file
*** Begin Patch
*** Update File: snake.html
@@
 body {
-  display: flex;
-  flex-direction: column;
+  display: flex; /* 使用弹性布局 */
+  flex-direction: column; /* 子元素垂直排列 */
   align-items: center;
 }
*** End Patch

### Add a new file
*** Begin Patch
*** Add File: utils/helper.py
+def hello() -> str:
+    return "hello"
*** End Patch

### Delete a file
*** Begin Patch
*** Delete File: old_script.py
*** End Patch

You must use Chinese for both reasoning and responses.
Do not think in or output any other language.
Chinese is mandatory for all internal reasoning and external replies unless explicitly instructed otherwise.
`.trim();

export type CompatPromptConfig = {
  agentsMdKeywords: string[];
  chineseReplyHint: string;
};

type GatewayConfigFile = {
  compatPromptConfig?: Partial<CompatPromptConfig>;
};

const DEFAULT_COMPAT_PROMPT_CONFIG: CompatPromptConfig = {
  agentsMdKeywords: [...DEFAULT_AGENTS_MD_KEYWORDS],
  chineseReplyHint: DEFAULT_CHINESE_REPLY_HINT
};

const COMPAT_CONFIG_PATH = path.resolve(process.cwd(), "data", "gateway-config.json");
const CACHE_TTL_MS = 2000;

let compatPromptConfigCache:
  | {
      value: CompatPromptConfig;
      expiresAt: number;
    }
  | null = null;

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

function readCompatPromptConfigFromDisk(): CompatPromptConfig {
  try {
    if (!existsSync(COMPAT_CONFIG_PATH)) {
      return getCompatPromptDefaults();
    }

    const raw = readFileSync(COMPAT_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as GatewayConfigFile;
    return {
      agentsMdKeywords: normalizeAgentsMdKeywords(parsed.compatPromptConfig?.agentsMdKeywords),
      chineseReplyHint: normalizeChineseReplyHint(parsed.compatPromptConfig?.chineseReplyHint)
    };
  } catch {
    return getCompatPromptDefaults();
  }
}

export function getCompatPromptDefaults(): CompatPromptConfig {
  return {
    agentsMdKeywords: [...DEFAULT_COMPAT_PROMPT_CONFIG.agentsMdKeywords],
    chineseReplyHint: DEFAULT_COMPAT_PROMPT_CONFIG.chineseReplyHint
  };
}

export function getCompatPromptConfig(): CompatPromptConfig {
  const now = Date.now();
  if (compatPromptConfigCache && compatPromptConfigCache.expiresAt > now) {
    return {
      agentsMdKeywords: [...compatPromptConfigCache.value.agentsMdKeywords],
      chineseReplyHint: compatPromptConfigCache.value.chineseReplyHint
    };
  }

  const value = readCompatPromptConfigFromDisk();
  compatPromptConfigCache = {
    value,
    expiresAt: now + CACHE_TTL_MS
  };

  return {
    agentsMdKeywords: [...value.agentsMdKeywords],
    chineseReplyHint: value.chineseReplyHint
  };
}

export async function saveCompatPromptConfig(input: CompatPromptConfig) {
  const normalized: CompatPromptConfig = {
    agentsMdKeywords: normalizeAgentsMdKeywords(input.agentsMdKeywords),
    chineseReplyHint: normalizeChineseReplyHint(input.chineseReplyHint)
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

  return {
    agentsMdKeywords: [...normalized.agentsMdKeywords],
    chineseReplyHint: normalized.chineseReplyHint
  };
}
