import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma/client";
import env from "../config/env";
import { logger } from "./logger";

// MariaDB driver-level connection pool is configured via the DATABASE_URL query string:
//   ?connection_limit=10&pool_timeout=30
const adapter = new PrismaMariaDb(env.database_url);

const prisma = new PrismaClient({
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

// Log slow queries in development (threshold: 500ms)
if (env.node_env === "development") {
  prisma.$on("query", (e) => {
    if (e.duration >= 500) {
      logger.warn({ durationMs: e.duration, query: e.query }, "slow query");
    }
  });
}

export { prisma };
