import type { Character } from "./Character.js";

export type CharacterRepository = {
  findById(id: string): Promise<Character | null>;

  findByProjectId(projectId: string): Promise<Character[]>;

  insert(character: Character): Promise<void>;

  // Optimistic concurrency (policy 06 §3, same mechanism as Layer/WorldMap/
  // WorldElement): matches on `character.version`, increments it on success.
  // The passed-in entity is NOT refreshed with the new version afterward (no
  // RETURNING) — callers that reuse the same instance for a second update()
  // without reloading will send a stale version and get a false conflict.
  // Reload before updating twice.
  update(character: Character): Promise<void>;

  // Delete Guard decision (06_concurrency_control_policy.md §3 "Delete
  // Guard") — reasoned for Character specifically, not copied from Layer/
  // WorldElement: (1) Character has no application service yet, so no
  // revision is actually written to `content_revisions` on update today — a
  // lost update-vs-delete race here is just as unrecoverable right now as it
  // is for the other Content entities; (2) `update()` above is
  // version-guarded, so an unguarded `delete()` would be an unguarded bypass
  // of that same guarantee — true regardless of whether the entity has a
  // hierarchy concept, since it is about every write to the row, not about
  // parent/child structure; (3) no caller exists yet (no Application Service
  // calls `delete()`), so guarding the signature now costs nothing in
  // migration. Conclusion matches Layer/WorldMap/WorldElement, but for
  // Character's own reasons.
  delete(id: string, expectedVersion: number): Promise<void>;
};
