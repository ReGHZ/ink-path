// One conflict error for all nine entity types. Each repository throws its own
// (`CharacterRepositoryConflictError`, `SceneRepositoryConflictError`, …) and
// the mutator adapter translates them here, so that
// NarrativeTransitionService — which is generic over entity type by
// construction — does not carry nine `instanceof` branches for one outcome.
//
// It is reachable even though the read and the write happen inside one
// transaction: under READ COMMITTED another transaction can commit an update to
// the same row between them, and the guarded write (`where: { id, version }`)
// then matches zero rows. That is a transient, retry-fixable 409, the same
// meaning the per-entity conflict errors carry.
//
// "Row is gone" is deliberately NOT an error here: the mutator answers `null`
// for it, the same shape a missing row already has on the load path, and the
// service turns both into one 404.
export class ContentAttributeConflictError extends Error {
  constructor() {
    super("Content entity was modified concurrently");
    this.name = "ContentAttributeConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
