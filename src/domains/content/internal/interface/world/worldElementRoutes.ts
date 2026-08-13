import { Hono } from "hono";

import type { WorldElementController } from "./WorldElementController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createWorldElementRoutes({
  worldElementController,
}: {
  worldElementController: WorldElementController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

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
