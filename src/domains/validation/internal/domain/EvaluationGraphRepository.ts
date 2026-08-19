import type { EntityType } from "./ruleAst.js";

// The write side of the diegetic fold — `evaluation_nodes`/`evaluation_edges` —
// as the projector needs it, and nothing more.
//
// The contract lives here and the Postgres implementation lives in
// `infrastructure/`, same split as `EvaluationFactReader` beside it
// (`notes/02-struktur-domain-dan-test.md`: repository interface → `domain/`,
// impl → `infrastructure/`). It earns its keep the same way too: step 4b-4's
// hard part is not the SQL but WHICH log operation changes WHICH row, and that
// decision has to be testable on a fake.
//
// ⚠ What this port is NOT, so the next reader does not widen it by accident
// (`03-database-design/15_validation_tables.md` §ADDENDUM 2026-08-19 butir 7):
// `evaluation_*` is not the executor's source of facts. `PrismaEvaluationFactReader`
// reads `transition_effects` directly and builds its own retract/terminate sets.
// While that holds, this fold serves impact analysis and scheduling — moving the
// rule answer path onto it is a separate decision.
//
// `EntityType` rather than the content domain's `ContentEntityType`: the two unions
// have the same nine members, and the validation domain already reasons in its own
// (`ruleAst.ts`). Importing the other domain's internal type to gain nothing but a
// name would be the first crack in that boundary.
export type EvaluationGraphEndpoint = {
  entityType: EntityType;
  entityId: string;
};

// One asserted binary fact, in the form the fold stores it.
//
// No anchor field, deliberately (§ADDENDUM butir 2): validity-at-a-cut is computed
// by the executor over reachability and is three-valued, so there is no anchor
// column here to be tempted into reading as two-valued truth.
//
// No `attributes` / `timelinePosition` either — §ADDENDUM butir 5 makes both
// non-authoritative hints, and a port that accepted them would invite a writer to
// treat them as facts.
export type EvaluationGraphFact = {
  projectId: string;
  // The assertion row this edge is a fold of. Identity of the edge, not metadata:
  // see the unique index in `prisma/validation.prisma`.
  sourceAssertionId: string;
  // The predicate SYMBOL, held to the project's vocabulary by a composite foreign
  // key (§ADDENDUM butir 6). A symbol the project has not defined is refused by
  // the database, not by this port.
  relationshipType: string;
  subject: EvaluationGraphEndpoint;
  object: EvaluationGraphEndpoint;
};

export type EvaluationGraphRepository = {
  // Folds one `assert` in. Idempotent under redelivery, because the conflict
  // target is the assertion id: the same event twice leaves one edge.
  //
  // Nodes are upserted as a side effect — the fold owns them, and an edge cannot
  // reference a node that does not exist yet.
  upsertFact(fact: EvaluationGraphFact): Promise<void>;

  // Folds one `retract` in: the claim counts as never having been made, so the
  // edge is DELETED (§ADDENDUM butir 1).
  //
  // Returns the number of edges removed, and 0 is a NORMAL answer the caller must
  // not treat as an error, for two reasons that both really happen:
  //   * a `retract` may target a `terminate` row (premis §8.3 AMENDMENT
  //     2026-08-18) — and a `terminate` never produced an edge to remove;
  //   * a redelivered retraction finds the edge already gone.
  //
  // There is deliberately no `terminate` method. Termination leaves the fold
  // untouched — the fact held before its anchor — and the operation is recorded in
  // the log, which the executor reads. A method here would only exist to be called
  // with nothing to do, and the failure it would invite (copying the
  // `content_relationships` precedent, where BOTH operations delete) is the silent
  // one: every cut earlier than the anchor would start answering "never held".
  deleteFactBySourceAssertion(input: {
    projectId: string;
    sourceAssertionId: string;
  }): Promise<number>;

  // Drops one project's whole fold, so it can be rebuilt from the log. Returns how many
  // edges were removed.
  //
  // This is what makes premis §8.4 — the projection is DERIVED, "drop and rebuild is
  // always available" — true in code rather than only in prose, and it is the reason an
  // ordering anomaly (blokir G4-1) is repairable instead of permanent.
  deleteAllFactsOfProject(projectId: string): Promise<number>;

  // Removes nodes no edge points at any more. Returns how many.
  //
  // Separate from the delete above, and never called by a retraction: deleting an endpoint
  // node cascades to the OTHER facts touching that entity, so pruning is only ever safe
  // when the fold has just been rebuilt and the surviving edges are known.
  pruneOrphanNodes(projectId: string): Promise<number>;
};
