import type { WorldMap } from "./WorldMap.js";

export type WorldMapRepository = {
  findById(id: string): Promise<WorldMap | null>;

  findByProjectId(projectId: string): Promise<WorldMap[]>;

  insert(worldMap: WorldMap): Promise<void>;

  // Optimistic concurrency (mirrors policy 06 §3, applied the same way as
  // Layer): matches on `worldMap.version`, increments it on success. The
  // passed-in entity is NOT refreshed with the new version afterward (no
  // RETURNING) — callers that reuse the same instance for a second update()
  // without reloading will send a stale version and get a false conflict.
  // Reload before updating twice.
  update(worldMap: WorldMap): Promise<void>;

  // Delete Guard decision (06_concurrency_control_policy.md §3 "Delete
  // Guard"): guarded, mirroring the same decision made for Layer (see
  // `LayerRepository.delete()`) and the ContentRelationship precedent (§4).
  // WorldMap is structurally identical to Layer in every way relevant to this
  // decision — same lack of a working `content_revisions` recovery path today
  // (no application service writes one yet), same bypass argument (update()
  // is version-guarded, so an unguarded delete() would sidestep it), same
  // near-zero cost (no application service calls delete() yet, so there is no
  // caller migration cost). Revisit only if Layer's decision is revisited.
  delete(id: string, expectedVersion: number): Promise<void>;
};