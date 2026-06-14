export class ProjectRepositoryConflictError extends Error {
  constructor() {
    super("Project repository conflict");
    this.name = "ProjectRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProjectRepositoryNotFoundError extends Error {
  constructor() {
    super("Project repository target not found");
    this.name = "ProjectRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
