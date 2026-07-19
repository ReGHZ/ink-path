export class ContentRevisionRepositoryConflictError extends Error {
  constructor() {
    super("Content revision repository conflict");
    this.name = "ContentRevisionRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
