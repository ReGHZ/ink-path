// Version conflict: a guarded write matched 0 rows while the row itself is
// still there. Same meaning as SceneRepositoryConflictError
// (`../story/SceneRepositoryError.ts:1-7`) — transient and retry-fixable, which
// is why it stays distinct from the duplicate error below (deterministic and
// user-fixable). Collapsing them would make 409 "duplicate relation" and 409
// "version conflict" indistinguishable to the service, and Flow 4 lists them as
// two separate error paths.
export class ContentRelationshipRepositoryConflictError extends Error {
  constructor() {
    super("Content relationship repository conflict");
    this.name = "ContentRelationshipRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContentRelationshipRepositoryNotFoundError extends Error {
  constructor() {
    super("Content relationship repository target not found");
    this.name = "ContentRelationshipRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// `@@unique([projectId, relationType, sourceEntityType, sourceEntityId,
// targetEntityType, targetEntityId])` (`content-support.prisma:74`). This is the
// entire duplicate-detection mechanism: canonicalization in the domain makes
// `A↔B` and `B↔A` produce the same key, and the constraint does the rest, so no
// read-before-write exists to race against (Flow 4 step 8, superseded
// 2026-08-14). Plays the same role as SceneRepositoryOrderConflictError: a
// specific unique index whose violation the caller can act on.
export class ContentRelationshipRepositoryDuplicateError extends Error {
  constructor() {
    super("Content relationship already exists");
    this.name = "ContentRelationshipRepositoryDuplicateError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// No `...ReferencedError` here, unlike Scene/Chapter/Layer: nothing points at
// `content_relationships`. Both of its FKs are outbound (`project_id` Restrict,
// `created_by_user_id` SetNull) and no model declares a back-relation to it
// (`content-support.prisma:55-81`), so a delete cannot be blocked by an inbound
// Restrict. Confirmed against 7.7: `transition_effects` stores endpoints
// (`target_entity_*`, `related_entity_*`) and has no FK to a relationship row
// (`narrative-transition.prisma:38-60`), so applying an effect cannot pin one.
//
// No translated error for an outbound FK violation on insert() either — a P2003
// there must surface RAW. `projectId` comes from the authorized route context
// and `createdByUserId` from the authenticated token, so a missing parent row is
// a higher-layer bug, not a user-facing condition. Same accepted trade-off Scene
// documents for its `project_id` / `created_by_user_id` / `current_revision_id`
// constraints, where only the one FK carrying user input is matched by name.
