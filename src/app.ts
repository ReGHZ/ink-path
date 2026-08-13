import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { mountContentModule } from "./domains/content/public/index.js";
import { mountProjectModule } from "./domains/project/public/index.js";
import { mountUserModule } from "./domains/user/public/index.js";
import { handleError } from "./shared/http/errorHandler.js";
import {
  createProjectScopedRouter,
  type ProjectScopedRouter,
} from "./shared/http/projectScopedRouter.js";
import { requestLogger } from "./shared/middleware/RequestMiddleware.js";

import type { AppCradle } from "./infrastructure/container.js";
import type { AppEnvironment } from "./shared/http/context.js";
import type { AwilixContainer } from "awilix";

// Every project-scoped module is mounted HERE, and the finished router is
// returned — deliberately, rather than assembled into a variable in createApp().
//
// `Hono.route()` copies the sub-app's routing table at the moment it is called:
// a route added to the sub-app afterwards is not merely unreachable, it never
// appears in `app.routes` at all (verified: 404, and absent from the table).
// So a `mountXModule(projectScoped, ...)` written one line below the
// `apiV1.route(...)` call would vanish silently — no error, and invisible even
// to the route-protection suite, which can only enumerate what got registered.
// Handing back a finished router removes the window instead of documenting it:
// adding a module means editing inside this function, which is always before
// the return, which is always before route().
function createProjectScopedRoutes(
  container: AwilixContainer<AppCradle>,
): ProjectScopedRouter {
  const router = createProjectScopedRouter({
    authMiddleware: container.resolve("authMiddleware"),
    projectMemberMiddleware: container.resolve("projectMemberMiddleware"),
  });

  mountProjectModule(router, container);
  mountContentModule(router, container);

  return router;
}

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

  // `/projects` and its two middlewares are named in exactly one place — see
  // createProjectScopedRoutes above. Modules cannot be mounted anywhere else:
  // their signatures accept ProjectScopedRouter, a branded type only
  // createProjectScopedRouter() produces.
  apiV1.route("/projects", createProjectScopedRoutes(container));

  app.route("/api/v1", apiV1);

  return app;
}

export type App = ReturnType<typeof createApp>;
