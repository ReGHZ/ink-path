import type { Chapter } from "./Chapter.js";

export type ChapterRepository = {
  findById(id: string): Promise<Chapter | null>;

  // Ordered by `order` ascending, not `updatedAt desc` like the Phase 4
  // entities: chapters carry a real narrative sequence backed by a unique
  // index (`content-story.prisma:152`), so "most recently touched first" would
  // be actively misleading for the one entity that has a canonical order.
  findByProjectId(projectId: string): Promise<Chapter[]>;

  insert(chapter: Chapter): Promise<void>;

  // Optimistic concurrency (policy 06 §3): matches on `chapter.version`,
  // increments it on success, does NOT refresh the passed-in instance.
  //
  // Can additionally fail with ChapterRepositoryOrderConflictError when the
  // new `order` collides with a sibling — a user-facing condition distinct
  // from the version conflict, see the error file.
  update(chapter: Chapter): Promise<void>;

  // Guarded delete. Fails with ChapterRepositoryReferencedError while the
  // chapter still has scenes (`scenes.chapter_id`, `onDelete: Restrict`).
  delete(id: string, expectedVersion: number): Promise<void>;

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency).
  linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void>;
};
