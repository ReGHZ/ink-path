import { z } from "zod";

import { relationshipNoteSchema } from "./relationshipFieldSchemas.js";

// `note` is REQUIRED-but-nullable, which breaks the Phase 4-6 habit of making
// every field of an update DTO optional (`updateCharacterSchema.ts`). Those
// schemas are partial because their services accept partial input; this one is
// not, because `UpdateRelationshipNoteInput.note` is `string | null` with no
// optional case (`RelationshipService.ts:38-42`) and `note` is the ONLY mutable
// field on the aggregate (K4: relation type and both endpoints are immutable —
// change them by deleting and re-creating). An omitted key would therefore have
// to mean "leave it alone", which for a single-field PATCH is a request that
// asks for nothing: making it a 400 tells the caller that, instead of answering
// 200 with an unchanged row and letting a typo'd field name pass as success.
// `null` clears the note; `""` is rejected by the field schema, not silently
// treated as a clear.
export const updateRelationshipSchema = z
  .object({
    note: relationshipNoteSchema.nullable(),
  })
  .strict();

export type UpdateRelationshipRequestDto = z.infer<
  typeof updateRelationshipSchema
>;
