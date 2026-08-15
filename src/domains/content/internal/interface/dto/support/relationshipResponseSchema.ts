import { z } from "zod";

import {
  contentEntityTypeSchema,
  relationshipDirectionSchema,
} from "./relationshipFieldSchemas.js";

// Item shape — used by GET one, PATCH, and by POST, which returns the whole
// relationship rather than `{ id }` like `createLayerResponseSchema` does. That
// divergence is required, not stylistic: Flow 4 step 10
// (`02-system-design/03_flow_04_content_relationship.md:43`) says "return relasi
// yang baru dibuat", and it is also what makes the endpoint usable — the caller
// cannot reconstruct the stored row itself, because canonicalisation may have
// swapped the two endpoints it sent.
//
// No `version` field, and this is the enforcement point for that: K4/Flow 4
// (FROZEN 2026-08-14) rules that `expectedVersion` never crosses the wire, the
// service already refuses to publish it (`RelationshipService.ts:49-53`), and
// `.strict()` here means a future attempt to leak it fails the response parse
// instead of quietly establishing an `If-Match` contract.
export const relationshipResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    sourceEntityType: contentEntityTypeSchema,
    sourceEntityId: z.string(),
    targetEntityType: contentEntityTypeSchema,
    targetEntityId: z.string(),
    relationType: z.string(),
    note: z.string().nullable(),
    createdByUserId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export type RelationshipResponseDto = z.infer<typeof relationshipResponseSchema>;

// List shape = the item PLUS the two perspective-dependent fields. They live in
// a separate schema rather than as optional fields on the item, because
// "sometimes present" would leave the client guessing whether a missing
// `direction` means outgoing or means unknown. GET one has no perspective to
// compute them from, so it does not pretend to have them.
//
// `source`/`target` are kept alongside `direction`: the stored orientation is
// the canonical fact graph consumers need (notes §3), and dropping it in favour
// of an "other side" projection would make the API lossy for the sake of
// convenience.
export const relationshipListItemSchema = relationshipResponseSchema
  .extend({
    direction: relationshipDirectionSchema,
    // Effective label read FROM the queried entity's side: the relation type
    // itself when reading from the source (or when the type is
    // non-directional), the registry's inverse label when reading from the
    // target. Computed once, here, so the client never renders `member_of` on
    // the faction's side of a `has_member` link.
    label: z.string(),
  })
  .strict();

export type RelationshipListItemDto = z.infer<typeof relationshipListItemSchema>;

export const relationshipListResponseSchema = z
  .object({
    relationships: z.array(relationshipListItemSchema),
  })
  .strict();

export type RelationshipListResponseDto = z.infer<
  typeof relationshipListResponseSchema
>;
