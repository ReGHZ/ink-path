import { describe, expect, it } from "vitest";

import {
  createGraphProjector,
  type GraphProjectorEventPayload,
} from "./GraphProjector.js";
import {
  CONTENT_RELATIONSHIP_ASSERTED,
  CONTENT_RELATIONSHIP_RETRACTED,
  NARRATIVE_EFFECT_APPLIED,
} from "../../../../shared/application/events/routingKeys.js";

import type {
  AssertionLogReader,
  LoggedAssertion,
  LoggedOperation,
} from "../domain/AssertionLogReader.js";
import type {
  EvaluationGraphFact,
  EvaluationGraphRepository,
} from "../domain/EvaluationGraphRepository.js";

// Step 4b-4, stage B. The fold's DECISIONS, on a fake log and a recording
// repository — deliberately not against Postgres, because what is asserted here is
// which operation touches which row, and a fixture-driven version of that question
// would be a question about fixtures.
//
// The one test this file exists for is "a narrated removal leaves the edge
// standing": it is the only behaviour in 4b-4 whose regression leaves every table
// consistent and every other test green while every "did this hold at cut C"
// question turns wrong (`03-database-design/15_validation_tables.md` §ADDENDUM
// 2026-08-19 butir 1). It is also the only one that has to assert an ABSENCE, which
// is why the projector returns an outcome instead of falling off the end.

const projectId = "00000000-0000-4000-8000-0000000000a1";
const assertionId = "00000000-0000-4000-8000-0000000000a2";
const terminationId = "00000000-0000-4000-8000-0000000000a3";
const characterA = "00000000-0000-4000-8000-0000000000ca";
const characterB = "00000000-0000-4000-8000-0000000000cb";

const binaryAssertion: LoggedAssertion = {
  id: assertionId,
  effectType: "relationship_add",
  relationshipType: "ally_of",
  retracted: false,
  subject: { entityType: "character", entityId: characterA },
  object: { entityType: "character", entityId: characterB },
};

function harness(
  row: LoggedAssertion | null = binaryAssertion,
  operations: LoggedOperation[] = [],
) {
  const folded: EvaluationGraphFact[] = [];
  const unfolded: Array<{ projectId: string; sourceAssertionId: string }> = [];
  const lookups: Array<{ projectId: string; assertionId: string }> = [];
  const wiped: string[] = [];
  const pruned: string[] = [];
  // Call ORDER, not just call counts: two of the rebuild's guarantees are about sequence
  // (drop before re-fold, prune after it), and a count cannot see a sequence.
  const calls: string[] = [];

  const assertionLogReader: AssertionLogReader = {
    findAssertion(input) {
      lookups.push(input);

      return Promise.resolve(row);
    },
    listOperations() {
      return Promise.resolve(operations);
    },
  };

  const evaluationGraphRepository: EvaluationGraphRepository = {
    upsertFact(fact) {
      folded.push(fact);
      calls.push(`fold:${fact.sourceAssertionId}`);

      return Promise.resolve();
    },
    deleteFactBySourceAssertion(input) {
      unfolded.push(input);

      return Promise.resolve(1);
    },
    deleteAllFactsOfProject(id) {
      wiped.push(id);
      calls.push("wipe");

      return Promise.resolve(2);
    },
    pruneOrphanNodes(id) {
      pruned.push(id);
      calls.push("prune");

      return Promise.resolve(3);
    },
  };

  return {
    projector: createGraphProjector({
      assertionLogReader,
      evaluationGraphRepository,
    }),
    folded,
    unfolded,
    lookups,
    wiped,
    pruned,
    calls,
  };
}

const asserted: GraphProjectorEventPayload = { projectId, assertionId };

describe("GraphProjector", () => {
  describe("assert", () => {
    it("folds the LOG ROW the event names, not the event", async () => {
      const { projector, folded, lookups } = harness();

      const outcome = await projector.handleEvent(
        CONTENT_RELATIONSHIP_ASSERTED,
        asserted,
      );

      // The CRUD event carries no endpoints at all, so the endpoints below can only
      // have come from the log read — which is the whole reason this port exists.
      expect(lookups).toEqual([{ projectId, assertionId }]);
      expect(folded).toEqual([
        {
          projectId,
          sourceAssertionId: assertionId,
          relationshipType: "ally_of",
          subject: { entityType: "character", entityId: characterA },
          object: { entityType: "character", entityId: characterB },
        },
      ]);
      expect(outcome).toEqual({ kind: "folded", sourceAssertionId: assertionId });
    });

    it("refuses to fold when the log does not have the row", async () => {
      const { projector, folded } = harness(null);

      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_ASSERTED, asserted),
      ).rejects.toThrow(/which the log does not have/);

      // Nothing written: an event whose row is missing means event and log disagree,
      // and folding "nothing" would record that disagreement as an entity with no
      // relationships.
      expect(folded).toEqual([]);
    });

    it("refuses to fold an operation row dressed as an assertion", async () => {
      const { projector, folded } = harness({
        ...binaryAssertion,
        effectType: "terminate",
      });

      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_ASSERTED, asserted),
      ).rejects.toThrow(/is a terminate row, not an assertion/);
      expect(folded).toEqual([]);
    });

    it("refuses a relationship row with no predicate", async () => {
      const { projector, folded } = harness({
        ...binaryAssertion,
        relationshipType: null,
      });

      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_ASSERTED, asserted),
      ).rejects.toThrow(/carries no predicate/);
      expect(folded).toEqual([]);
    });

    it("refuses a unary fact instead of inventing a home for it", async () => {
      const { projector, folded } = harness({ ...binaryAssertion, object: null });

      // §ADDENDUM butir 4 decided the shape (object nullable + two partial unique
      // indexes) and butir 2 of the plan put it OUT of 4b-4, because the log cannot
      // write one yet. A fold branch here would be untestable code guarding
      // impossible data; a refusal naming the reason is the honest placeholder.
      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_ASSERTED, asserted),
      ).rejects.toThrow(/unary/);
      expect(folded).toEqual([]);
    });

    it("REFUSES to fold a claim the log says was already retracted", async () => {
      const { projector, folded, unfolded } = harness({
        ...binaryAssertion,
        retracted: true,
      });

      const outcome = await projector.handleEvent(
        CONTENT_RELATIONSHIP_ASSERTED,
        asserted,
      );

      // The ordering hazard, answered by asking the LOG instead of trusting arrival order
      // (blokir gerbang 4b-4 G4-1). Retract-before-assert used to leave the withdrawn fact
      // standing forever: the retraction deleted nothing (a documented normal answer, so
      // no alarm), and the assert landed afterwards.
      expect(outcome).toEqual({
        kind: "ignored",
        reason: "already_retracted_in_the_log",
      });
      expect(folded).toEqual([]);
      // And it does NOT try to compensate by deleting — there is nothing to delete, and a
      // delete here would be a second retraction mechanism.
      expect(unfolded).toEqual([]);
    });

    it("ignores an attribute change that reaches the fold", async () => {
      const { projector, folded } = harness({
        ...binaryAssertion,
        effectType: "attribute_change",
        relationshipType: null,
        object: null,
      });

      const outcome = await projector.handleEvent(
        CONTENT_RELATIONSHIP_ASSERTED,
        asserted,
      );

      expect(outcome).toEqual({
        kind: "ignored",
        reason: "not_a_relationship_fact",
      });
      expect(folded).toEqual([]);
    });
  });

  describe("retract", () => {
    it("deletes the edge of the ORIGIN assertion, not of the retraction row", async () => {
      const { projector, unfolded, lookups } = harness();

      const outcome = await projector.handleEvent(
        CONTENT_RELATIONSHIP_RETRACTED,
        {
          projectId,
          assertionId,
          // The retraction's own row id. Deleting by THIS would match no edge and
          // still report success — the shape of the bug that resurrects retracted
          // facts on the next rebuild.
          terminationId: null,
        },
      );

      expect(unfolded).toEqual([{ projectId, sourceAssertionId: assertionId }]);
      expect(outcome).toEqual({
        kind: "unfolded",
        sourceAssertionId: assertionId,
        edgesRemoved: 1,
      });

      // No log read on this path: the delete is keyed on the assertion id alone, and
      // a retraction must not become undeliverable because a read failed.
      expect(lookups).toEqual([]);
    });

    it("refuses a retraction that names no assertion", async () => {
      const { projector, unfolded } = harness();

      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_RETRACTED, { projectId }),
      ).rejects.toThrow(/without "assertionId"/);
      expect(unfolded).toEqual([]);
    });
  });

  describe("narrative effect applied", () => {
    it("folds the add half, where the effect row IS the assertion", async () => {
      const { projector, folded } = harness();

      const outcome = await projector.handleEvent(NARRATIVE_EFFECT_APPLIED, {
        projectId,
        effectType: "relationship_add",
        assertionId,
      });

      expect(folded).toHaveLength(1);
      expect(outcome).toEqual({ kind: "folded", sourceAssertionId: assertionId });
    });

    it("LEAVES THE EDGE STANDING on a narrated removal", async () => {
      const { projector, folded, unfolded, lookups } = harness();

      const outcome = await projector.handleEvent(NARRATIVE_EFFECT_APPLIED, {
        projectId,
        effectType: "relationship_remove",
        assertionId: null,
        terminationId,
        targetAssertionId: assertionId,
      });

      // The decision, asserted as an absence. A narrated removal writes `terminate`,
      // not `retract`: the fact HELD before its anchor, so deleting the edge would
      // answer "never held" to every earlier cut. Copying the `content_relationships`
      // precedent here — where both operations delete — is the silent failure this
      // test exists to catch.
      expect(unfolded).toEqual([]);
      expect(folded).toEqual([]);
      expect(lookups).toEqual([]);
      expect(outcome).toEqual({
        kind: "ignored",
        reason: "termination_keeps_the_edge",
      });
    });

    it("refuses a narrated removal that wrote no termination row", async () => {
      const { projector } = harness();

      // 4b-3 is what made this path write to the log at all; before it, the removal
      // deleted the projection and left the original assertion applied and
      // unwithdrawn. A payload with no `terminationId` is that regression arriving as
      // data, and doing nothing would look identical to the correct case.
      await expect(
        projector.handleEvent(NARRATIVE_EFFECT_APPLIED, {
          projectId,
          effectType: "relationship_remove",
          targetAssertionId: assertionId,
        }),
      ).rejects.toThrow(/without "terminationId"/);
    });

    it("ignores an attribute change, which publishes the same key", async () => {
      const { projector, folded, unfolded } = harness();

      const outcome = await projector.handleEvent(NARRATIVE_EFFECT_APPLIED, {
        projectId,
        effectType: "attribute_change",
      });

      expect(outcome).toEqual({
        kind: "ignored",
        reason: "not_a_relationship_fact",
      });
      expect(folded).toEqual([]);
      expect(unfolded).toEqual([]);
    });

    it("refuses an effect type it has no fold for", async () => {
      const { projector } = harness();

      await expect(
        projector.handleEvent(NARRATIVE_EFFECT_APPLIED, {
          projectId,
          effectType: "retract",
        }),
      ).rejects.toThrow(/has no fold for/);
    });
  });

  describe("keys outside the fold", () => {
    it("dead-letters a key it has no fold for rather than dropping it", async () => {
      const { projector } = harness();

      // The queue binds two PATTERNS, so a new verb under either prefix arrives here
      // without any broker change — that is the property the binding was chosen for.
      // Loud is the right failure: a silently ignored fact is missing from the graph
      // and nothing says so.
      await expect(
        projector.handleEvent("content.relationship.terminated", asserted),
      ).rejects.toThrow(/has no fold for/);
    });

    it("refuses any event without a project", async () => {
      const { projector } = harness();

      await expect(
        projector.handleEvent(CONTENT_RELATIONSHIP_ASSERTED, { assertionId }),
      ).rejects.toThrow(/without "projectId"/);
    });
  });
});

describe("GraphProjector.rebuildProject", () => {
  const assertOperation: LoggedOperation = {
    id: assertionId,
    effectType: "relationship_add",
    targetAssertionId: null,
  };
  const operations: LoggedOperation[] = [
    assertOperation,
    {
      id: "00000000-0000-4000-8000-0000000000b1",
      effectType: "terminate",
      targetAssertionId: assertionId,
    },
    {
      id: "00000000-0000-4000-8000-0000000000b2",
      effectType: "attribute_change",
      targetAssertionId: null,
    },
    {
      id: "00000000-0000-4000-8000-0000000000b3",
      effectType: "retract",
      targetAssertionId: assertionId,
    },
  ];

  it("drops the fold, replays only the asserts, then prunes orphan nodes", async () => {
    const { projector, folded, unfolded, wiped } = harness(
      binaryAssertion,
      operations,
    );

    const outcome = await projector.rebuildProject(projectId);

    expect(wiped).toEqual([projectId]);
    // One `relationship_add` among four operations. `terminate` is skipped because a
    // terminated fact HELD — its edge belongs in the graph — and `attribute_change` is not
    // a relationship fact.
    expect(folded).toHaveLength(1);
    expect(outcome).toEqual({
      edgesDropped: 2,
      factsFolded: 1,
      operationsSkipped: 3,
      orphanNodesPruned: 3,
    });

    // `retract` rows are NOT replayed as deletes. Retraction is already refused inside
    // `fold()` by reading the log, and a second implementation of the same rule is what
    // 4b-3 removed ("satu fold, dua pemanggil"): a mutation could then kill one mechanism
    // and stay green through the other.
    expect(unfolded).toEqual([]);
  });

  it("counts a retracted assert as skipped instead of folding it", async () => {
    const { projector, folded, pruned } = harness(
      { ...binaryAssertion, retracted: true },
      [assertOperation],
    );

    const outcome = await projector.rebuildProject(projectId);

    // Same guard as the live path, reached through the rebuild. "The log had 1 assert and
    // the graph got 0" is a countable line, not a silence.
    expect(folded).toEqual([]);
    expect(outcome.factsFolded).toBe(0);
    expect(outcome.operationsSkipped).toBe(1);
    // Pruning still runs — it is what clears the endpoints of facts that no longer stand.
    expect(pruned).toEqual([projectId]);
  });

  it("drops FIRST and prunes LAST, which is the part a count cannot see", async () => {
    const { projector, calls } = harness(binaryAssertion, [assertOperation]);

    await projector.rebuildProject(projectId);

    // Both ends matter. Pruning before the re-fold would cascade away the very edges being
    // rebuilt (`onDelete: Cascade` on both node foreign keys); dropping after the re-fold
    // would delete what was just written.
    expect(calls).toEqual(["wipe", `fold:${assertionId}`, "prune"]);
  });
});
