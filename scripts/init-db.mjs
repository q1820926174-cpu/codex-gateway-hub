import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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

async function main() {
  const dbPath = resolveSqlitePath(process.env.DATABASE_URL);
  const reset = process.argv.includes("--reset");

  mkdirSync(path.dirname(dbPath), { recursive: true });
  if (reset) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-journal`, { force: true });
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}`
      }
    }
  });

  try {
    await prisma.$executeRawUnsafe(`
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
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await prisma.$executeRawUnsafe(`
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
    `);

    await prisma.$executeRawUnsafe(`
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
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "upstreamChannelId" INTEGER
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "upstreamWireApi" TEXT NOT NULL DEFAULT 'responses'
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "upstreamModelsJson" TEXT NOT NULL DEFAULT '[]'
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "modelMappingsJson" TEXT NOT NULL DEFAULT '[]'
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "supportsVision" BOOLEAN NOT NULL DEFAULT true
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "visionModel" TEXT
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "dynamicModelSwitch" BOOLEAN NOT NULL DEFAULT false
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "contextSwitchThreshold" INTEGER NOT NULL DEFAULT 12000
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "contextOverflowModel" TEXT
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ProviderKey"
      ADD COLUMN "activeModelOverride" TEXT
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ProviderKey_localKey_key"
      ON "ProviderKey"("localKey")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "ProviderKey_upstreamChannelId_idx"
      ON "ProviderKey"("upstreamChannelId")
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TokenUsageEvent_minuteBucket_idx"
      ON "TokenUsageEvent"("minuteBucket")
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_minuteBucket_idx"
      ON "TokenUsageEvent"("keyId", "minuteBucket")
    `).catch(() => {});

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "TokenUsageEvent_keyId_clientModel_minuteBucket_idx"
      ON "TokenUsageEvent"("keyId", "clientModel", "minuteBucket")
    `).catch(() => {});

    const providerKeyCount = await prisma.providerKey.count();

    if (providerKeyCount === 0) {
      const legacyConfigRows = await prisma.$queryRawUnsafe(`
        SELECT "upstreamBaseUrl", "upstreamApiKey", "defaultModel", "timeoutMs"
        FROM "AppConfig"
        WHERE "id" = 1
        LIMIT 1
      `).catch(() => []);

      const legacyConfig = Array.isArray(legacyConfigRows) ? legacyConfigRows[0] : null;
      const localKey = `sk-${randomBytes(24).toString("hex")}`;
      const defaultModel =
        legacyConfig && typeof legacyConfig.defaultModel === "string"
          ? legacyConfig.defaultModel
          : "gpt-4.1-mini";
      const defaultBaseUrl =
        legacyConfig && typeof legacyConfig.upstreamBaseUrl === "string"
          ? legacyConfig.upstreamBaseUrl
          : "https://api.openai.com";
      const defaultTimeout =
        legacyConfig && typeof legacyConfig.timeoutMs === "number"
          ? legacyConfig.timeoutMs
          : 60000;
      const defaultChannel = await prisma.upstreamChannel.create({
        data: {
          name: "default-openai-channel",
          provider: "openai",
          upstreamWireApi: "responses",
          upstreamBaseUrl: defaultBaseUrl,
          upstreamApiKey:
            legacyConfig && typeof legacyConfig.upstreamApiKey === "string"
              ? legacyConfig.upstreamApiKey
              : null,
          upstreamModelsJson: JSON.stringify([
            {
              id: "default-openai-model",
              name: "默认主模型",
              model: defaultModel,
              upstreamWireApi: "responses",
              supportsVision: true,
              visionModel: null,
              enabled: true
            }
          ]),
          modelMappingsJson: "[]",
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
          upstreamApiKey:
            legacyConfig && typeof legacyConfig.upstreamApiKey === "string"
              ? legacyConfig.upstreamApiKey
              : null,
          upstreamModelsJson: JSON.stringify([
            {
              id: "default-openai-model",
              name: "默认主模型",
              model: defaultModel,
              upstreamWireApi: "responses",
              supportsVision: true,
              visionModel: null,
              enabled: true
            }
          ]),
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
          `- name: default-openai`,
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

    process.stdout.write(`Initialized SQLite at ${dbPath}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`init-db failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
