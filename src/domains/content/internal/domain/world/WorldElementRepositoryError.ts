export class WorldElementRepositoryConflictError extends Error {
  constructor() {
    super("World element repository conflict");
    this.name = "WorldElementRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorldElementRepositoryNotFoundError extends Error {
  constructor() {
    super("World element repository target not found");
    this.name = "WorldElementRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Unlike Layer/WorldMap, WorldElement has no `parentId`/self-hierarchy — so
// there is no child-self-reference source for a P2003 on delete. There is a
// different one instead: `CommentTargetWorldElement.worldElement`
// (`prisma/feedback.prisma`) uses `onDelete: Restrict` back to WorldElement,
// so deleting a world element that a comment still targets is blocked the
// same way a Layer with children is blocked — just from the Feedback domain's
// join table rather than a self-reference. Consequence in code is identical
// to Layer/WorldMap: `delete()` still needs a generic FK-violation -> this
// error translation, and (same reasoning as those two) it does not need to
// match the constraint name, because on delete every P2003 means the same
// thing regardless of source table — there is no "referent missing" reading
// to disambiguate, unlike insert/update.
export class WorldElementRepositoryReferencedError extends Error {
  constructor() {
    super("World element repository target is still referenced");
    this.name = "WorldElementRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}