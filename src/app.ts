import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { handleError } from "./shared/http/errorHandler.js";
import { requestLogger } from "./shared/middleware/RequestMiddleware.js";

import type { AppCradle } from "./infrastructure/container.js";
import type { AppEnvironment } from "./shared/http/context.js";
import type { AwilixContainer } from "awilix";

export function createApp(container: AwilixContainer<AppCradle>) {
  const app = new Hono<AppEnvironment>({
    strict: true,
  });

  app.use("*", (c, next) => {
    c.set("container", container);
    return next();
  });

  app.onError(handleError);

  app.use("*", secureHeaders());
  app.use("*", requestLogger);

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      service: "ink-path-api",
      requestId: c.get("requestId"),
    });
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
