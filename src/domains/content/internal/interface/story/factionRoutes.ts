import { Hono } from "hono";

import type { FactionController } from "./FactionController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createFactionRoutes({
  factionController,
}: {
  factionController: FactionController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/factions", (c) =>
    factionController.createFaction(c),
  );
  routes.get("/:projectId/factions", (c) =>
    factionController.listFactions(c),
  );
  routes.get("/:projectId/factions/:factionId", (c) =>
    factionController.getFaction(c),
  );
  routes.patch("/:projectId/factions/:factionId", (c) =>
    factionController.updateFaction(c),
  );
  routes.patch("/:projectId/factions/:factionId/status", (c) =>
    factionController.changeFactionStatus(c),
  );
  routes.delete("/:projectId/factions/:factionId", (c) =>
    factionController.deleteFaction(c),
  );

  return routes;
}
