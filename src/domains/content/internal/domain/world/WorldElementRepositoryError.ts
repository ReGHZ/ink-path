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