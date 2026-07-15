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