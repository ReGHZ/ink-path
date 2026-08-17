import { z } from "zod";

import {
  narrativeTransitionDescriptionSchema,
  narrativeTransitionTitleSchema,
} from "./transitionFieldSchemas.js";

// Both fields optional — the Phase 4-6 partial-update shape, NOT the
// required-but-nullable shape `updateRelationshipSchema` uses. The difference is
// forced by what is underneath, not by taste: `note` is the single mutable field
// of a relationship, so an empty body there is a request that asks for nothing
// and deserves a 400. Here the service already distinguishes "asked for nothing"
// from "asked for the value it already has" — `updateDetails()` returns whether
// anything changed and the row is left untouched, `updated_at` included, when
// nothing did (`NarrativeTransition.ts:181-196`, `NarrativeTransitionService.ts:315-332`).
// Turning an empty body into a 400 at this layer would hide a behaviour that is
// tested and intended.
//
// `description: nullish` carries THREE readings and the mapper must preserve all
// three: omitted = leave it alone, null = clear it, string = set it. That is why
// the mapper passes `dto.description` through verbatim instead of `?? null`,
// which would silently turn "leave it alone" into "clear it".
//
// `title` has no null case: it is NOT NULL in the database (`16:62`) and the
// only thing a reader sees in a list, so there is nothing to clear it to.
export const updateTransitionSchema = z
  .object({
    title: narrativeTransitionTitleSchema.optional(),
    description: narrativeTransitionDescriptionSchema.nullish(),
  })
  .strict();

export type UpdateTransitionRequestDto = z.infer<typeof updateTransitionSchema>;
