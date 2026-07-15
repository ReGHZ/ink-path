export class WorldMapRepositoryConflictError extends Error {
  constructor() {
    super("World map repository conflict");
    this.name = "WorldMapRepositoryConflictError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class WorldMapRepositoryNotFoundError extends Error {
  constructor() {
    super("World map repository target not found");
    this.name = "WorldMapRepositoryNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// P2003 on `delete()`: the world map is still referenced (e.g. by child world
// maps via the `parentId` self-reference guarded by `onDelete: Restrict`) and
// cannot be removed until the references are cleared. Named generically rather
// than `HasChildrenError` so any future Restrict FK on this table surges the
// same error from the same delete path.
export class WorldMapRepositoryReferencedError extends Error {
  constructor() {
    super("World map repository target is still referenced");
    this.name = "WorldMapRepositoryReferencedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// P2003 on `delete()` vs P2003 on `insert()`/`update()` point opposite ways.
// ReferencedError (above) = a third row points at this one, so delete is
// blocked. ParentNotFoundError (below) = this row's own `parentId` points at
// nothing. Distinct from NotFoundError, whose subject is the map itself.
// The Domain entity treats `parentId` as an opaque token and delegates
// existence verification to the DB FK (`"MapHierarchy"`, `onDelete:
// Restrict`), so a raw P2003 on insert/update is the only signal that the
// supplied parent is invalid.
//
// Contract: the application use-case is expected to have loaded the enclosing
// project (authz → raises Project-NotFound before insert) and to source
// `createdByUserId`/`currentRevisionId` from trusted session/app state (see
// precedent `ProjectService.createProject` → `createdByUserId =
// input.requestingUserId`), leaving `parentId` the sole raw user input among
// the four Restrict/SetNull FKs on this table. Accepted trade-off: if a
// non-parent FK fires P2003 here (project deleted mid-insert race, corrupt
// `currentRevisionId`), it surfaces as `ParentNotFound` — imprecise for those
// rare edges. If that becomes a real concern, pivot to a single generic
// `InvalidReferenceError` or parse `error.meta.constraint` to route by FK,
// rather than refining this name.
export class WorldMapRepositoryParentNotFoundError extends Error {
  constructor() {
    super("World map repository parent not found");
    this.name = "WorldMapRepositoryParentNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}