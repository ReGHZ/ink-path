// The ONE thing the write side has to say that is not a shape rule: "this
// project already names that predicate". It is a port-boundary type rather than
// a Prisma error on purpose — the adapter translates `P2002` here so no Prisma
// code exists outside `infrastructure/`, and the service maps it to 409 without
// knowing which index caught it.
//
// `existing` is what the ROW that won already says, read by the adapter AFTER
// the write failed. It is carried because the author cannot act on a conflict
// they cannot find: told *"a predicate that reads 'mati fisik' already exists"*
// when the row on screen reads `mati (fisik)`, they search the list for text
// that is not there (gate B8-2). Reading it is NOT a read-before-write check —
// the unique index stays the arbiter, this runs only on the losing path — so it
// is null whenever the row is gone by the time we look.
export type ConflictingDefinition = {
  displayLabel: string;
  objectRequired: boolean;
};

export class RelationshipDefinitionCatalogError extends Error {
  constructor(
    public readonly predicate: string,
    public readonly existing: ConflictingDefinition | null = null,
  ) {
    super(`Relationship definition ${predicate} already exists in this project`);
    this.name = "RelationshipDefinitionCatalogError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
