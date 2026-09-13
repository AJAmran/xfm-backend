import app from "./app";
import env from "./config/env";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import {
  getDashboardSummary,
  getRatingAnalytics,
  getBranchPerformance,
  getMonthlyTrends,
  getCustomerSatisfaction,
} from "./modules/analytics/analytics.service";
import { getOperationalWidgets } from "./modules/dashboard/dashboard.service";

/**
 * Warms the default (admin, no-filter) analytics + operational caches in the
 * background so the first dashboard render after a boot is a cache hit instead
 * of paying the full cold-query cost on the user's request. Non-blocking.
 */
function prewarmCaches(): void {
  void Promise.allSettled([
    getDashboardSummary(),
    getRatingAnalytics(),
    getBranchPerformance(),
    getMonthlyTrends(),
    getCustomerSatisfaction(),
    getOperationalWidgets(),
  ]).then((results) => {
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.info({ failed }, "analytics cache prewarm complete");
  });
}

async function main() {
  try {
    await prisma.$connect();
    logger.info("database connected successfully");

    const server = app.listen(env.port, () => {
      logger.info({ port: env.port, nodeEnv: env.node_env }, "server started");
    });

    // Start warming the shared caches immediately — it must never block boot.
    prewarmCaches();

    const shutdown = async (signal: string) => {
      logger.info({ signal }, "shutting down gracefully");

      const forcedExit = setTimeout(() => {
        logger.error("forced shutdown after timeout");
        process.exit(1);
      }, 30_000).unref();

      server.close(async () => {
        clearTimeout(forcedExit);
        await prisma.$disconnect();
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error({ err: error }, "failed to start server");
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "uncaught exception");
  process.exit(1);
});

if (!process.env.VERCEL) {
  main();
}
