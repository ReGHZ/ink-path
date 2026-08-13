import { Hono } from "hono";

import type { LayerController } from "./LayerController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createLayerRoutes({
  layerController,
}: {
  layerController: LayerController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/layers", (c) => layerController.createLayer(c));
  routes.get("/:projectId/layers", (c) => layerController.listLayers(c));
  routes.get("/:projectId/layers/:layerId", (c) =>
    layerController.getLayer(c),
  );
  routes.patch("/:projectId/layers/:layerId", (c) =>
    layerController.updateLayer(c),
  );
  routes.patch("/:projectId/layers/:layerId/status", (c) =>
    layerController.changeLayerStatus(c),
  );
  routes.delete("/:projectId/layers/:layerId", (c) =>
    layerController.deleteLayer(c),
  );

  return routes;
}
