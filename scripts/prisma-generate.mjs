import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supportedProviders = new Set(["sqlite", "mysql", "postgresql"]);

function inferProviderFromUrl(databaseUrl) {
  if (!databaseUrl) return null;
  if (databaseUrl.startsWith("file:")) return "sqlite";
  if (databaseUrl.startsWith("mysql://")) return "mysql";
  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) return "postgresql";
  return null;
}

function resolveDatabaseProvider() {
  const configured = (process.env.DATABASE_PROVIDER ?? "").trim().toLowerCase();
  const inferred = inferProviderFromUrl(process.env.DATABASE_URL ?? "");
  const provider = configured || inferred || "sqlite";

  if (!supportedProviders.has(provider)) {
    throw new Error(
      `Unsupported DATABASE_PROVIDER "${provider}". Supported: sqlite, mysql, postgresql`
    );
  }

  process.env.DATABASE_PROVIDER = provider;
  return provider;
}

function assertProviderMatchesUrl(provider, databaseUrl) {
  const inferred = inferProviderFromUrl(databaseUrl);
  if (!inferred) return;

  if (inferred !== provider) {
    throw new Error(
      `DATABASE_PROVIDER (${provider}) 与 DATABASE_URL 协议 (${inferred}) 不一致。请统一配置后重试。`
    );
  }
}

function ensureDatabaseUrl(provider) {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    if (provider === "sqlite") {
      process.env.DATABASE_URL = "file:./dev.db";
      return;
    }
    throw new Error("DATABASE_URL 未配置。mysql/postgresql 必须显式设置连接串。");
  }

  assertProviderMatchesUrl(provider, url);
}

function prepareSchema(provider) {
  const baseSchemaPath = path.join(projectRoot, "prisma", "schema.prisma");

  if (provider === "sqlite") {
    return {
      schemaPath: baseSchemaPath,
      cleanup: () => {}
    };
  }

  const baseSchema = readFileSync(baseSchemaPath, "utf8");
  if (!baseSchema.includes('provider = "sqlite"')) {
    throw new Error("prisma/schema.prisma must contain datasource provider = \"sqlite\".");
  }

  const schemaForProvider = baseSchema.replace('provider = "sqlite"', `provider = "${provider}"`);
  const schemaPath = path.join(projectRoot, "prisma", `.schema.${provider}.prisma`);
  writeFileSync(schemaPath, schemaForProvider, "utf8");

  return {
    schemaPath,
    cleanup: () => rmSync(schemaPath, { force: true })
  };
}

function runPrismaGenerate(schemaPath) {
  const prismaBin = path.join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma"
  );

  if (!existsSync(prismaBin)) {
    throw new Error(`Prisma CLI not found at ${prismaBin}. Run npm install first.`);
  }

  const result = spawnSync(prismaBin, ["generate", "--schema", schemaPath], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`prisma generate failed with exit code ${result.status}`);
  }
}

function main() {
  const provider = resolveDatabaseProvider();
  ensureDatabaseUrl(provider);
  const schema = prepareSchema(provider);

  try {
    runPrismaGenerate(schema.schemaPath);
  } finally {
    schema.cleanup();
  }

  process.stdout.write(`Generated Prisma Client with provider=${provider}\n`);
}

main();
