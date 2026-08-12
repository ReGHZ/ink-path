export class EventRepositoryConflictError extends Error {
  constructor() {
    super("Event repository conflict");
    this.name = "EventRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class EventRepositoryNotFoundError extends Error {
  constructor() {
    super("Event repository target not found");
    this.name = "EventRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Raised when an inbound `onDelete: Restrict` FK blocks removal — today
// `comment_target_events` once the Feedback domain exists; `events` itself has
// no self-reference and no child table in the Phase 6 schema
// (`prisma/content-world.prisma:124-157`).
export class EventRepositoryReferencedError extends Error {
  constructor() {
    super("Event repository target is still referenced");
    this.name = "EventRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
