import { Hono, type MiddlewareHandler } from "hono";

import type { FactionController } from "./FactionController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createFactionRoutes({
  factionController,
  authMiddleware,
  projectMemberMiddleware,
}: {
  factionController: FactionController;
  authMiddleware: MiddlewareHandler<AppEnvironment>;
  projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.use("*", authMiddleware);
  routes.use("/:projectId/*", projectMemberMiddleware);

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
