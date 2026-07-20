import type { WorldElement } from "./WorldElement.js";

export type WorldElementRepository = {
  findById(id: string): Promise<WorldElement | null>;

  findByProjectId(projectId: string): Promise<WorldElement[]>;

  insert(worldElement: WorldElement): Promise<void>;

  // Optimistic concurrency (policy 06 §3, same mechanism as Layer/WorldMap):
  // matches on `worldElement.version`, increments it on success. The
  // passed-in entity is NOT refreshed with the new version afterward (no
  // RETURNING) — callers that reuse the same instance for a second update()
  // without reloading will send a stale version and get a false conflict.
  // Reload before updating twice.
  update(worldElement: WorldElement): Promise<void>;

  // Delete Guard decision (06_concurrency_control_policy.md §3 "Delete
  // Guard") — reasoned independently for WorldElement, not copied from Layer:
  // (1) WorldElement has no application service yet, so no revision is
  // actually written to `content_revisions` on update today — a lost
  // update-vs-delete race here is just as unrecoverable right now as it is
  // for Layer/WorldMap/ContentRelationship; (2) `update()` above is
  // version-guarded, so an unguarded `delete()` would be an unguarded bypass
  // of that same guarantee — this holds regardless of whether the entity has
  // a parent/hierarchy concept, since it is about every write to the row, not
  // about hierarchy; (3) no caller exists yet (no Application Service calls
  // `delete()`), so guarding the signature now costs nothing in migration.
  // Conclusion happens to match Layer/WorldMap, but for WorldElement's own
  // reasons — it has no self-hierarchy, so unlike Layer/WorldMap this guard
  // has nothing to do with the parent/child relationship; it is purely about
  // covering delete as a write under the same version regime as update.
  delete(id: string, expectedVersion: number): Promise<void>;

  // Create-flow only (policy 06 §4 Content, currentRevisionId circular
  // dependency): sets `currentRevisionId` after the content_revisions row
  // has been inserted in the same transaction. insert() always writes a
  // null currentRevisionId regardless of what the passed-in entity carries,
  // because the FK to content_revisions is not DEFERRABLE (checked
  // per-statement, not at commit) and the revision row does not exist yet
  // at insert time. Guarded by expectedVersion for integrity (same ambiguous
  // count===0 resolution as update() — NotFound vs Conflict follow-up
  // SELECT), but unlike update() it does NOT increment version: completing
  // the create-flow's link is not a discrete edit (policy 06 §3 no-op
  // rule), so a freshly created, never-edited entity must still read
  // version === 0 after this call.
  //
  // Takes raw primitives instead of the domain entity — nothing at the type
  // level restricts this to the create-flow, so a caller outside it could
  // in principle try to overwrite an already-linked row. The Prisma
  // implementation additionally requires currentRevisionId to be null in
  // its WHERE clause, so any such misuse mechanically fails as a Conflict
  // rather than silently overwriting.
  linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void>;
};
