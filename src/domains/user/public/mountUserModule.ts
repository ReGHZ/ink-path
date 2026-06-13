import { createAuthRoutes } from "../internal/interface/authRoutes.js";
import { createUserRoutes } from "../internal/interface/userRoutes.js";

import type { AppEnvironment } from "../../../shared/http/context.js";
import type { UserDomainCradle } from "../register.js";
import type { AwilixContainer } from "awilix";
import type { Hono, MiddlewareHandler } from "hono";

type UserModuleCradle = UserDomainCradle & {
  authMiddleware: MiddlewareHandler<AppEnvironment>;
};

export function mountUserModule(
  router: Hono<AppEnvironment>,
  container: AwilixContainer<UserModuleCradle>,
): void {
  const authMiddleware = container.resolve("authMiddleware");

  router.route(
    "/auth",
    createAuthRoutes({
      authController: container.resolve("authController"),
      authMiddleware,
    }),
  );
  router.route(
    "/users",
    createUserRoutes({
      userController: container.resolve("userController"),
      authMiddleware,
    }),
  );
}
