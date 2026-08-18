import type { RelationshipDefinition } from "../../domain/support/relationshipDefinition.js";

// Reads a project's predicate vocabulary — the rows that replaced the closed
// union in `relationTypeRegistry.ts` (step 4,
// `07-implementation-order/01_implementation_order.md` §Langkah 4 butir 4).
//
// A PORT rather than a direct Prisma call for the reason the whole domain layer
// is arranged this way, plus one specific to this table: both write paths into
// `content_relationships` need it (RelationshipService and the 7.7 apply path),
// and the second of those runs inside the transition's transaction. Repositories
// here are built per client, so the transactional caller hands in a reader over
// its own transaction and sees the definitions it just created — which is what
// makes "seed the vocabulary and use it in the same transaction" expressible at
// all.
export type RelationshipDefinitionReader = {
  // `null` means the project has no such predicate. That is a 400 the author can
  // fix by defining it, never a 404 about the relationship — the vocabulary is
  // theirs to extend, so "unknown predicate" is now a statement about their
  // project, not about the codebase.
  findByPredicate(
    projectId: string,
    predicate: string,
  ): Promise<RelationshipDefinition | null>;

  // Keyed by predicate. Used by the read paths, which have to label an arbitrary
  // number of rows in one response: one query per row would make a list of 50
  // relationships 51 round trips, and the inverse label is needed for every one
  // of them (§7.5 — the DTO mapper picks WHICH label, but the symbol itself is
  // data now).
  findAllByProject(
    projectId: string,
  ): Promise<ReadonlyMap<string, RelationshipDefinition>>;
};
