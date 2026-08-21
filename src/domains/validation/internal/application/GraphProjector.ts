import {
  CONTENT_RELATIONSHIP_ASSERTED,
  CONTENT_RELATIONSHIP_RETRACTED,
  NARRATIVE_ASSERTION_APPLIED,
} from "../../../../shared/application/events/routingKeys.js";

import type { AssertionLogReader } from "../domain/AssertionLogReader.js";
import type { EvaluationGraphRepository } from "../domain/EvaluationGraphRepository.js";

// Step 4b-4, stage B. Folds the assertion log into `evaluation_nodes`/`_edges`.
//
// THE ONE DECISION THIS FILE EXISTS TO CARRY (`03-database-design/15_validation_tables.md`
// §ADDENDUM 2026-08-19 butir 1):
//
//   `assert`    → upsert the nodes and the edge
//   `retract`   → DELETE the edge — the claim counts as never made, at every cut
//   `terminate` → LEAVE the edge standing — the fact held before its anchor
//
// The third line is one branch of code and a whole class of silent failure. Copying
// the `content_relationships` precedent, where a termination deletes the row too,
// leaves every test green, every table consistent, and every question of the form
// "did this hold at cut C" answered wrongly for every cut before the anchor. That is
// why a termination returns an explicit `ignored` outcome rather than falling off the
// end of a function: "nothing happened" has to be assertable.
//
// Truth-at-a-cut is NOT computed here (§ADDENDUM butir 2). The executor derives it
// from reachability over the log, three-valued; this fold materialises fact identity
// plus provenance and nothing else.
export type GraphProjectionOutcome =
  | { kind: "folded"; sourceAssertionId: string }
  | { kind: "unfolded"; sourceAssertionId: string; edgesRemoved: number }
  | {
      kind: "ignored";
      reason:
        | "termination_keeps_the_edge"
        | "not_a_relationship_fact"
        // The log already holds a `retract` naming this assertion, so folding it would
        // resurrect a withdrawn fact. See `fold()`.
        | "already_retracted_in_the_log";
    };

// The wire shape of the three keys `GRAPH_PROJECTOR_BINDINGS` delivers, flattened
// into one type because that is how the producers write them: one routing key, one
// payload schema, nulls where a half does not apply
// (`NarrativeTransitionService.ts` ~line 866).
//
// Typed rather than validated field-by-field, matching how the embedding worker takes
// `ContentEventPayload` off the same broker. The fields this fold BRANCHES on are
// checked at runtime below, because those are the ones whose absence would otherwise
// turn into a silent no-op instead of a dead-lettered message.
export type GraphProjectorEventPayload = {
  projectId?: string | null;
  // `content.relationship.asserted` / `.retracted`: the assertion being folded or
  // withdrawn. `narrative.assertion.applied`: non-null only on the add half, where the
  // assertion row IS the assertion.
  assertionId?: string | null;
  operation?: string | null;
  // Written by the narrated-removal half (4b-3). Its presence is what proves a
  // `terminate` row was actually written, which is the fact this fold relies on when
  // it deliberately does nothing.
  terminationId?: string | null;
  targetAssertionId?: string | null;
};

// What a rebuild did, so a maintenance run can be read from a log line instead of from
// the database afterwards.
export type GraphRebuildOutcome = {
  edgesDropped: number;
  factsFolded: number;
  operationsSkipped: number;
  orphanNodesPruned: number;
};

export class GraphProjector {
  constructor(
    private readonly assertionLog: AssertionLogReader,
    private readonly graph: EvaluationGraphRepository,
  ) {}

  async handleEvent(
    routingKey: string,
    payload: GraphProjectorEventPayload,
  ): Promise<GraphProjectionOutcome> {
    const projectId = require_(payload.projectId, "projectId", routingKey);

    if (routingKey === CONTENT_RELATIONSHIP_ASSERTED) {
      return this.fold(
        projectId,
        require_(payload.assertionId, "assertionId", routingKey),
      );
    }

    if (routingKey === CONTENT_RELATIONSHIP_RETRACTED) {
      // `assertionId` on this key is the ORIGIN assertion, not the retraction row
      // (`RelationshipService.ts` ~line 630 — the retraction carries its own
      // `retractionId`). Deleting by the retraction id would match no edge and
      // report success, which is the shape of the bug that resurrects retracted
      // facts on the next rebuild.
      return this.unfold(
        projectId,
        require_(payload.assertionId, "assertionId", routingKey),
      );
    }

    if (routingKey === NARRATIVE_ASSERTION_APPLIED) {
      return this.handleAppliedAssertion(routingKey, projectId, payload);
    }

    // The queue binds two PATTERNS, `content.relationship.*` and `narrative.assertion.*`
    // (`GRAPH_PROJECTOR_BINDINGS`), so a new verb under either prefix starts arriving
    // here the moment a producer publishes it — no broker change needed, which is the
    // property that binding was chosen for. Throwing sends it to the DLQ, loudly.
    // Ignoring it would be a fact silently missing from the graph, and the routing-key
    // contract already names that class of failure as the one to avoid.
    throw new Error(
      `GraphProjector received routing key "${routingKey}", which it has no fold for`,
    );
  }

  private async handleAppliedAssertion(
    routingKey: string,
    projectId: string,
    payload: GraphProjectorEventPayload,
  ): Promise<GraphProjectionOutcome> {
    const operation = require_(payload.operation, "operation", routingKey);

    if (operation === "relationship_add") {
      // The assertion row IS the assertion on this path, and the producer states
      // `assertionId` even though it equals `effectId` for exactly this reason —
      // so a consumer need not know the two are conflated here.
      return this.fold(
        projectId,
        require_(payload.assertionId, "assertionId", routingKey),
      );
    }

    if (operation === "relationship_remove") {
      // ── THE DECISION, AND IT IS A DELIBERATE NO-OP ────────────────────────────
      // A narrated removal writes `terminate`, NOT `retract` (4b-3, premis §8.3):
      // the fact stopped holding at a story moment, it was not withdrawn. So the
      // edge STAYS — it is the record of a fact that held before its anchor, and
      // the anchor lives on the `terminate` row, which the executor reads.
      //
      // The guard is not ceremony: `terminationId` non-null is what proves 4b-3's
      // log row was actually written. If a regression brought back the version of
      // this path that deleted the projection and wrote nothing to the log, this
      // fold would be silently correct-looking while the log lost the termination —
      // so the absence is refused here rather than tolerated.
      require_(payload.terminationId, "terminationId", routingKey);
      require_(payload.targetAssertionId, "targetAssertionId", routingKey);

      return { kind: "ignored", reason: "termination_keeps_the_edge" };
    }

    if (operation === "attribute_change") {
      // Every applied assertion publishes this key (decision D6), and an attribute
      // change is not a relationship fact. Named as a reason rather than dropped, so
      // "the projector saw it and had nothing to do" is distinguishable in a log from
      // "the projector never received it".
      return { kind: "ignored", reason: "not_a_relationship_fact" };
    }

    // `terminate` and `retract` are ROWS the log holds, never DECLARED assertion types
    // an apply reports. Seeing one here means the producer's contract changed.
    throw new Error(
      `GraphProjector received assertion type "${operation}" on "${routingKey}", which it has no fold for`,
    );
  }

  // Re-derives one project's fold FROM THE LOG, in the log's own order.
  //
  // Why it exists (blokir gerbang 4b-4 G4-1): the queue does not promise order, and the
  // guard in `fold()` narrows that hazard to a window it cannot fully close. A rebuild is
  // what makes the remaining window REPAIRABLE rather than permanent — and it is also the
  // first thing in this codebase that makes premis §8.4's "the projection is derived, drop
  // and rebuild is always available" true in code instead of in prose.
  //
  // It replays only `relationship_add` rows and lets `fold()` make every decision,
  // including refusing retracted ones. Replaying `retract` rows as deletes as well would
  // be a SECOND implementation of retraction semantics — the exact shape 4b-3 removed
  // ("satu fold, dua pemanggil") — and would leave two mechanisms where a mutation could
  // kill one and stay green. `terminate` rows are skipped for the same reason they are
  // skipped live: a terminated fact HELD, and its edge belongs in the graph.
  //
  // Deliberately N+1 reads: every fold re-reads its own assertion row rather than joining
  // the whole log into memory. This is a maintenance path, and one shared decision site is
  // worth more here than a faster loop.
  //
  // NOT atomic, and that is stated rather than hidden: the drop and the re-folds are
  // separate transactions, so a concurrent reader can observe a partially rebuilt graph.
  // Acceptable only because `evaluation_*` is not the executor's source of facts today
  // (`03-database-design/15` §ADDENDUM butir 7); the day that changes, this needs one
  // transaction or a swap into place.
  async rebuildProject(projectId: string): Promise<GraphRebuildOutcome> {
    const edgesDropped = await this.graph.deleteAllFactsOfProject(projectId);
    const operations = await this.assertionLog.listOperations(projectId);

    let factsFolded = 0;
    let operationsSkipped = 0;

    for (const operation of operations) {
      if (operation.operation !== "relationship_add") {
        operationsSkipped += 1;
        continue;
      }

      const outcome = await this.fold(projectId, operation.id);

      if (outcome.kind === "folded") {
        factsFolded += 1;
      } else {
        // A retracted claim, or an `attribute_change` that somehow carries this type.
        // Counted, not silent: "the log had 40 asserts and the graph got 37" is the line a
        // human needs when a rebuild is run because something looked wrong.
        operationsSkipped += 1;
      }
    }

    // Only AFTER the re-fold, never as part of a retraction: pruning before the edges are
    // back would cascade away the very rows this method is rebuilding.
    const orphanNodesPruned = await this.graph.pruneOrphanNodes(projectId);

    return {
      edgesDropped,
      factsFolded,
      operationsSkipped,
      orphanNodesPruned,
    };
  }

  private async fold(
    projectId: string,
    sourceAssertionId: string,
  ): Promise<GraphProjectionOutcome> {
    // The event names a row; the row is the truth. A missing row is not an empty
    // fold — it means the event and the log disagree, and folding "nothing" would
    // record that disagreement as an entity with no relationships.
    const assertion = await this.assertionLog.findAssertion({
      projectId,
      assertionId: sourceAssertionId,
    });

    if (assertion === null) {
      throw new Error(
        `GraphProjector was told to fold assertion ${sourceAssertionId} of project ${projectId}, which the log does not have`,
      );
    }

    if (assertion.operation === "attribute_change") {
      return { kind: "ignored", reason: "not_a_relationship_fact" };
    }

    if (
      assertion.operation === "terminate" ||
      assertion.operation === "retract"
    ) {
      // An `asserted` event pointing at an operation row rather than at a claim.
      // Folding it would materialise "the retraction" as a fact of the story.
      throw new Error(
        `GraphProjector was told to fold ${sourceAssertionId}, which is a ${assertion.operation} row, not an assertion`,
      );
    }

    // ── ORDERING, and the queue does not provide it (blokir gerbang 4b-4 G4-1) ────────
    //
    // Nothing promises that two messages about the same assertion are processed in the
    // order they were published: the consumer starts a handler per delivery without
    // awaiting the previous one, prefetch is above 1, an in-process retry parks a message
    // for seconds, and a DLQ replay reorders freely. Retract-before-assert therefore
    // happened like this: the retraction deleted nothing (`edgesRemoved: 0`, a documented
    // NORMAL answer, so not usable as an alarm), the assert landed afterwards, and the
    // withdrawn fact stood in the graph permanently with nothing to signal it — the same
    // silent class §ADDENDUM butir 1 is about.
    //
    // The fix is not a lock or a sequence number but a QUESTION ASKED OF THE LOG, which
    // this method was already reading anyway: has this claim been withdrawn? Arrival
    // order stops mattering for the outcome, because the answer does not depend on it.
    //
    // ⚠ WHAT THIS DOES NOT CLOSE, stated rather than implied: a retraction committed
    // AFTER this read, whose delete then runs BEFORE the upsert below, still leaves the
    // edge. That window is microseconds wide instead of seconds, and it is recoverable —
    // `rebuildProjectGraph` re-derives the fold from the log — but it is not zero.
    // Closing it fully needs serialisation per fact (prefetch 1, or hashing by project),
    // whose cost is head-of-line blocking on every transient retry. Recorded in
    // `notes/tech-debt.md`.
    if (assertion.retracted) {
      return { kind: "ignored", reason: "already_retracted_in_the_log" };
    }

    if (assertion.relationshipType === null) {
      throw new Error(
        `Assertion ${sourceAssertionId} carries no predicate, so there is no edge to key`,
      );
    }

    if (assertion.object === null) {
      // A unary fact. The log cannot write one today, and its projection shape is
      // decided but deliberately unscheduled (§ADDENDUM butir 4): object-nullable
      // plus two partial unique indexes, once the log can produce one. Refusing is
      // the honest answer — a fold branch for it now would be untestable code
      // guarding data that cannot exist.
      throw new Error(
        `Assertion ${sourceAssertionId} is unary; the evaluation fold has no home for unary facts yet (15 §ADDENDUM butir 4)`,
      );
    }

    await this.graph.upsertFact({
      projectId,
      sourceAssertionId,
      relationshipType: assertion.relationshipType,
      subject: assertion.subject,
      object: assertion.object,
    });

    return { kind: "folded", sourceAssertionId };
  }

  private async unfold(
    projectId: string,
    sourceAssertionId: string,
  ): Promise<GraphProjectionOutcome> {
    // No log read on this path, and that is not an inconsistency with `fold()`: the
    // delete is keyed on the assertion id alone, so there is nothing to look up. A
    // read would only add a way to fail — and a retraction that could not be applied
    // because its origin row is momentarily unreadable is the one operation that must
    // not be dropped.
    const edgesRemoved = await this.graph.deleteFactBySourceAssertion({
      projectId,
      sourceAssertionId,
    });

    return { kind: "unfolded", sourceAssertionId, edgesRemoved };
  }
}

// Named `require_` rather than `require` (reserved-ish in a module graph that also
// runs under CJS tooling) and kept as a function rather than repeated inline: every
// call site is a field this fold BRANCHES on, and the message has to say which key
// carried the bad payload, because that is the only thing a DLQ entry will show.
function require_<T>(
  value: T | null | undefined,
  field: string,
  routingKey: string,
): T {
  if (value === null || value === undefined) {
    throw new Error(
      `Event "${routingKey}" reached GraphProjector without "${field}"`,
    );
  }

  return value;
}

export function createGraphProjector({
  assertionLogReader,
  evaluationGraphRepository,
}: {
  assertionLogReader: AssertionLogReader;
  evaluationGraphRepository: EvaluationGraphRepository;
}): GraphProjector {
  return new GraphProjector(assertionLogReader, evaluationGraphRepository);
}
