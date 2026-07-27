import { Hono, type MiddlewareHandler } from "hono";

import type { WorldElementController } from "./WorldElementController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createWorldElementRoutes({
  worldElementController,
  authMiddleware,
  projectMemberMiddleware,
}: {
  worldElementController: WorldElementController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.use("*", authMiddleware);
  routes.use("/:projectId/*", projectMemberMiddleware);

  routes.post("/:projectId/world-elements", (c) =>
    worldElementController.createWorldElement(c),
  );
  routes.get("/:projectId/world-elements", (c) =>
    worldElementController.listWorldElements(c),
  );
  routes.get("/:projectId/world-elements/:worldElementId", (c) =>
    worldElementController.getWorldElement(c),
  );
  routes.patch("/:projectId/world-elements/:worldElementId", (c) =>
    worldElementController.updateWorldElement(c),
  );
  routes.patch("/:projectId/world-elements/:worldElementId/status", (c) =>
    worldElementController.changeWorldElementStatus(c),
  );
  routes.delete("/:projectId/world-elements/:worldElementId", (c) =>
    worldElementController.deleteWorldElement(c),
  );

  return routes;
}
