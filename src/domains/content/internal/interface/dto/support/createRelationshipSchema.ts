import { z } from "zod";

import {
  contentEntityIdSchema,
  contentEntityTypeSchema,
  relationshipNoteSchema,
  relationTypeSchema,
} from "./relationshipFieldSchemas.js";

// Both endpoints travel in the body, unlike every Phase 4-6 create where the
// parent arrives in the path: a relationship is the only content write whose
// two operands are chosen by the caller rather than implied by the route. That
// is exactly why `sourceEntityType`/`targetEntityType` are validated here at all
// — for the nested list routes the entity type is a route constant and never
// needs parsing (notes K6).
export const createRelationshipSchema = z
  .object({
    sourceEntityType: contentEntityTypeSchema,
    sourceEntityId: contentEntityIdSchema,
    targetEntityType: contentEntityTypeSchema,
    targetEntityId: contentEntityIdSchema,
    relationType: relationTypeSchema,
    note: relationshipNoteSchema.nullish(),
  })
  .strict();

export type CreateRelationshipRequestDto = z.infer<
  typeof createRelationshipSchema
>;
