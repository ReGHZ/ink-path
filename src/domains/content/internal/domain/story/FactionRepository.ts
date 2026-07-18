import type { Faction } from "./Faction.js";

export type FactionRepository = {
  findById(id: string): Promise<Faction | null>;

  findByProjectId(projectId: string): Promise<Faction[]>;

  insert(faction: Faction): Promise<void>;

  // Optimistic concurrency (policy 06 §3, same mechanism as Layer/WorldMap/
  // WorldElement/Character): matches on `faction.version`, increments it on
  // success. The passed-in entity is NOT refreshed with the new version
  // afterward (no RETURNING) — callers that reuse the same instance for a
  // second update() without reloading will send a stale version and get a
  // false conflict. Reload before updating twice.
  update(faction: Faction): Promise<void>;

  // Delete Guard decision (06_concurrency_control_policy.md §3 "Delete
  // Guard") — reasoned for Faction specifically, not copied from the other
  // Content entities: (1) Faction has no application service yet, so no
  // revision is actually written to `content_revisions` on update today — a
  // lost update-vs-delete race here is just as unrecoverable right now as it
  // is for the other Content entities; (2) `update()` above is
  // version-guarded, so an unguarded `delete()` would be an unguarded bypass
  // of that same guarantee — true regardless of whether the entity has a
  // hierarchy concept, since it is about every write to the row, not about
  // parent/child structure; (3) no caller exists yet (no Application Service
  // calls `delete()`), so guarding the signature now costs nothing in
  // migration. Conclusion matches Layer/WorldMap/WorldElement/Character, but
  // for Faction's own reasons.
  delete(id: string, expectedVersion: number): Promise<void>;
};
