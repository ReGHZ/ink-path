export class UserProjectRepositoryConflictError extends Error {
  constructor() {
    super("User project repository conflict");
    this.name = "UserProjectRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserProjectRepositoryNotFoundError extends Error {
  constructor() {
    super("User project repository target not found");
    this.name = "UserProjectRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
