import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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
      "  node scripts/db-import.mjs --input <file> [--overwrite-target]",
      "",
      "Environment:",
      "  DATABASE_PROVIDER=mysql|postgresql",
      "  DATABASE_URL=<target database url>"
    ].join("\n") + "\n"
  );
}

function resolveProvider() {
  const provider = (process.env.DATABASE_PROVIDER ?? "").trim().toLowerCase();
  if (provider !== "mysql" && provider !== "postgresql") {
    throw new Error(
      `db-import only supports mysql/postgresql target, got DATABASE_PROVIDER=${provider || "(empty)"}`
    );
  }
  return provider;
}

function normalizeInputPath(value) {
  if (!value) {
    throw new Error("Missing required argument: --input <file>");
  }
  return path.resolve(process.cwd(), value);
}

function parseDate(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value in "${fieldName}"`);
  }
  return parsed;
}

function normalizeChannels(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid payload: upstreamChannels must be an array");
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider,
    upstreamWireApi: row.upstreamWireApi,
    upstreamBaseUrl: row.upstreamBaseUrl,
    upstreamApiKey: row.upstreamApiKey ?? null,
    upstreamModelsJson: row.upstreamModelsJson,
    defaultModel: row.defaultModel,
    supportsVision: Boolean(row.supportsVision),
    visionModel: row.visionModel ?? null,
    timeoutMs: row.timeoutMs,
    enabled: Boolean(row.enabled),
    createdAt: parseDate(row.createdAt, "upstreamChannels.createdAt"),
    updatedAt: parseDate(row.updatedAt, "upstreamChannels.updatedAt")
  }));
}

function normalizeKeys(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid payload: providerKeys must be an array");
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    localKey: row.localKey,
    upstreamChannelId: row.upstreamChannelId ?? null,
    provider: row.provider,
    wireApi: row.wireApi,
    upstreamWireApi: row.upstreamWireApi,
    upstreamBaseUrl: row.upstreamBaseUrl,
    upstreamApiKey: row.upstreamApiKey ?? null,
    upstreamModelsJson: row.upstreamModelsJson,
    modelMappingsJson: row.modelMappingsJson,
    defaultModel: row.defaultModel,
    supportsVision: Boolean(row.supportsVision),
    visionModel: row.visionModel ?? null,
    dynamicModelSwitch: Boolean(row.dynamicModelSwitch),
    contextSwitchThreshold: row.contextSwitchThreshold,
    contextOverflowModel: row.contextOverflowModel ?? null,
    activeModelOverride: row.activeModelOverride ?? null,
    timeoutMs: row.timeoutMs,
    enabled: Boolean(row.enabled),
    createdAt: parseDate(row.createdAt, "providerKeys.createdAt"),
    updatedAt: parseDate(row.updatedAt, "providerKeys.updatedAt")
  }));
}

function normalizeUsageEvents(rows) {
  if (!Array.isArray(rows)) {
    throw new Error("Invalid payload: tokenUsageEvents must be an array");
  }
  return rows.map((row) => ({
    id: row.id,
    keyId: row.keyId,
    keyName: row.keyName,
    route: row.route,
    requestWireApi: row.requestWireApi,
    upstreamWireApi: row.upstreamWireApi,
    requestedModel: row.requestedModel,
    clientModel: row.clientModel,
    upstreamModel: row.upstreamModel,
    stream: Boolean(row.stream),
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    minuteBucket: parseDate(row.minuteBucket, "tokenUsageEvents.minuteBucket"),
    createdAt: parseDate(row.createdAt, "tokenUsageEvents.createdAt")
  }));
}

function reconcileRelations(channels, keys, usageEvents) {
  const channelIdSet = new Set(channels.map((row) => row.id));
  const keyIdSet = new Set(keys.map((row) => row.id));

  let patchedKeyChannelRefs = 0;
  const reconciledKeys = keys.map((row) => {
    if (row.upstreamChannelId == null) {
      return row;
    }
    if (channelIdSet.has(row.upstreamChannelId)) {
      return row;
    }
    patchedKeyChannelRefs += 1;
    return {
      ...row,
      upstreamChannelId: null
    };
  });

  const reconciledUsageEvents = usageEvents.filter((row) => keyIdSet.has(row.keyId));
  const skippedUsageEvents = usageEvents.length - reconciledUsageEvents.length;

  return {
    keys: reconciledKeys,
    usageEvents: reconciledUsageEvents,
    patchedKeyChannelRefs,
    skippedUsageEvents
  };
}

function chunkArray(rows, chunkSize) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

async function createManyInChunks(delegate, rows, chunkSize = 500) {
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    if (chunk.length === 0) {
      continue;
    }
    await delegate.createMany({ data: chunk });
  }
}

async function loadTargetCounts(prisma) {
  const [upstreamChannelCount, providerKeyCount, tokenUsageEventCount] = await Promise.all([
    prisma.upstreamChannel.count(),
    prisma.providerKey.count(),
    prisma.tokenUsageEvent.count()
  ]);

  return {
    upstreamChannelCount,
    providerKeyCount,
    tokenUsageEventCount
  };
}

function formatCounts(counts) {
  return [
    `upstreamChannels=${counts.upstreamChannelCount}`,
    `providerKeys=${counts.providerKeyCount}`,
    `tokenUsageEvents=${counts.tokenUsageEventCount}`
  ].join(", ");
}

async function syncAutoIncrementState(prisma, provider, channels, keys, usageEvents) {
  const maxChannelId = channels.reduce((maxValue, row) => Math.max(maxValue, row.id ?? 0), 0);
  const maxKeyId = keys.reduce((maxValue, row) => Math.max(maxValue, row.id ?? 0), 0);
  const maxUsageEventId = usageEvents.reduce((maxValue, row) => Math.max(maxValue, row.id ?? 0), 0);

  if (provider === "postgresql") {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"UpstreamChannel"', 'id'), ${Math.max(1, maxChannelId)}, ${
        maxChannelId > 0 ? "true" : "false"
      })`
    );
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"ProviderKey"', 'id'), ${Math.max(1, maxKeyId)}, ${
        maxKeyId > 0 ? "true" : "false"
      })`
    );
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"TokenUsageEvent"', 'id'), ${Math.max(1, maxUsageEventId)}, ${
        maxUsageEventId > 0 ? "true" : "false"
      })`
    );
    return;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`UpstreamChannel\` AUTO_INCREMENT = ${Math.max(1, maxChannelId + 1)}`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`ProviderKey\` AUTO_INCREMENT = ${Math.max(1, maxKeyId + 1)}`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`TokenUsageEvent\` AUTO_INCREMENT = ${Math.max(1, maxUsageEventId + 1)}`
  );
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const provider = resolveProvider();
  const inputPath = normalizeInputPath(getArgValue("--input"));
  const overwriteTarget = hasFlag("--overwrite-target");

  const rawInput = readFileSync(inputPath, "utf8");
  const payload = JSON.parse(rawInput);

  const channels = normalizeChannels(payload.upstreamChannels);
  const keys = normalizeKeys(payload.providerKeys);
  const usageEvents = normalizeUsageEvents(payload.tokenUsageEvents);
  const reconciled = reconcileRelations(channels, keys, usageEvents);

  if (reconciled.patchedKeyChannelRefs > 0) {
    process.stdout.write(
      `Warning: ${reconciled.patchedKeyChannelRefs} ProviderKey rows referenced missing UpstreamChannel and were set to upstreamChannelId=null.\n`
    );
  }
  if (reconciled.skippedUsageEvents > 0) {
    process.stdout.write(
      `Warning: skipped ${reconciled.skippedUsageEvents} TokenUsageEvent rows referencing missing ProviderKey.\n`
    );
  }

  const prisma = new PrismaClient();

  try {
    const existingCounts = await loadTargetCounts(prisma);
    const hasTargetData =
      existingCounts.upstreamChannelCount > 0 ||
      existingCounts.providerKeyCount > 0 ||
      existingCounts.tokenUsageEventCount > 0;

    if (hasTargetData && !overwriteTarget) {
      throw new Error(
        `Target database already has data (${formatCounts(existingCounts)}). Re-run with --overwrite-target to replace existing data.`
      );
    }

    if (hasTargetData && overwriteTarget) {
      await prisma.tokenUsageEvent.deleteMany({});
      await prisma.providerKey.deleteMany({});
      await prisma.upstreamChannel.deleteMany({});
    }

    await createManyInChunks(prisma.upstreamChannel, channels);
    await createManyInChunks(prisma.providerKey, reconciled.keys);
    await createManyInChunks(prisma.tokenUsageEvent, reconciled.usageEvents, 1000);

    await syncAutoIncrementState(prisma, provider, channels, reconciled.keys, reconciled.usageEvents);

    const afterCounts = await loadTargetCounts(prisma);
    process.stdout.write(`Imported data to ${provider} (${formatCounts(afterCounts)})\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`db-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
