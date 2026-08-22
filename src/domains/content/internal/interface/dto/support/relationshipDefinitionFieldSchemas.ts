import { z } from "zod";

import { contentEntityTypeSchema } from "./relationshipFieldSchemas.js";

// A LENGTH bound, and deliberately NOT a charset bound: the charset is exactly
// what migration `20260820100000_relationship_definition_display_labels` opened
// up. 120 characters fits a phrase in any script and closes the door on absurd
// request bodies.
export const relationshipDefinitionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120);

export const relationshipDefinitionSignatureSchema = z
  .object({
    subjectEntityType: contentEntityTypeSchema,
    // `null` means a unary predicate. Nullable rather than optional on purpose:
    // "forgot to fill it in" and "genuinely has no object" are two different
    // things, and only one of them is valid.
    objectEntityType: contentEntityTypeSchema.nullable(),
  })
  .strict();
