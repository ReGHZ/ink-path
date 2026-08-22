import { z } from "zod";

import {
  relationshipDefinitionLabelSchema,
  relationshipDefinitionSignatureSchema,
} from "./relationshipDefinitionFieldSchemas.js";

// NO `predicate` field here, and that is a decision: the symbol is DERIVED from
// `label` in the service (`symbolFromLabel`), so the author types one word and
// answers one question about arity instead of filling in four names
// (`notes/usulan-ux-pencatatan-fakta.md` §8.3/§8.5). A symbol the author has to
// invent is a field they can get wrong for a value they never read again.
export const createRelationshipDefinitionSchema = z
  .object({
    label: relationshipDefinitionLabelSchema,
    // Absent means the other direction reads the same, exactly what the
    // non-directional predicates among the 19 seeded ones do (`inverse_label`
    // equals `predicate`).
    inverseLabel: relationshipDefinitionLabelSchema.nullish(),
    // `objectRequired` and `signatures` ARE request fields here, and that is not
    // the contradiction of §9.4 it looks like. §9.4 governs `create-on-use`,
    // where a predicate is born from a FACT and the server derives arity and
    // first signature from it — no second source of truth to disagree with.
    // This is the VOCABULARY PAGE: the predicate is defined before any fact
    // exists, so there is nothing to derive from and the author is the only
    // source there is (`02-system-design/05` §ADDENDUM B-8).
    objectRequired: z.boolean(),
    // §9.4: not a question the author is asked, so a caller may leave it out.
    // Absent is expressed the same way `inverseLabel` expresses it — `.nullish()`
    // here, MEANING applied in the service — rather than a zod `.default()`, so
    // the contract keeps saying "the client may have no opinion" while the layer
    // that owns the rule keeps saying what the opinion then is.
    directionality: z.enum(["directional", "non_directional"]).nullish(),
    signatures: z.array(relationshipDefinitionSignatureSchema).min(1),
  })
  .strict();

export type CreateRelationshipDefinitionRequestDto = z.infer<
  typeof createRelationshipDefinitionSchema
>;
