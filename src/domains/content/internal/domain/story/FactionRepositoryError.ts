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