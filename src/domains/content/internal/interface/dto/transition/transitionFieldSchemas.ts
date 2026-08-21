import { z } from "zod";

import { NARRATIVE_TRANSITION_SOURCE_TYPES } from "../../../domain/transition/NarrativeTransition.js";

// Built from the domain's own list, not three literals. The three source types
// are a deliberate SUBSET of ContentEntityType — a Layer or a Map is what gets
// AFFECTED, never a cause (`NarrativeTransition.ts:20-36`) — and if that subset
// ever widens, this endpoint must widen with it in the same edit. Same device as
// `contentEntityTypeSchema` reading CONTENT_ENTITY_TYPES.
export const narrativeTransitionSourceTypeSchema = z.enum(
  NARRATIVE_TRANSITION_SOURCE_TYPES,
);

// `title` and `description` are plain TEXT in Postgres
// (`prisma/narrative-transition.prisma:18-19`), so there is no frozen length to
// honour here. The ceilings are borrowed from the nearest Phase 4-6 neighbours
// (`chapterTitleSchema` 255, `factionDescriptionSchema` 2000) rather than
// inventing a third pair of numbers, exactly as `relationshipNoteSchema` did.
//
// `.trim().min(1)`: an all-whitespace title is a 400 here instead of travelling
// to `NarrativeTransition.create()`, which would reject it too but one layer
// later and without naming the offending field.
export const narrativeTransitionTitleSchema = z.string().trim().min(1).max(255);

export const narrativeTransitionDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000);

// A transition id arriving in a BODY (only `reversesTransitionId` does) is a
// data field to validate — 400 — while the same id in a PATH is the identity of
// the addressed resource and answers 404 through `uuidRouteParameterMiddleware`.
// The split is deliberate and is documented once at `contentEntityIdSchema`
// (`../support/relationshipFieldSchemas.ts`); this constant exists so that the
// two id KINDS are not conflated, not to introduce a second rule.
export const narrativeTransitionIdSchema = z.uuid();

// Deliberately NOT an enum over the allowlist, and the asymmetry with
// `narrativeTransitionSourceTypeSchema` directly above is the point (D1/D3).
//
// Which fields a transition may write is per entity TYPE
// (`attributeFieldRegistry.ts`), so a flat enum could not express the rule at
// all; a cross-product enum could, and would still be wrong, because the
// domain's rejection enumerates the writable fields for the target type
// (`Assertion.ts:134-140`) and a Zod enum would answer the identical
// mistake with a different, less useful message. Same reasoning as
// `relationTypeSchema`: rule 1 belongs to the domain, and closing the set here
// would make the registry unenforceable from any entry point that skips Zod.
export const transitionFieldPathSchema = z.string();

// Blankness is rejected WITHOUT trimming, and that pairing is load-bearing.
// `Assertion.create()` stores `new_value` verbatim on purpose — the
// target aggregate's own `updateDetails()` decides what trimming means for its
// field (`Assertion.ts:155-159`) — so a `.trim()` here would store an
// intent that differs from what apply eventually writes. A blank value is still
// a 400: "clear this field" is not expressible through an assertion (`16:112-113`),
// and the domain refuses it too (`Assertion.ts:346-352`).
export const transitionNewValueSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() !== "", {
    message: "New value must not be blank",
  });
