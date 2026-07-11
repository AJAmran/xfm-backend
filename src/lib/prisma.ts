import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma/client";
import env from "../config/env";

// MariaDB driver-level connection pool is configured via the DATABASE_URL query string:
//   ?connection_limit=10&pool_timeout=30
// See: https://www.prisma.io/docs/orm/overview/databases/mysql
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
      console.warn(`[SLOW QUERY] ${e.duration}ms — ${e.query}`);
    }
  });
}

export { prisma };
