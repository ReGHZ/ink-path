export class FactionRepositoryConflictError extends Error {
  constructor() {
    super("Faction repository conflict");
    this.name = "FactionRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class FactionRepositoryNotFoundError extends Error {
  constructor() {
    super("Faction repository target not found");
    this.name = "FactionRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Same shape as WorldElementRepositoryReferencedError/
// CharacterRepositoryReferencedError: Faction has no `parentId`/self-hierarchy
// either, so this cannot come from a child pointing back at its parent. It
// comes from `CommentTargetFaction.faction` (`prisma/feedback.prisma`), which
// uses `onDelete: Restrict` back to Faction — deleting a faction a comment
// still targets is blocked the same way. `delete()` still needs a generic
// FK-violation -> this error translation, and does not need to match the
// constraint name, because on delete every P2003 means the same thing
// regardless of source table.
export class FactionRepositoryReferencedError extends Error {
  constructor() {
    super("Faction repository target is still referenced");
    this.name = "FactionRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}