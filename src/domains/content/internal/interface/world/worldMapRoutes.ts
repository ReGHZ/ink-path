import { Hono, type MiddlewareHandler } from "hono";

import type { WorldMapController } from "./WorldMapController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createWorldMapRoutes({
  worldMapController,
  authMiddleware,
  projectMemberMiddleware,
}: {
  worldMapController: WorldMapController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.use("*", authMiddleware);
  routes.use("/:projectId/*", projectMemberMiddleware);

  routes.post("/:projectId/world-maps", (c) =>
    worldMapController.createWorldMap(c),
  );
  routes.get("/:projectId/world-maps", (c) =>
    worldMapController.listWorldMaps(c),
  );
  routes.get("/:projectId/world-maps/:worldMapId", (c) =>
    worldMapController.getWorldMap(c),
  );
  routes.patch("/:projectId/world-maps/:worldMapId", (c) =>
    worldMapController.updateWorldMap(c),
  );
  routes.patch("/:projectId/world-maps/:worldMapId/status", (c) =>
    worldMapController.changeWorldMapStatus(c),
  );
  routes.delete("/:projectId/world-maps/:worldMapId", (c) =>
    worldMapController.deleteWorldMap(c),
  );

  return routes;
}
