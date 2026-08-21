import { Hono } from "hono";

import { NESTED_TRANSITION_ROUTES } from "./nestedTransitionRoutes.js";
import {
  NARRATIVE_TRANSITION_ID_PARAMETER,
  ASSERTION_ID_PARAMETER,
} from "./transitionRouteParameters.js";
import { NARRATIVE_TRANSITION_SOURCE_TYPES } from "../../domain/transition/NarrativeTransition.js";

import type { NarrativeTransitionController } from "./NarrativeTransitionController.js";
import type { AppEnvironment } from "../../../../../shared/http/context.js";

// A pure route table: no middleware, because this router can only be mounted on
// a `ProjectScopedRouter`, which is the proof that authentication, the active
// membership check and the uuid path guard already ran (6.5,
// `shared/http/projectScopedRouter.ts`). Every `:…Id` parameter below is
// therefore uuid-guarded without a single per-handler check — which is also why
// each parameter name ENDS in `Id`: that suffix is what the middleware keys on.
export function createNarrativeTransitionRoutes({
  narrativeTransitionController,
}: {
  narrativeTransitionController: NarrativeTransitionController;
}) {
  const routes = new Hono<AppEnvironment>({ strict: true });

  routes.post("/:projectId/narrative-transitions", (c) =>
    narrativeTransitionController.declareTransition(c),
  );
  routes.get("/:projectId/narrative-transitions", (c) =>
    narrativeTransitionController.listTransitions(c),
  );
  routes.get(
    `/:projectId/narrative-transitions/:${NARRATIVE_TRANSITION_ID_PARAMETER}`,
    (c) => narrativeTransitionController.getTransition(c),
  );
  routes.patch(
    `/:projectId/narrative-transitions/:${NARRATIVE_TRANSITION_ID_PARAMETER}`,
    (c) => narrativeTransitionController.updateTransitionDetails(c),
  );
  routes.delete(
    `/:projectId/narrative-transitions/:${NARRATIVE_TRANSITION_ID_PARAMETER}`,
    (c) => narrativeTransitionController.deleteTransition(c),
  );

  // Assertions are declared UNDER their transition — the parent id is what the
  // service needs to attach the row and what it locks while attaching it
  // (7.7 aggregate-root lock).
  routes.post(
    `/:projectId/narrative-transitions/:${NARRATIVE_TRANSITION_ID_PARAMETER}/assertions`,
    (c) => narrativeTransitionController.addAssertion(c),
  );

  // Bulk apply hangs off the transition it applies, next to the assertions
  // collection it drains (D9). It is an action on the aggregate, so it is a POST
  // on the aggregate — not a PATCH of a `status` field, which does not exist:
  // status is derived from the assertions and never stored
  // (`NarrativeTransition.ts:38-49`).
  routes.post(
    `/:projectId/narrative-transitions/:${NARRATIVE_TRANSITION_ID_PARAMETER}/apply`,
    (c) => narrativeTransitionController.applyTransition(c),
  );

  // The two per-assertion operations sit on a FLAT collection instead of under
  // their transition, because the service identifies an assertion by its own id
  // alone (D10, argued at `NarrativeTransitionController.deleteAssertion`). The URL
  // states exactly what is checked and nothing more.
  routes.delete(`/:projectId/assertions/:${ASSERTION_ID_PARAMETER}`, (c) =>
    narrativeTransitionController.deleteAssertion(c),
  );
  routes.post(
    `/:projectId/assertions/:${ASSERTION_ID_PARAMETER}/apply`,
    (c) => narrativeTransitionController.applyAssertion(c),
  );

  // The three nested list routes, generated from the domain's own source-type
  // list so none can be forgotten, and iterating the list rather than the
  // table's keys keeps `sourceEntityType` narrowed with no cast — same
  // construction as the nine nested relationship lists.
  for (const sourceEntityType of NARRATIVE_TRANSITION_SOURCE_TYPES) {
    const { segment, parameterName } = NESTED_TRANSITION_ROUTES[sourceEntityType];

    routes.get(
      `/:projectId/${segment}/:${parameterName}/narrative-transitions`,
      (c) =>
        narrativeTransitionController.listTransitionsBySourceEntity(
          c,
          sourceEntityType,
        ),
    );
  }

  return routes;
}
