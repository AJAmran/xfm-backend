import app from "./app";
import env from "./config/env";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";

async function main() {
  try {
    await prisma.$connect();
    logger.info("database connected successfully");

    const server = app.listen(env.port, () => {
      logger.info({ port: env.port, nodeEnv: env.node_env }, "server started");
    });

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

if (!process.env.VERCEL) {
  main();
}
