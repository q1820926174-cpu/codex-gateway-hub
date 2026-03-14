import { PrismaClient } from "@prisma/client";

// Global variable for Prisma client in development mode (prevents hot reload issues)
// 开发模式下的 Prisma 客户端全局变量（防止热重载问题）
declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// Infer database provider type from DATABASE_URL
// 从 DATABASE_URL 推断数据库提供商类型
function inferDatabaseProvider() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgresql";
  if (url.startsWith("mysql://")) return "mysql";
  return "sqlite";
}

// Set DATABASE_PROVIDER environment variable if not provided
// 如果未提供 DATABASE_PROVIDER 环境变量，则自动设置
if (!process.env.DATABASE_PROVIDER) {
  process.env.DATABASE_PROVIDER = inferDatabaseProvider();
}

// Create or reuse Prisma client instance
// 创建或复用 Prisma 客户端实例
export const prisma = globalThis.prismaGlobal ?? new PrismaClient();

// Save Prisma client to global variable in development for hot reload
// 在开发模式下将 Prisma 客户端保存到全局变量以支持热重载
if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
