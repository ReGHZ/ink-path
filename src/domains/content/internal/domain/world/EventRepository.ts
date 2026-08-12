import type { Event } from "./Event.js";

export type EventRepository = {
  findById(id: string): Promise<Event | null>;

  findByProjectId(projectId: string): Promise<Event[]>;

  insert(event: Event): Promise<void>;

  // Optimistic concurrency (policy 06 §3), identical contract to Layer/
  // Character: matches on `event.version`, increments it on success, and does
  // NOT refresh the passed-in instance (no RETURNING). Reload before updating
  // the same instance twice or the second call sends a stale version and gets
  // a false conflict.
  update(event: Event): Promise<void>;

  // Guarded delete, same reasoning as the Phase 4 entities: `version` must
  // cover every write to the row, and delete is a write — an unguarded
  // `delete(id)` would be a bypass of the guarantee `update()` provides.
  delete(id: string, expectedVersion: number): Promise<void>;

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency).
  linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void>;
};
