import { z } from "zod";

import {
  narrativeTransitionDescriptionSchema,
  narrativeTransitionIdSchema,
  narrativeTransitionSourceTypeSchema,
  narrativeTransitionTitleSchema,
} from "./transitionFieldSchemas.js";
import { contentEntityIdSchema } from "../support/relationshipFieldSchemas.js";

// The source travels in the BODY, unlike every Phase 4-6 create where the parent
// arrives in the path. A transition can be declared from three different entity
// types into ONE table, so a path-shaped form would need three collection routes
// writing the same rows and three ways to get the type wrong. Validating the
// type here costs one enum; the service still proves the row exists, is of that
// type and lives in this project before anything is written
// (`NarrativeTransitionService.ts:208-217`).
//
// `contentEntityIdSchema` is imported rather than restated: it is the generic
// "id of a content entity in a request body" rule, and it happens to live beside
// the relationship DTOs because they needed it first. Two copies of one uuid
// rule is how the two paths start answering differently.
export const declareTransitionSchema = z
  .object({
    sourceEntityType: narrativeTransitionSourceTypeSchema,
    sourceEntityId: contentEntityIdSchema,
    title: narrativeTransitionTitleSchema,
    // `nullish`, not `optional`: omitted and explicit null both mean "no
    // description", and the domain already normalises the pair
    // (`NarrativeTransition.ts:118-119`). This is a CREATE, so there is no third
    // reading — "leave it alone" has nothing to leave alone.
    description: narrativeTransitionDescriptionSchema.nullish(),
    // A reversal is DECLARED, never inferred: undoing a transition means
    // declaring a new one that points at the one it reverses
    // (`05-implementation-policy/05_append_only_invariants.md`). The service
    // checks the pointer resolves inside this project before the row is written
    // (`NarrativeTransitionService.ts:219-224`), which is why an id from another
    // tenant cannot be smuggled in here.
    reversesTransitionId: narrativeTransitionIdSchema.nullish(),
  })
  .strict();

export type DeclareTransitionRequestDto = z.infer<
  typeof declareTransitionSchema
>;
