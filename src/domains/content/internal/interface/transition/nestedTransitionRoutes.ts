import { NESTED_RELATIONSHIP_ROUTES } from "../support/nestedRelationshipRoutes.js";

import type { NarrativeTransitionSourceType } from "../../domain/transition/NarrativeTransition.js";

export type NestedTransitionRoute = {
  segment: string;
  parameterName: string;
  notFoundMessage: string;
};

// The three nested list routes as DATA, keyed by the source type they carry —
// same device as `NESTED_RELATIONSHIP_ROUTES`, and for the same two reasons:
// `satisfies Record<NarrativeTransitionSourceType, …>` makes a fourth source
// type a BUILD failure until its route is declared, and `sourceEntityType`
// reaches the controller as a compile-time constant taken from these keys rather
// than parsed out of the URL (K6).
//
// The three entries are BORROWED from the relationship table instead of being
// retyped, and that is the load-bearing part. `/scenes/:sceneId` is one fact
// about how a scene appears in a URL, not one fact per feature that links to it:
// two copies would let `/scenes/:sceneId/relationships` and
// `/scenes/:sceneId/narrative-transitions` drift apart under a rename, and the
// drift would be invisible — both files compile, both routers mount, only the
// URLs disagree. The `notFoundMessage`es come along for the same reason they
// were centralised there: a missing scene must answer identically on every route
// that names one.
//
// What is NOT borrowed is the shape of the guarantee. That table is total over
// ContentEntityType (nine); this one is total over the three source types, which
// is a strict subset — a Layer is a target, never a cause
// (`NarrativeTransition.ts:20-29`). Picking the three by name here is what makes
// that subset explicit and checkable, and it is why this is a new table rather
// than a re-export.
export const NESTED_TRANSITION_ROUTES = {
  scene: NESTED_RELATIONSHIP_ROUTES.scene,
  event: NESTED_RELATIONSHIP_ROUTES.event,
  chapter: NESTED_RELATIONSHIP_ROUTES.chapter,
} as const satisfies Record<NarrativeTransitionSourceType, NestedTransitionRoute>;
