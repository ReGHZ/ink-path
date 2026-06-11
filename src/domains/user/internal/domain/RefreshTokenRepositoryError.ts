export class RefreshTokenRepositoryConflictError extends Error {
  constructor() {
    super("Refresh token repository conflict");
    this.name = "RefreshTokenRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RefreshTokenRepositoryNotFoundError extends Error {
  constructor() {
    super("Refresh token repository target not found");
    this.name = "RefreshTokenRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
