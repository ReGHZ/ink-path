import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { createAppContainer } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logger.js";

const DEFAULT_PORT = 4004;

function readPort() {
  const rawPort = process.env.PORT;

  if (rawPort === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

const container = createAppContainer();
const app = createApp(container);
const port = readPort();

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    logger.info(`API server listening on http://localhost:${info.port}`);
  },
);

function shutdown(signal: NodeJS.Signals) {
  logger.info(`Received ${signal}. Shutting down API server.`);

  server.close(async (error?: Error | null) => {
    if (error) {
      logger.error(error, "Failed to close API server gracefully.");
      process.exit(1);
    }

    try {
      const prisma = container.resolve("prisma");
      await prisma.$disconnect();
      logger.info("Prisma disconnected successfully.");
    } catch (disconnectError) {
      logger.error(disconnectError, "Failed to disconnect Prisma.");
    }

    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
