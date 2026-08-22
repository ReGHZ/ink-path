import { z } from "zod";

import { relationshipDefinitionSignatureSchema } from "./relationshipDefinitionFieldSchemas.js";

export const relationshipDefinitionResponseSchema = z
  .object({
    id: z.uuid(),
    // The symbol travels back because a rule AST names a predicate by its
    // symbol, so a client building rules needs the value — not to render it.
    predicate: z.string(),
    label: z.string(),
    inverseLabel: z.string(),
    objectRequired: z.boolean(),
    directionality: z.enum(["directional", "non_directional"]),
    signatures: z.array(relationshipDefinitionSignatureSchema),
  })
  .strict();

export const relationshipDefinitionListResponseSchema = z
  .object({
    definitions: z.array(relationshipDefinitionResponseSchema),
  })
  .strict();

export type RelationshipDefinitionResponseDto = z.infer<
  typeof relationshipDefinitionResponseSchema
>;

export type RelationshipDefinitionListResponseDto = z.infer<
  typeof relationshipDefinitionListResponseSchema
>;
