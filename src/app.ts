import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { mountProjectModule } from "./domains/project/public/index.js";
import { mountUserModule } from "./domains/user/public/index.js";
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

  const apiV1 = new Hono<AppEnvironment>({ strict: true });

  mountUserModule(apiV1, container);
  mountProjectModule(apiV1, container)
  app.route("/api/v1", apiV1);

  return app;
}

export type App = ReturnType<typeof createApp>;
