export class SceneRepositoryConflictError extends Error {
  constructor() {
    super("Scene repository conflict");
    this.name = "SceneRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SceneRepositoryNotFoundError extends Error {
  constructor() {
    super("Scene repository target not found");
    this.name = "SceneRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Inbound `onDelete: Restrict` FK blocking removal — `comment_target_scenes`
// once the Feedback domain exists (`content-story.prisma:183`).
export class SceneRepositoryReferencedError extends Error {
  constructor() {
    super("Scene repository target is still referenced");
    this.name = "SceneRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// `@@unique([chapterId, orderInChapter])` (`content-story.prisma:185`, index
// `scenes_chapter_id_order_in_chapter_key`). Same reasoning as
// ChapterRepositoryOrderConflictError: a taken position is deterministic and
// user-fixable, a version conflict is transient and retry-fixable — collapsing
// them would make the two indistinguishable to the service.
export class SceneRepositoryOrderConflictError extends Error {
  constructor() {
    super("Scene order already taken in chapter");
    this.name = "SceneRepositoryOrderConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// The scene's own `chapterId` points at nothing (FK `scenes_chapter_id_fkey`,
// `onDelete: Restrict`). Mirrors LayerRepositoryParentNotFoundError: the
// entity treats `chapterId` as an opaque established-aggregate token
// (`Scene.ts:229-238`) and delegates existence to this FK, so a P2003 on that
// specific constraint is the only signal that the supplied parent is invalid.
// Distinct from NotFoundError, whose subject is the scene itself.
//
// Same accepted trade-off as Layer: only this one FK is matched by name. The
// other three (`project_id`, `created_by_user_id`, `current_revision_id`) come
// from authorized context or from this repository itself, so a P2003 on them
// is a higher-layer bug and must surface raw.
export class SceneRepositoryChapterNotFoundError extends Error {
  constructor() {
    super("Scene repository chapter not found");
    this.name = "SceneRepositoryChapterNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
