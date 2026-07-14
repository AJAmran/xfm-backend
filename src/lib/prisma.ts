import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma/client";
import env from "../config/env";
import { logger } from "./logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prismaInstance: PrismaClient;

if (!globalForPrisma.prisma) {
  const dbUrl = new URL(env.database_url);
  const useSsl =
    env.database_ssl !== undefined
      ? env.database_ssl === "true"
      : dbUrl.searchParams.get("ssl-mode") === "REQUIRED";

  const adapter = new PrismaMariaDb({
    host: dbUrl.hostname,
    port: dbUrl.port ? Number(dbUrl.port) : 3306,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.slice(1),
    connectionLimit: 5,
    connectTimeout: 10_000,
    acquireTimeout: 15_000,
    minimumIdle: 1,
    ...(useSsl
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  });

  prismaInstance = new PrismaClient({
    adapter,
    log:
      env.node_env === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [{ emit: "stdout", level: "error" }],
  });

  if (env.node_env === "development") {
    (prismaInstance as any).$on("query", (e: any) => {
      if (e.duration >= 500) {
        logger.warn(
          { durationMs: e.duration, query: e.query, params: e.params },
          "⚠️ Slow query detected!",
        );
      }
    });
  }

  if (env.node_env !== "production") {
    globalForPrisma.prisma = prismaInstance;
  }
} else {
  prismaInstance = globalForPrisma.prisma;
}

export const prisma = prismaInstance;
