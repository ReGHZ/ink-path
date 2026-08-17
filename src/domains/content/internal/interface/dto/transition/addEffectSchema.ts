import { z } from "zod";

import {
  transitionFieldPathSchema,
  transitionNewValueSchema,
} from "./transitionFieldSchemas.js";
import {
  contentEntityIdSchema,
  contentEntityTypeSchema,
  relationTypeSchema,
} from "../support/relationshipFieldSchemas.js";

// The target is the same for all three variants: WHICH entity this effect acts
// on. It is not the transition's source — a scene (source) changes a character
// (target) — so it cannot be lifted out of the path.
const targetShape = {
  targetEntityType: contentEntityTypeSchema,
  targetEntityId: contentEntityIdSchema,
};

// Written once and spread into both relationship variants rather than typed
// twice: `relationship_add` and `relationship_remove` differ ONLY in the verb,
// and the day they stop being identical the difference should be visible as a
// deliberate edit, not as two lists that drifted apart.
const relationshipEffectShape = {
  ...targetShape,
  relationshipType: relationTypeSchema,
  relatedEntityType: contentEntityTypeSchema,
  relatedEntityId: contentEntityIdSchema,
};

// A discriminated union, mirroring `AddEffectInput`
// (`NarrativeTransitionService.ts:74-87`), which itself mirrors
// `CreateTransitionEffectProperties` (`TransitionEffect.ts:96-106`). The chain
// matters: the impossible request — an attribute change carrying a relation
// type — is unrepresentable at the wire, in the service input, and in the domain
// factory, so no layer has to detect it.
//
// `.strict()` on each member is what makes that true at the wire. Without it,
// `{ effectType: "attribute_change", fieldPath, newValue, relationshipType }`
// would parse with the stray key silently dropped, and the caller would be told
// its relationship request succeeded when only half of it was read. With it,
// that body is a 400 naming the key — the same answer the domain gives for the
// row shape (`TransitionEffect.ts:357-366`).
export const addEffectSchema = z.discriminatedUnion("effectType", [
  z
    .object({
      effectType: z.literal("attribute_change"),
      ...targetShape,
      fieldPath: transitionFieldPathSchema,
      newValue: transitionNewValueSchema,
    })
    .strict(),
  z
    .object({
      effectType: z.literal("relationship_add"),
      ...relationshipEffectShape,
    })
    .strict(),
  z
    .object({
      effectType: z.literal("relationship_remove"),
      ...relationshipEffectShape,
    })
    .strict(),
]);

export type AddEffectRequestDto = z.infer<typeof addEffectSchema>;
