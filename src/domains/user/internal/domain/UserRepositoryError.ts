export class UserRepositoryConflictError extends Error {
  constructor() {
    super("User repository conflict");
    this.name = "UserRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UserRepositoryNotFoundError extends Error {
  constructor() {
    super("User repository target not found");
    this.name = "UserRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
