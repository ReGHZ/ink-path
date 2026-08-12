export class ChapterRepositoryConflictError extends Error {
  constructor() {
    super("Chapter repository conflict");
    this.name = "ChapterRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ChapterRepositoryNotFoundError extends Error {
  constructor() {
    super("Chapter repository target not found");
    this.name = "ChapterRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Inbound `onDelete: Restrict` FK blocking removal. Unlike the Phase 4
// entities this is reachable today, not only once Feedback exists: `scenes`
// points at `chapters` with Restrict (`content-story.prisma:180`), so deleting
// a chapter that still has scenes lands here.
export class ChapterRepositoryReferencedError extends Error {
  constructor() {
    super("Chapter repository target is still referenced");
    this.name = "ChapterRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// `@@unique([projectId, order])` (`content-story.prisma:152`, index
// `chapters_project_id_order_key`). Deliberately NOT folded into
// ChapterRepositoryConflictError: the two mean opposite things to a caller.
// A plain Conflict says "someone else changed this row, reload and retry" and
// is transient; an order collision says "position N in this project is
// already taken" — retrying the identical write will fail forever, and the
// fix is user input (pick another position), not a reload. Phase 4 never
// needed this distinction because none of its five entities carried a
// composite unique index; Chapter and Scene are the first that do.
export class ChapterRepositoryOrderConflictError extends Error {
  constructor() {
    super("Chapter order already taken in project");
    this.name = "ChapterRepositoryOrderConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
