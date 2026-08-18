import { z } from "zod";

import { narrativeTransitionSourceTypeSchema } from "./transitionFieldSchemas.js";
import { NARRATIVE_TRANSITION_STATUSES } from "../../../domain/transition/NarrativeTransition.js";
import { ASSERTION_LOG_EFFECT_TYPES } from "../../../domain/transition/TransitionEffect.js";
import { contentEntityTypeSchema } from "../support/relationshipFieldSchemas.js";

// One row of `transition_effects` as the API shows it. Every nullable column is
// nullable HERE too, unflattened: an `attribute_change` carries
// `fieldPath`/`newValue` and nulls for the relationship trio, a relationship
// effect carries the opposite, and the API does not pretend otherwise by
// splitting the response into two shapes. The client discriminates on
// `effectType`, exactly as the domain does.
//
// `appliedAt` and `contentRevisionId` are the provenance pair and both are
// exposed: `appliedAt !== null` is how a caller knows this intent became a fact,
// and `contentRevisionId` is the revision that recorded it — present only for
// applied attribute changes, since a relationship change produces no revision
// (`16:105`, `flow_10:117`). Hiding either would force the client to re-derive
// state the server already knows.
export const transitionEffectResponseSchema = z
  .object({
    id: z.string(),
    narrativeTransitionId: z.string(),
    projectId: z.string(),
    // ALL FIVE since step 4b-2, and the asymmetry with the REQUEST schema is the
    // point: `addEffectSchema` still accepts only the three an author can
    // DECLARE, because declaring is the thing being constrained. A response
    // describes what a stored row IS, and `transition_effects` holds five
    // operations now (premis §8.3). Narrowing here would make the DTO layer the
    // place a legitimate row goes to die — a read path that rejects data the
    // write path was allowed to store.
    effectType: z.enum(ASSERTION_LOG_EFFECT_TYPES),
    targetEntityType: contentEntityTypeSchema,
    targetEntityId: z.string(),
    fieldPath: z.string().nullable(),
    newValue: z.string().nullable(),
    relationshipType: z.string().nullable(),
    relatedEntityType: contentEntityTypeSchema.nullable(),
    relatedEntityId: z.string().nullable(),
    appliedAt: z.date().nullable(),
    contentRevisionId: z.string().nullable(),
    createdAt: z.date(),
  })
  .strict();

export type TransitionEffectResponseDto = z.infer<
  typeof transitionEffectResponseSchema
>;

// The transition ALWAYS travels with its effects, in every response including
// the two lists, and that is not a convenience: `status` is derived from the
// effects and never stored (`NarrativeTransition.ts:38-49`), so a response
// carrying the status without the effects would be handing the client a
// conclusion it cannot check, and one that goes stale the moment any effect is
// applied. The service loads them for the same reason — the N+1 in
// `listTransitionsByProject` exists to compute status, not to fill this field,
// so trimming `effects` from the wire would remove no query (notes §10, D11).
//
// The honest cost: a project with many transitions returns a large document and
// there is no pagination yet. Deferred until a caller needs it, same as the
// relationship list (7.1 gate) — but recorded here rather than in a note,
// because this schema is where it becomes a contract.
//
// No `version` field, deliberately: `narrative_transitions` has no version
// column at all (relabel is last-write-wins by design,
// `NarrativeTransition.ts:95-99`) and `.strict()` keeps a future edit from
// quietly establishing an `If-Match` contract the storage cannot honour — the
// same guard `relationshipResponseSchema` documents for a table that DOES have
// the column.
export const narrativeTransitionResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    sourceEntityType: narrativeTransitionSourceTypeSchema,
    sourceEntityId: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    declaredByUserId: z.string(),
    reversesTransitionId: z.string().nullable(),
    status: z.enum(NARRATIVE_TRANSITION_STATUSES),
    effects: z.array(transitionEffectResponseSchema),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type NarrativeTransitionResponseDto = z.infer<
  typeof narrativeTransitionResponseSchema
>;

// Both list endpoints — by project and by source entity — return this one shape.
// Unlike the relationship list there is no perspective-dependent extra field to
// add: a transition is read the same way from its source entity as from the
// project, so a second item schema would differ from this one by nothing.
export const narrativeTransitionListResponseSchema = z
  .object({
    narrativeTransitions: z.array(narrativeTransitionResponseSchema),
  })
  .strict();

export type NarrativeTransitionListResponseDto = z.infer<
  typeof narrativeTransitionListResponseSchema
>;
