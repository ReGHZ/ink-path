import { Hono } from "hono";

import type { PlotController } from "./PlotController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createPlotRoutes({
  plotController,
}: {
  plotController: PlotController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/plots", (c) => plotController.createPlot(c));
  routes.get("/:projectId/plots", (c) => plotController.listPlots(c));
  routes.get("/:projectId/plots/:plotId", (c) => plotController.getPlot(c));
  routes.patch("/:projectId/plots/:plotId", (c) =>
    plotController.updatePlot(c),
  );
  routes.patch("/:projectId/plots/:plotId/status", (c) =>
    plotController.changePlotStatus(c),
  );
  routes.delete("/:projectId/plots/:plotId", (c) =>
    plotController.deletePlot(c),
  );

  return routes;
}
