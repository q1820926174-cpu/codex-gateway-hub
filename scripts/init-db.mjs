import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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
  if (!process.env.DATABASE_URL) {
    if (provider === "sqlite") {
      process.env.DATABASE_URL = "file:./dev.db";
    } else {
      throw new Error("DATABASE_URL is required for mysql/postgresql.");
    }
  }

  assertProviderMatchesUrl(provider, process.env.DATABASE_URL);
  return process.env.DATABASE_URL;
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl || !databaseUrl.startsWith("file:")) {
    throw new Error('DATABASE_URL must use sqlite format: file:./dev.db or file:/abs/path.db');
  }

  const urlPath = databaseUrl.slice("file:".length);
  if (!urlPath) {
    throw new Error("DATABASE_URL file path is empty.");
  }

  if (path.isAbsolute(urlPath)) {
    return urlPath;
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const prismaDir = path.join(projectRoot, "prisma");
  return path.resolve(prismaDir, urlPath);
}

function cleanupSqliteDatabase(dbPath) {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-journal`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

function statementsByProvider(provider) {
  if (provider === "sqlite") {
    return {
      create: [
        `
          CREATE TABLE IF NOT EXISTS "UpstreamChannel" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "name" TEXT NOT NULL,
            "provider" TEXT NOT NULL DEFAULT 'openai',
            "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses',
            "upstreamBaseUrl" TEXT NOT NULL,
            "upstreamApiKey" TEXT,
            "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]',
            "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
            "supportsVision" BOOLEAN NOT NULL DEFAULT true,
            "visionModel" TEXT,
            "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS "ProviderKey" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "name" TEXT NOT NULL,
            "localKey" TEXT NOT NULL,
            "upstreamChannelId" INTEGER,
            "provider" TEXT NOT NULL DEFAULT 'openai',
            "wireApi" TEXT NOT NULL DEFAULT 'responses',
            "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses',
            "upstreamBaseUrl" TEXT NOT NULL,
            "upstreamApiKey" TEXT,
            "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]',
            "modelMappingsJson" TEXT NOT NULL DEFAULT '[]',
            "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
            "supportsVision" BOOLEAN NOT NULL DEFAULT true,
            "visionModel" TEXT,
            "dynamicModelSwitch" BOOLEAN NOT NULL DEFAULT false,
            "contextSwitchThreshold" INTEGER NOT NULL DEFAULT 12000,
            "contextOverflowModel" TEXT,
            "activeModelOverride" TEXT,
            "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "ProviderKey_upstreamChannelId_fkey"
              FOREIGN KEY ("upstreamChannelId") REFERENCES "UpstreamChannel" ("id")
              ON DELETE SET NULL ON UPDATE CASCADE
          )
        `,
        `
          CREATE TABLE IF NOT EXISTS "TokenUsageEvent" (
            "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            "keyId" INTEGER NOT NULL,
            "keyName" TEXT NOT NULL,
            "route" TEXT NOT NULL,
            "requestWireApi" TEXT NOT NULL,
            "upstreamWireApi" TEXT NOT NULL,
            "requestedModel" TEXT NOT NULL,
            "clientModel" TEXT NOT NULL,
            "upstreamModel" TEXT NOT NULL,
            "stream" BOOLEAN NOT NULL DEFAULT false,
            "promptTokens" INTEGER NOT NULL DEFAULT 0,
            "completionTokens" INTEGER NOT NULL DEFAULT 0,
            "totalTokens" INTEGER NOT NULL DEFAULT 0,
            "minuteBucket" DATETIME NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "TokenUsageEvent_keyId_fkey"
              FOREIGN KEY ("keyId") REFERENCES "ProviderKey" ("id")
              ON DELETE CASCADE ON UPDATE CASCADE
          )
        `
      ],
      patch: [
        `ALTER TABLE "ProviderKey" ADD COLUMN "upstreamChannelId" INTEGER`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses'`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]'`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "modelMappingsJson" TEXT NOT NULL DEFAULT '[]'`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "supportsVision" BOOLEAN NOT NULL DEFAULT true`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "visionModel" TEXT`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "dynamicModelSwitch" BOOLEAN NOT NULL DEFAULT false`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "contextSwitchThreshold" INTEGER NOT NULL DEFAULT 12000`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "contextOverflowModel" TEXT`,
        `ALTER TABLE "ProviderKey" ADD COLUMN "activeModelOverride" TEXT`
      ],
      index: [
        `CREATE UNIQUE INDEX IF NOT EXISTS "ProviderKey_localKey_key" ON "ProviderKey"("localKey")`,
        `CREATE INDEX IF NOT EXISTS "ProviderKey_upstreamChannelId_idx" ON "ProviderKey"("upstreamChannelId")`,
        `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_minuteBucket_idx" ON "TokenUsageEvent"("minuteBucket")`,
        `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_minuteBucket_idx" ON "TokenUsageEvent"("keyId", "minuteBucket")`,
        `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_clientModel_minuteBucket_idx" ON "TokenUsageEvent"("keyId", "clientModel", "minuteBucket")`
      ],
      reset: []
    };
  }

  if (provider === "mysql") {
    return {
      create: [
        `
          CREATE TABLE IF NOT EXISTS \`UpstreamChannel\` (
            \`id\` INT NOT NULL AUTO_INCREMENT,
            \`name\` VARCHAR(255) NOT NULL,
            \`provider\` VARCHAR(64) NOT NULL DEFAULT 'openai',
            \`upstreamWireApi\` VARCHAR(64) NOT NULL DEFAULT 'responses',
            \`upstreamBaseUrl\` TEXT NOT NULL,
            \`upstreamApiKey\` TEXT,
            \`upstreamModelsJson\` LONGTEXT NOT NULL,
            \`defaultModel\` VARCHAR(255) NOT NULL DEFAULT 'gpt-4.1-mini',
            \`supportsVision\` BOOLEAN NOT NULL DEFAULT true,
            \`visionModel\` VARCHAR(255),
            \`timeoutMs\` INT NOT NULL DEFAULT 60000,
            \`enabled\` BOOLEAN NOT NULL DEFAULT true,
            \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (\`id\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `,
        `
          CREATE TABLE IF NOT EXISTS \`ProviderKey\` (
            \`id\` INT NOT NULL AUTO_INCREMENT,
            \`name\` VARCHAR(255) NOT NULL,
            \`localKey\` VARCHAR(255) NOT NULL,
            \`upstreamChannelId\` INT,
            \`provider\` VARCHAR(64) NOT NULL DEFAULT 'openai',
            \`wireApi\` VARCHAR(64) NOT NULL DEFAULT 'responses',
            \`upstreamWireApi\` VARCHAR(64) NOT NULL DEFAULT 'responses',
            \`upstreamBaseUrl\` TEXT NOT NULL,
            \`upstreamApiKey\` TEXT,
            \`upstreamModelsJson\` LONGTEXT NOT NULL,
            \`modelMappingsJson\` LONGTEXT NOT NULL,
            \`defaultModel\` VARCHAR(255) NOT NULL DEFAULT 'gpt-4.1-mini',
            \`supportsVision\` BOOLEAN NOT NULL DEFAULT true,
            \`visionModel\` VARCHAR(255),
            \`dynamicModelSwitch\` BOOLEAN NOT NULL DEFAULT false,
            \`contextSwitchThreshold\` INT NOT NULL DEFAULT 12000,
            \`contextOverflowModel\` VARCHAR(255),
            \`activeModelOverride\` VARCHAR(255),
            \`timeoutMs\` INT NOT NULL DEFAULT 60000,
            \`enabled\` BOOLEAN NOT NULL DEFAULT true,
            \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`ProviderKey_localKey_key\` (\`localKey\`),
            KEY \`ProviderKey_upstreamChannelId_idx\` (\`upstreamChannelId\`),
            CONSTRAINT \`ProviderKey_upstreamChannelId_fkey\`
              FOREIGN KEY (\`upstreamChannelId\`) REFERENCES \`UpstreamChannel\`(\`id\`)
              ON DELETE SET NULL ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `,
        `
          CREATE TABLE IF NOT EXISTS \`TokenUsageEvent\` (
            \`id\` INT NOT NULL AUTO_INCREMENT,
            \`keyId\` INT NOT NULL,
            \`keyName\` VARCHAR(255) NOT NULL,
            \`route\` VARCHAR(255) NOT NULL,
            \`requestWireApi\` VARCHAR(64) NOT NULL,
            \`upstreamWireApi\` VARCHAR(64) NOT NULL,
            \`requestedModel\` VARCHAR(255) NOT NULL,
            \`clientModel\` VARCHAR(255) NOT NULL,
            \`upstreamModel\` VARCHAR(255) NOT NULL,
            \`stream\` BOOLEAN NOT NULL DEFAULT false,
            \`promptTokens\` INT NOT NULL DEFAULT 0,
            \`completionTokens\` INT NOT NULL DEFAULT 0,
            \`totalTokens\` INT NOT NULL DEFAULT 0,
            \`minuteBucket\` DATETIME(3) NOT NULL,
            \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (\`id\`),
            KEY \`TokenUsageEvent_minuteBucket_idx\` (\`minuteBucket\`),
            KEY \`TokenUsageEvent_keyId_minuteBucket_idx\` (\`keyId\`, \`minuteBucket\`),
            KEY \`TokenUsageEvent_keyId_clientModel_minuteBucket_idx\` (\`keyId\`, \`clientModel\`, \`minuteBucket\`),
            CONSTRAINT \`TokenUsageEvent_keyId_fkey\`
              FOREIGN KEY (\`keyId\`) REFERENCES \`ProviderKey\`(\`id\`)
              ON DELETE CASCADE ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `
      ],
      patch: [
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`upstreamChannelId\` INT NULL`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`upstreamWireApi\` VARCHAR(64) NOT NULL DEFAULT 'responses'`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`upstreamModelsJson\` LONGTEXT NOT NULL`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`modelMappingsJson\` LONGTEXT NOT NULL`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`supportsVision\` BOOLEAN NOT NULL DEFAULT true`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`visionModel\` VARCHAR(255) NULL`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`dynamicModelSwitch\` BOOLEAN NOT NULL DEFAULT false`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`contextSwitchThreshold\` INT NOT NULL DEFAULT 12000`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`contextOverflowModel\` VARCHAR(255) NULL`,
        `ALTER TABLE \`ProviderKey\` ADD COLUMN \`activeModelOverride\` VARCHAR(255) NULL`,
        `ALTER TABLE \`ProviderKey\` ADD INDEX \`ProviderKey_upstreamChannelId_idx\` (\`upstreamChannelId\`)`,
        `ALTER TABLE \`ProviderKey\` ADD CONSTRAINT \`ProviderKey_upstreamChannelId_fkey\` FOREIGN KEY (\`upstreamChannelId\`) REFERENCES \`UpstreamChannel\`(\`id\`) ON DELETE SET NULL ON UPDATE CASCADE`
      ],
      index: [
        `CREATE UNIQUE INDEX \`ProviderKey_localKey_key\` ON \`ProviderKey\`(\`localKey\`)`,
        `CREATE INDEX \`TokenUsageEvent_minuteBucket_idx\` ON \`TokenUsageEvent\`(\`minuteBucket\`)`,
        `CREATE INDEX \`TokenUsageEvent_keyId_minuteBucket_idx\` ON \`TokenUsageEvent\`(\`keyId\`, \`minuteBucket\`)`,
        `CREATE INDEX \`TokenUsageEvent_keyId_clientModel_minuteBucket_idx\` ON \`TokenUsageEvent\`(\`keyId\`, \`clientModel\`, \`minuteBucket\`)`
      ],
      reset: [
        `SET FOREIGN_KEY_CHECKS = 0`,
        `DROP TABLE IF EXISTS \`TokenUsageEvent\``,
        `DROP TABLE IF EXISTS \`ProviderKey\``,
        `DROP TABLE IF EXISTS \`UpstreamChannel\``,
        `SET FOREIGN_KEY_CHECKS = 1`
      ]
    };
  }

  return {
    create: [
      `
        CREATE TABLE IF NOT EXISTS "UpstreamChannel" (
          "id" SERIAL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "provider" TEXT NOT NULL DEFAULT 'openai',
          "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses',
          "upstreamBaseUrl" TEXT NOT NULL,
          "upstreamApiKey" TEXT,
          "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]',
          "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
          "supportsVision" BOOLEAN NOT NULL DEFAULT true,
          "visionModel" TEXT,
          "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
          "enabled" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS "ProviderKey" (
          "id" SERIAL PRIMARY KEY,
          "name" TEXT NOT NULL,
          "localKey" TEXT NOT NULL,
          "upstreamChannelId" INTEGER,
          "provider" TEXT NOT NULL DEFAULT 'openai',
          "wireApi" TEXT NOT NULL DEFAULT 'responses',
          "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses',
          "upstreamBaseUrl" TEXT NOT NULL,
          "upstreamApiKey" TEXT,
          "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]',
          "modelMappingsJson" TEXT NOT NULL DEFAULT '[]',
          "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
          "supportsVision" BOOLEAN NOT NULL DEFAULT true,
          "visionModel" TEXT,
          "dynamicModelSwitch" BOOLEAN NOT NULL DEFAULT false,
          "contextSwitchThreshold" INTEGER NOT NULL DEFAULT 12000,
          "contextOverflowModel" TEXT,
          "activeModelOverride" TEXT,
          "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
          "enabled" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "ProviderKey_upstreamChannelId_fkey"
            FOREIGN KEY ("upstreamChannelId") REFERENCES "UpstreamChannel"("id")
            ON DELETE SET NULL ON UPDATE CASCADE
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS "TokenUsageEvent" (
          "id" SERIAL PRIMARY KEY,
          "keyId" INTEGER NOT NULL,
          "keyName" TEXT NOT NULL,
          "route" TEXT NOT NULL,
          "requestWireApi" TEXT NOT NULL,
          "upstreamWireApi" TEXT NOT NULL,
          "requestedModel" TEXT NOT NULL,
          "clientModel" TEXT NOT NULL,
          "upstreamModel" TEXT NOT NULL,
          "stream" BOOLEAN NOT NULL DEFAULT false,
          "promptTokens" INTEGER NOT NULL DEFAULT 0,
          "completionTokens" INTEGER NOT NULL DEFAULT 0,
          "totalTokens" INTEGER NOT NULL DEFAULT 0,
          "minuteBucket" TIMESTAMP(3) NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TokenUsageEvent_keyId_fkey"
            FOREIGN KEY ("keyId") REFERENCES "ProviderKey"("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        )
      `
    ],
    patch: [
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "upstreamChannelId" INTEGER`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses'`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "modelMappingsJson" TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "supportsVision" BOOLEAN NOT NULL DEFAULT true`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "visionModel" TEXT`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "dynamicModelSwitch" BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "contextSwitchThreshold" INTEGER NOT NULL DEFAULT 12000`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "contextOverflowModel" TEXT`,
      `ALTER TABLE "ProviderKey" ADD COLUMN IF NOT EXISTS "activeModelOverride" TEXT`
    ],
    index: [
      `CREATE UNIQUE INDEX IF NOT EXISTS "ProviderKey_localKey_key" ON "ProviderKey"("localKey")`,
      `CREATE INDEX IF NOT EXISTS "ProviderKey_upstreamChannelId_idx" ON "ProviderKey"("upstreamChannelId")`,
      `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_minuteBucket_idx" ON "TokenUsageEvent"("minuteBucket")`,
      `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_minuteBucket_idx" ON "TokenUsageEvent"("keyId", "minuteBucket")`,
      `CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_clientModel_minuteBucket_idx" ON "TokenUsageEvent"("keyId", "clientModel", "minuteBucket")`
    ],
    reset: [
      `DROP TABLE IF EXISTS "TokenUsageEvent" CASCADE`,
      `DROP TABLE IF EXISTS "ProviderKey" CASCADE`,
      `DROP TABLE IF EXISTS "UpstreamChannel" CASCADE`
    ]
  };
}

async function runStatements(prisma, statements, ignoreErrors = false) {
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (error) {
      if (!ignoreErrors) {
        throw error;
      }
    }
  }
}

function parseLegacyConfigRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  return {
    upstreamBaseUrl:
      typeof row.upstreamBaseUrl === "string" && row.upstreamBaseUrl.trim()
        ? row.upstreamBaseUrl
        : null,
    upstreamApiKey: typeof row.upstreamApiKey === "string" ? row.upstreamApiKey : null,
    defaultModel:
      typeof row.defaultModel === "string" && row.defaultModel.trim()
        ? row.defaultModel
        : null,
    timeoutMs: typeof row.timeoutMs === "number" ? row.timeoutMs : null
  };
}

async function readLegacyConfig(prisma, provider) {
  if (provider !== "sqlite") {
    return null;
  }

  const rows = await prisma
    .$queryRawUnsafe(
      `
        SELECT "upstreamBaseUrl", "upstreamApiKey", "defaultModel", "timeoutMs"
        FROM "AppConfig"
        WHERE "id" = 1
        LIMIT 1
      `
    )
    .catch(() => []);

  return parseLegacyConfigRow(Array.isArray(rows) ? rows[0] : null);
}

async function seedDefaultData(prisma, provider) {
  const providerKeyCount = await prisma.providerKey.count();

  if (providerKeyCount === 0) {
    const legacyConfig = await readLegacyConfig(prisma, provider);
    const localKey = `sk-${randomBytes(24).toString("hex")}`;
    const defaultModel = legacyConfig?.defaultModel ?? "gpt-4.1-mini";
    const defaultBaseUrl = legacyConfig?.upstreamBaseUrl ?? "https://api.openai.com";
    const defaultTimeout = legacyConfig?.timeoutMs ?? 60000;
    const upstreamModelsJson = JSON.stringify([
      {
        id: "default-openai-model",
        name: "默认主模型",
        model: defaultModel,
        upstreamWireApi: "responses",
        supportsVision: true,
        visionModel: null,
        enabled: true
      }
    ]);

    const defaultChannel = await prisma.upstreamChannel.create({
      data: {
        name: "default-openai-channel",
        provider: "openai",
        upstreamWireApi: "responses",
        upstreamBaseUrl: defaultBaseUrl,
        upstreamApiKey: legacyConfig?.upstreamApiKey ?? null,
        upstreamModelsJson,
        defaultModel,
        supportsVision: true,
        visionModel: null,
        timeoutMs: defaultTimeout,
        enabled: true
      }
    });

    await prisma.providerKey.create({
      data: {
        name: "default-openai",
        localKey,
        upstreamChannelId: defaultChannel.id,
        provider: "openai",
        wireApi: "responses",
        upstreamWireApi: "responses",
        upstreamBaseUrl: defaultBaseUrl,
        upstreamApiKey: legacyConfig?.upstreamApiKey ?? null,
        upstreamModelsJson,
        modelMappingsJson: "[]",
        defaultModel,
        supportsVision: true,
        visionModel: null,
        dynamicModelSwitch: false,
        contextSwitchThreshold: 12000,
        contextOverflowModel: null,
        activeModelOverride: null,
        timeoutMs: defaultTimeout,
        enabled: true
      }
    });

    process.stdout.write(
      [
        "Created initial local key entry:",
        "- name: default-openai",
        `- local key: ${localKey}`,
        "- provider: openai",
        "- Configure upstreamApiKey in web console if empty."
      ].join("\n") + "\n"
    );
  }

  const keysWithoutChannel = await prisma.providerKey.findMany({
    where: {
      upstreamChannelId: null
    }
  });

  for (const key of keysWithoutChannel) {
    const channel = await prisma.upstreamChannel.create({
      data: {
        name: `${key.name}-channel`,
        provider: key.provider,
        upstreamWireApi: key.upstreamWireApi,
        upstreamBaseUrl: key.upstreamBaseUrl,
        upstreamApiKey: key.upstreamApiKey,
        upstreamModelsJson: key.upstreamModelsJson || "[]",
        defaultModel: key.defaultModel,
        supportsVision: key.supportsVision,
        visionModel: key.visionModel,
        timeoutMs: key.timeoutMs,
        enabled: key.enabled
      }
    });

    await prisma.providerKey.update({
      where: { id: key.id },
      data: { upstreamChannelId: channel.id }
    });
  }
}

async function main() {
  const reset = process.argv.includes("--reset");
  const provider = resolveDatabaseProvider();
  const databaseUrl = ensureDatabaseUrl(provider);

  if (provider === "sqlite") {
    const dbPath = resolveSqlitePath(databaseUrl);
    mkdirSync(path.dirname(dbPath), { recursive: true });

    if (reset) {
      cleanupSqliteDatabase(dbPath);
    }
  }

  const prisma = new PrismaClient();

  try {
    const statements = statementsByProvider(provider);

    if (reset && provider !== "sqlite") {
      await runStatements(prisma, statements.reset, true);
    }

    await runStatements(prisma, statements.create, false);
    await runStatements(prisma, statements.patch, true);
    await runStatements(prisma, statements.index, true);

    await seedDefaultData(prisma, provider);

    process.stdout.write(
      `Initialized database with provider=${provider}, url=${process.env.DATABASE_URL}\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`init-db failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
