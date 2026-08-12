import type { Scene } from "./Scene.js";

export type SceneRepository = {
  findById(id: string): Promise<Scene | null>;

  // Scenes are read through their chapter, not through the project: routes are
  // nested (`/chapters/:chapterId/scenes`, implementation order 6.5) and the
  // `(chapter_id, order_in_chapter)` unique index makes the chapter the only
  // scope where scene order is meaningful. Ordered by `orderInChapter` asc.
  //
  // `projectId` is required even though `chapterId` alone already selects the
  // right rows — tenant scoping is enforced HERE, not left to the caller.
  // Precedent is this same domain's ContentRevisionRepository.findByEntity
  // (`../support/ContentRevisionRepository.ts:19-23`), which takes projectId
  // first for exactly this reason even though `(entityType, entityId)` would
  // suffice. Without it, `scenes.chapter_id` being a plain FK (not composite)
  // would mean a chapter id belonging to another tenant returns that tenant's
  // scenes in bulk. With it, the wrong tenant simply gets an empty list — no
  // leak, and no oracle for whether that chapter exists.
  //
  // NOTE for 6.4 — this closes the READ path only. insert() cannot be scoped
  // the same way: the FK only proves the chapter EXISTS, never that it belongs
  // to this project, so SceneService must still load the Chapter and compare
  // `chapter.projectId` before creating a scene under it. Same class of bug as
  // the Layer/WorldMap cross-project leak found in Phase 4.
  findByChapterId(projectId: string, chapterId: string): Promise<Scene[]>;

  insert(scene: Scene): Promise<void>;

  // Optimistic concurrency (policy 06 §3). Can also fail with
  // SceneRepositoryOrderConflictError when `orderInChapter` collides.
  update(scene: Scene): Promise<void>;

  // Guarded delete — version covers every write to the row, delete included.
  delete(id: string, expectedVersion: number): Promise<void>;

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency).
  linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void>;
};
