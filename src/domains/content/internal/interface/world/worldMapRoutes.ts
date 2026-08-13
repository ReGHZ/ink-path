import { Hono } from "hono";

import type { WorldMapController } from "./WorldMapController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createWorldMapRoutes({
  worldMapController,
}: {
  worldMapController: WorldMapController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

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
