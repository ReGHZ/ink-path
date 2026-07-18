export class CharacterRepositoryConflictError extends Error {
  constructor() {
    super("Character repository conflict");
    this.name = "CharacterRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CharacterRepositoryNotFoundError extends Error {
  constructor() {
    super("Character repository target not found");
    this.name = "CharacterRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Same shape as WorldElementRepositoryReferencedError (see that file's
// comment for the full reasoning): Character has no `parentId`/self-hierarchy,
// so this cannot come from a child pointing back at its parent the way it
// does for Layer/WorldMap. It comes from `CommentTargetCharacter.character`
// (`prisma/feedback.prisma`), which uses `onDelete: Restrict` back to
// Character — deleting a character a comment still targets is blocked the
// same way. `delete()` still needs a generic FK-violation -> this error
// translation, and does not need to match the constraint name, because on
// delete every P2003 means the same thing regardless of source table.
export class CharacterRepositoryReferencedError extends Error {
  constructor() {
    super("Character repository target is still referenced");
    this.name = "CharacterRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}