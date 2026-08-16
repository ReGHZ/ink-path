import { z } from "zod";

import { CONTENT_ENTITY_TYPES } from "../../../domain/support/ContentRevision.js";

// Built from the domain's own list (`ContentRevision.ts`), not retyped: a tenth
// entity type becomes accepted here the moment the domain knows it, and there is
// no second list to forget.
export const contentEntityTypeSchema = z.enum(CONTENT_ENTITY_TYPES);

// Deliberately NOT an enum, and the asymmetry with `contentEntityTypeSchema` is
// the point. Rule 1 (is this a known relation type?) belongs to the domain:
// `ContentRelationship.create()` rejects it and `RelationshipService`'s generic
// DomainError branch turns that into the same 400 the flow specifies
// (`RelationshipService.ts:29-34, 122-130`). Closing the set here too would give
// this endpoint a different rejection message than the one 7.7
// (NarrativeTransition `relationship_add`) will produce for the identical
// mistake, and would silently make the registry unenforceable from any entry
// point that does not pass through Zod.
export const relationTypeSchema = z.string();

// `note` is `@db.Text` (`prisma/content-support.prisma:66`), so no frozen
// length exists; the ceiling matches `characterDescriptionSchema` rather than
// inventing a new one. `.trim().min(1)` means an all-whitespace note is a 400
// instead of silently becoming `null` — the same trade Phase 4-6 already makes
// for every optional text field, kept identical here on purpose.
export const relationshipNoteSchema = z.string().trim().min(1).max(2000);

// Both endpoint ids land in `@db.Uuid` columns and are handed straight to
// `ContentEntityLocator.locate()`. A malformed value makes Prisma raise `P2007`,
// which no error mapper here translates, so the caller used to see a 500 for
// what is plainly a bad request.
//
// 400 rather than the 404 its path-parameter counterpart answers
// (`uuidRouteParameterMiddleware`, `shared/http/projectScopedRouter.ts`): these
// ids arrive in a BODY, where they are data fields to validate, not the identity
// of the resource being addressed. The difference is deliberate, not an
// oversight to harmonise.
export const contentEntityIdSchema = z.uuid();

// Perspective of a listed relationship relative to the entity that was queried.
// `non_directional` is not a hedge: for those types `canonicalizeEndpoints()`
// picks source/target by lexicographic order (`relationTypeRegistry.ts:494-511`),
// so "outgoing" there would report an artefact of sorting as if it were a
// narrative fact. The vocabulary matches `RelationDirectionality`
// (`relationTypeRegistry.ts:19`) instead of introducing a third word for it.
export const relationshipDirectionSchema = z.enum([
  "outgoing",
  "incoming",
  "non_directional",
]);

export type RelationshipDirection = z.infer<typeof relationshipDirectionSchema>;
