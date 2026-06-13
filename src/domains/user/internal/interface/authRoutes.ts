import { Hono, type MiddlewareHandler } from "hono";

import type { AuthController } from "./AuthController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

export function createAuthRoutes({
  authController,
  authMiddleware,
}: {
  authController: AuthController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/register", (c) => authController.register(c));
  routes.post("/login", (c) => authController.login(c));
  routes.post("/refresh", (c) => authController.refresh(c));
  routes.post("/logout", (c) => authController.logout(c));
  routes.post("/logout-all", authMiddleware, (c) =>
    authController.logoutAll(c),
  );

  return routes;
}
