import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedProviders = new Set(["sqlite", "mysql", "postgresql"]);
const supportedTargets = new Set(["mysql", "postgresql"]);

function getArgValue(flag) {
  const prefixed = `${flag}=`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const current = process.argv[i];
    if (current === flag) {
      return process.argv[i + 1] ?? "";
    }
    if (current.startsWith(prefixed)) {
      return current.slice(prefixed.length);
    }
  }
  return "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/migrate-sqlite-to-db.mjs \\",
      "    --target-provider <mysql|postgresql> \\",
      "    --target-url <database-url> \\",
      "    [--source-url file:./dev.db] [--overwrite-target] [--keep-export-file] [--export-file <path>]",
      "",
      "Environment fallback:",
      "  SQLITE_SOURCE_URL",
      "  TARGET_DATABASE_PROVIDER",
      "  TARGET_DATABASE_URL"
    ].join("\n") + "\n"
  );
}

function inferProviderFromUrl(databaseUrl) {
  if (!databaseUrl) return null;
  if (databaseUrl.startsWith("file:")) return "sqlite";
  if (databaseUrl.startsWith("mysql://")) return "mysql";
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) return "postgresql";
  return null;
}

function resolveCurrentProvider() {
  const configured = (process.env.DATABASE_PROVIDER ?? "").trim().toLowerCase();
  const inferred = inferProviderFromUrl(process.env.DATABASE_URL ?? "");
  const provider = configured || inferred || "sqlite";

  if (!supportedProviders.has(provider)) {
    throw new Error(
      `Unsupported DATABASE_PROVIDER "${provider}". Supported: sqlite, mysql, postgresql`
    );
  }

  return provider;
}

function assertProviderMatchesUrl(provider, databaseUrl) {
  const inferred = inferProviderFromUrl(databaseUrl);
  if (!inferred) {
    return;
  }
  if (inferred !== provider) {
    throw new Error(
      `DATABASE_PROVIDER (${provider}) does not match DATABASE_URL protocol (${inferred}).`
    );
  }
}

function resolveSourceUrl() {
  const sourceUrl =
    getArgValue("--source-url") ||
    (process.env.SQLITE_SOURCE_URL ?? "").trim() ||
    "file:./dev.db";

  if (!sourceUrl.startsWith("file:")) {
    throw new Error(`--source-url must be sqlite file URL (file:...), got ${sourceUrl}`);
  }
  return sourceUrl;
}

function resolveTargetProvider() {
  const provider =
    (getArgValue("--target-provider") || process.env.TARGET_DATABASE_PROVIDER || "")
      .trim()
      .toLowerCase();
  if (!provider) {
    throw new Error("Missing --target-provider (mysql|postgresql).");
  }
  if (!supportedTargets.has(provider)) {
    throw new Error(`Unsupported target provider "${provider}". Use mysql or postgresql.`);
  }
  return provider;
}

function resolveTargetUrl(targetProvider) {
  const targetUrl = (getArgValue("--target-url") || process.env.TARGET_DATABASE_URL || "").trim();
  if (!targetUrl) {
    throw new Error("Missing --target-url.");
  }
  assertProviderMatchesUrl(targetProvider, targetUrl);
  return targetUrl;
}

function resolveExportPath() {
  const fromArg = getArgValue("--export-file");
  if (fromArg) {
    return path.resolve(process.cwd(), fromArg);
  }
  const now = Date.now();
  return path.join(os.tmpdir(), `codex-gateway-sqlite-export-${now}.json`);
}

function runNodeScript(relativeScriptPath, args, envOverrides) {
  const scriptPath = path.join(projectRoot, relativeScriptPath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...envOverrides
    },
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${relativeScriptPath} failed with exit code ${result.status}`);
  }
}

function runPrismaGenerate(provider, databaseUrl) {
  runNodeScript("scripts/prisma-generate.mjs", [], {
    DATABASE_PROVIDER: provider,
    DATABASE_URL: databaseUrl
  });
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const sourceUrl = resolveSourceUrl();
  const targetProvider = resolveTargetProvider();
  const targetUrl = resolveTargetUrl(targetProvider);
  const overwriteTarget = hasFlag("--overwrite-target");
  const keepExportFile = hasFlag("--keep-export-file");
  const exportFile = resolveExportPath();

  const originalProvider = resolveCurrentProvider();
  const originalUrl =
    (process.env.DATABASE_URL ?? "").trim() || (originalProvider === "sqlite" ? sourceUrl : "");

  if (!originalUrl) {
    throw new Error(
      "Current DATABASE_URL is empty and cannot be restored automatically after migration."
    );
  }

  process.stdout.write(
    [
      "Starting migration:",
      `- source: sqlite (${sourceUrl})`,
      `- target: ${targetProvider} (${targetUrl})`,
      `- overwrite target: ${overwriteTarget ? "yes" : "no"}`,
      `- export file: ${exportFile}`
    ].join("\n") + "\n"
  );

  try {
    runPrismaGenerate("sqlite", sourceUrl);
    runNodeScript("scripts/db-export.mjs", ["--output", exportFile], {
      DATABASE_PROVIDER: "sqlite",
      DATABASE_URL: sourceUrl
    });

    runPrismaGenerate(targetProvider, targetUrl);
    runNodeScript("scripts/init-db.mjs", ["--skip-seed"], {
      DATABASE_PROVIDER: targetProvider,
      DATABASE_URL: targetUrl,
      DB_INIT_SKIP_SEED: "1"
    });

    const importArgs = ["--input", exportFile];
    if (overwriteTarget) {
      importArgs.push("--overwrite-target");
    }
    runNodeScript("scripts/db-import.mjs", importArgs, {
      DATABASE_PROVIDER: targetProvider,
      DATABASE_URL: targetUrl
    });

    process.stdout.write("Migration finished successfully.\n");
  } finally {
    if (!keepExportFile && existsSync(exportFile)) {
      rmSync(exportFile, { force: true });
    }

    try {
      runPrismaGenerate(originalProvider, originalUrl);
    } catch (error) {
      process.stderr.write(
        `Warning: failed to restore Prisma Client for provider=${originalProvider}. ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `migrate-sqlite-to-db failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
