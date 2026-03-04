import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function inferDatabaseProvider() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgresql";
  if (url.startsWith("mysql://")) return "mysql";
  return "sqlite";
}

if (!process.env.DATABASE_PROVIDER) {
  process.env.DATABASE_PROVIDER = inferDatabaseProvider();
}

export const prisma = globalThis.prismaGlobal ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
