import { mkdirSync, writeFileSync } from "node:fs";
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

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/db-export.mjs --output <file>",
      "",
      "Environment:",
      "  DATABASE_PROVIDER=sqlite",
      "  DATABASE_URL=file:./dev.db"
    ].join("\n") + "\n"
  );
}

function resolveProvider() {
  const provider = (process.env.DATABASE_PROVIDER ?? "").trim().toLowerCase();
  if (provider !== "sqlite") {
    throw new Error(`db-export only supports sqlite source, got DATABASE_PROVIDER=${provider || "(empty)"}`);
  }
}

function normalizeOutputPath(value) {
  if (!value) {
    throw new Error("Missing required argument: --output <file>");
  }
  const outputPath = path.resolve(process.cwd(), value);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  return outputPath;
}

function toIsoDate(value, fieldName) {
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) {
    throw new Error(`Invalid date value in field "${fieldName}"`);
  }
  return dateValue.toISOString();
}

function serializeChannels(rows) {
  return rows.map((row) => ({
    ...row,
    createdAt: toIsoDate(row.createdAt, "UpstreamChannel.createdAt"),
    updatedAt: toIsoDate(row.updatedAt, "UpstreamChannel.updatedAt")
  }));
}

function serializeKeys(rows) {
  return rows.map((row) => ({
    ...row,
    createdAt: toIsoDate(row.createdAt, "ProviderKey.createdAt"),
    updatedAt: toIsoDate(row.updatedAt, "ProviderKey.updatedAt")
  }));
}

function serializeUsageEvents(rows) {
  return rows.map((row) => ({
    ...row,
    minuteBucket: toIsoDate(row.minuteBucket, "TokenUsageEvent.minuteBucket"),
    createdAt: toIsoDate(row.createdAt, "TokenUsageEvent.createdAt")
  }));
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  resolveProvider();
  const outputPath = normalizeOutputPath(getArgValue("--output"));
  const prisma = new PrismaClient();

  try {
    const [channels, keys, usageEvents] = await Promise.all([
      prisma.upstreamChannel.findMany({ orderBy: { id: "asc" } }),
      prisma.providerKey.findMany({ orderBy: { id: "asc" } }),
      prisma.tokenUsageEvent.findMany({ orderBy: { id: "asc" } })
    ]);

    const payload = {
      meta: {
        sourceProvider: "sqlite",
        sourceDatabaseUrl: process.env.DATABASE_URL ?? "",
        exportedAt: new Date().toISOString(),
        counts: {
          upstreamChannels: channels.length,
          providerKeys: keys.length,
          tokenUsageEvents: usageEvents.length
        }
      },
      upstreamChannels: serializeChannels(channels),
      providerKeys: serializeKeys(keys),
      tokenUsageEvents: serializeUsageEvents(usageEvents)
    };

    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    process.stdout.write(
      `Exported sqlite data to ${outputPath} (channels=${channels.length}, keys=${keys.length}, usageEvents=${usageEvents.length})\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`db-export failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
