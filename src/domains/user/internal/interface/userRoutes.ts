import { Hono, type MiddlewareHandler } from "hono";

import type { UserController } from "./UserController.js";
import type { AppEnvironment } from "../../../../shared/http/context.js";

export function createUserRoutes({
  userController,
  authMiddleware,
}: {
  userController: UserController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.use("*", authMiddleware);
  routes.get("/me", (c) => userController.getMyProfile(c));
  routes.patch("/me", (c) => userController.updateMyProfile(c));

  return routes;
}
