import { Hono } from "hono";

import { NESTED_RELATIONSHIP_ROUTES } from "./nestedRelationshipRoutes.js";
import { CONTENT_ENTITY_TYPES } from "../../domain/support/ContentRevision.js";

import type { RelationshipController } from "./RelationshipController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

export function createRelationshipRoutes({
  relationshipController,
}: {
  relationshipController: RelationshipController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/relationships", (c) =>
    relationshipController.createRelationship(c),
  );
  routes.get("/:projectId/relationships/:relationshipId", (c) =>
    relationshipController.getRelationship(c),
  );
  routes.patch("/:projectId/relationships/:relationshipId", (c) =>
    relationshipController.updateRelationshipNote(c),
  );
  routes.delete("/:projectId/relationships/:relationshipId", (c) =>
    relationshipController.deleteRelationship(c),
  );

  // The nine nested list routes, generated from the domain's own entity-type
  // list so none can be forgotten. Iterating `CONTENT_ENTITY_TYPES` rather than
  // `Object.keys(NESTED_RELATIONSHIP_ROUTES)` keeps `entityType` narrowed to
  // `ContentEntityType` with no cast, and the table's `satisfies` clause
  // guarantees the lookup below is total.
  for (const entityType of CONTENT_ENTITY_TYPES) {
    const { segment, parameterName } = NESTED_RELATIONSHIP_ROUTES[entityType];

    routes.get(
      `/:projectId/${segment}/:${parameterName}/relationships`,
      // `entityType` is captured from the loop, i.e. from the table — the
      // handler never parses the entity type out of the URL.
      (c) => relationshipController.listRelationshipsByEntity(c, entityType),
    );
  }

  return routes;
}
