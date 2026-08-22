import { Hono } from "hono";

import type { RelationshipDefinitionController } from "./RelationshipDefinitionController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

// Flat `/:projectId/relationship-definitions` — the vocabulary belongs to the
// PROJECT rather than to any one entity, so it hangs under none of them.
export function createRelationshipDefinitionRoutes({
  relationshipDefinitionController,
}: {
  relationshipDefinitionController: RelationshipDefinitionController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/relationship-definitions", (c) =>
    relationshipDefinitionController.createDefinition(c),
  );
  routes.get("/:projectId/relationship-definitions", (c) =>
    relationshipDefinitionController.listDefinitions(c),
  );

  return routes;
}
