import type { EntityType } from "./ruleAst.js";

// The assertion log, read ONE ROW AT A TIME by id — the read `GraphProjector`
// needs, and the counterpart of `EvaluationFactReader`, which reads a whole
// project at once for the executor.
//
// WHY THE PROJECTOR READS THE LOG INSTEAD OF TRUSTING THE EVENT (step 4b-4,
// stage B). `content.relationship.asserted` carries `{ projectId, assertionId,
// relationshipId, predicate }` and NO endpoints
// (`RelationshipService.ts` ~line 336), so a projector folding from the payload
// alone could not build the two node rows at all. The choice is therefore between
// widening that payload — copying the log into the event, where the copy can drift
// — and reading the row the event names.
//
// Reading it is also what the causality rule already asks for: an event on this
// path must NAME THE LOG ROW it wrote (4b-3, F-1 — that blocker was raised
// precisely because the event described intent instead of naming rows), and the
// producer's own comment states "the LOG ROW stays authoritative" while calling the
// payload anchor a copy (`NarrativeTransitionService.ts` ~line 868). A consumer that
// folded the copy would make the copy authoritative by use.
//
// The consequence is deliberate and worth stating: the projector is NOT a pure
// function of its event. It is a fold of the log, triggered by an event.
export type LoggedAssertionEffectType =
  | "attribute_change"
  | "relationship_add"
  | "relationship_remove"
  | "terminate"
  | "retract";

export type LoggedAssertionEndpoint = {
  entityType: EntityType;
  entityId: string;
};

export type LoggedAssertion = {
  id: string;
  // The KIND of row, unnarrowed. The projector has to see `terminate`/`retract`
  // here rather than be handed only the rows the caller thinks are assertions: an
  // `asserted` event pointing at a `terminate` row is a producer bug, and the fold
  // can only refuse what it can see.
  operation: LoggedAssertionEffectType;
  // Null on `attribute_change`, and on nothing else that matters here — the
  // predicate is what the edge is keyed by, so the projector refuses a
  // relationship row without one instead of inventing a symbol.
  relationshipType: string | null;
  // Does the log ALREADY hold a `retract` naming this assertion (step 4b-4, closing
  // gerbang 4b-4 blokir G4-1)?
  //
  // The fold is fed by a queue, and the queue does not promise order. `RabbitMqConsumer`
  // starts a handler per delivery without awaiting the previous one and the projector
  // runs with a prefetch above 1, so two messages about the SAME assertion can be in
  // flight together; an in-process retry (1s then 2s) or a DLQ replay widens that to
  // seconds. Retract-before-assert then produced: `deleteMany` matches nothing (a
  // documented, NORMAL answer), the assert lands afterwards, and a withdrawn fact stands
  // in the graph permanently with nothing to signal it.
  //
  // The read that the fold already performs is where that can be answered for free — the
  // log is the truth about what happened, and "this claim was withdrawn" is a fact about
  // the log, not about the arrival order of two messages. Retraction is terminal
  // (premis §8.3 AMENDMENT 2026-08-18: a `retract` may target an assertion or a
  // `terminate`, never another `retract`), so this flag can never go back to false —
  // which is what makes it safe to read once.
  retracted: boolean;
  subject: LoggedAssertionEndpoint;
  // Null = a UNARY fact. The log refuses to write one today
  // (`Assertion.validateRelationshipChange` requires `related_entity_*`), so
  // this stays null-typed to say the shape exists while
  // `03-database-design/15_validation_tables.md` §ADDENDUM butir 4 keeps its home
  // out of 4b-4 — the projector must NOT grow a fold branch for data that cannot
  // exist yet.
  object: LoggedAssertionEndpoint | null;
};

// One log row as a REBUILD sees it: the operation, and what it acts on. Deliberately not
// `LoggedAssertion` — a rebuild walks rows whose kind it does not know yet, including the
// operations (`retract`, `terminate`) that name another row rather than state a fact.
export type LoggedOperation = {
  id: string;
  operation: LoggedAssertionEffectType;
  targetAssertionId: string | null;
};

export type AssertionLogReader = {
  // Unnarrowed by parent transition, like `findAssertionById` on the content side:
  // a fact asserted through CRUD is PARENTLESS, and a reader that could not see
  // such a row would silently skip every CRUD-born fact.
  findAssertion(input: {
    projectId: string;
    assertionId: string;
  }): Promise<LoggedAssertion | null>;

  // Every operation in one project's log, oldest first — the input to a rebuild.
  //
  // Ordered by the log's own `created_at`, which is the only total order that exists for
  // these rows and the one the fold would have seen if no message had ever arrived out of
  // order. That is the whole point: a rebuild is the fold applied to the log's order
  // instead of the queue's.
  listOperations(projectId: string): Promise<LoggedOperation[]>;
};
