export class PlotRepositoryConflictError extends Error {
  constructor() {
    super("Plot repository conflict");
    this.name = "PlotRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PlotRepositoryNotFoundError extends Error {
  constructor() {
    super("Plot repository target not found");
    this.name = "PlotRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Inbound `onDelete: Restrict` FK blocking removal — `comment_target_plots`
// once the Feedback domain exists (`prisma/content-story.prisma:118`).
export class PlotRepositoryReferencedError extends Error {
  constructor() {
    super("Plot repository target is still referenced");
    this.name = "PlotRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
