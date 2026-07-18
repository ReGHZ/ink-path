import type { Layer } from "./Layer.js";

export type LayerRepository = {
  findById(id: string): Promise<Layer | null>;

  findByProjectId(projectId: string): Promise<Layer[]>;

  insert(layer: Layer): Promise<void>;

  // Optimistic concurrency (mirrors policy 06 §3, applied to Layer): matches
  // on `layer.version`, increments it on success. The passed-in entity is NOT
  // refreshed with the new version afterward (no RETURNING) — callers that
  // reuse the same instance for a second update() without reloading will send
  // a stale version and get a false conflict. Reload before updating twice.
  update(layer: Layer): Promise<void>;

  // Delete Guard decision (06_concurrency_control_policy.md §3 "Delete Guard"):
  // guarded, mirroring the ContentRelationship precedent (§4) rather than a
  // bare `delete(id)`. Reasoning, adapted to Layer's current state: (1) the
  // `content_revisions` recovery path §3 assumes for entity tables is not yet
  // wired up for Layer — no application service writes a revision on update
  // yet (open item, needs `ContentUnitOfWork` before 4.4) — so today a lost
  // update-vs-delete race is exactly as unrecoverable as it is for
  // ContentRelationship; (2) if `update()` is version-guarded but `delete()`
  // isn't, delete becomes an unguarded bypass of that same guarantee — version
  // must cover every write to the row, and delete is a write; (3) cost is
  // near-zero — same conditional-WHERE pattern as `update()`, and no
  // application service exists yet that calls `delete()`, so there is no
  // caller migration cost to changing the signature now.
  delete(id: string, expectedVersion: number): Promise<void>;
};