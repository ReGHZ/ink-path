import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createGraphProjector } from "../../src/domains/validation/internal/application/GraphProjector.js";
import { PrismaAssertionLogReader } from "../../src/domains/validation/internal/infrastructure/PrismaAssertionLogReader.js";
import { PrismaEvaluationGraphRepository } from "../../src/domains/validation/internal/infrastructure/PrismaEvaluationGraphRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { deleteFoldsAndAssertions } from "../helpers/foldCleanup.js";
import {
  seedOriginAssertion,
  seedProjectVocabulary,
} from "../helpers/relationshipVocabulary.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Step 4b-4, stage A. Everything asserted here is something only a real database
// can answer: two composite foreign keys, one unique index, and the transaction
// boundary around a fold. A unit test with a fake client would restate the code.
//
// What is NOT here, on purpose: which log operation calls which method. That is
// `GraphProjector` (stage B), and the one decision it carries — `retract` deletes
// the edge, `terminate` does NOT (`03-database-design/15_validation_tables.md`
// §ADDENDUM 2026-08-19 butir 1) — belongs to its own test, because this port has
// no `terminate` method to exercise.
//
// FIXTURE ID BLOCK 020 — owner/project ids end in `...0000000020NN`, entity and
// assertion ids use the `67676767` prefix. Both were unused when this file was
// written (blocks 000-019 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-66/68-70
// claimed elsewhere). Vitest runs test FILES in parallel and each one cleans up its
// own project, so a shared block makes two files delete each other's fixtures —
// intermittently, which is the worst version of it. Grep the block AND the prefix
// before adding fixtures.
const now = new Date("2026-08-19T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000002001";
const projectId = "00000000-0000-4000-8000-000000002002";
const neighbourProjectId = "00000000-0000-4000-8000-000000002003";

const characterA = "67676767-0000-4000-8000-0000000000ca";
const characterB = "67676767-0000-4000-8000-0000000000cb";
const characterC = "67676767-0000-4000-8000-0000000000cc";

const assertionAlly = "67676767-0000-4000-8000-000000000001";
const assertionEnemy = "67676767-0000-4000-8000-000000000002";
const assertionAllyAgain = "67676767-0000-4000-8000-000000000003";
const neighbourAssertion = "67676767-0000-4000-8000-0000000000f1";
const attributeTransition = "67676767-0000-4000-8000-0000000000f2";
const attributeAssertion = "67676767-0000-4000-8000-0000000000f3";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const graph = new PrismaEvaluationGraphRepository(prisma);
const assertionLog = new PrismaAssertionLogReader(prisma);
const projector = createGraphProjector({
  assertionLogReader: assertionLog,
  evaluationGraphRepository: graph,
});

const allyOf = "ally_of";
const enemyOf = "enemy_of";

async function cleanDatabase(client: PrismaClient): Promise<void> {
  const ids = [projectId, neighbourProjectId];

  // Folds and log first, in the five-level order the helper owns — the fourth-level
  // order that was correct before 4b-4 now fails on `evaluation_edges`, and it fails
  // with a message about `assertions`.
  await deleteFoldsAndAssertions(client, ids);
  await client.project.deleteMany({ where: { id: { in: ids } } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function captureError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }

  throw new Error("expected the database to refuse this write, it succeeded");
}

function allyFact(overrides: {
  sourceAssertionId?: string;
  projectId?: string;
  relationshipType?: string;
  objectEntityId?: string;
}) {
  return {
    projectId: overrides.projectId ?? projectId,
    sourceAssertionId: overrides.sourceAssertionId ?? assertionAlly,
    relationshipType: overrides.relationshipType ?? allyOf,
    subject: { entityType: "character" as const, entityId: characterA },
    object: {
      entityType: "character" as const,
      entityId: overrides.objectEntityId ?? characterB,
    },
  };
}

beforeEach(async () => {
  await cleanDatabase(prisma);

  await users.insert(
    User.create({
      id: ownerUserId,
      email: "graph-fold-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  for (const [id, name] of [
    [projectId, "Graph fold project"],
    [neighbourProjectId, "Graph fold neighbour"],
  ] as const) {
    await projects.insert(
      Project.create({
        id,
        ownerUserId,
        createdByUserId: ownerUserId,
        name,
        now,
      }),
    );

    // Both projects, because the tenancy test needs a real assertion living in the
    // OTHER project — one that satisfies every constraint except belonging here.
    await seedProjectVocabulary(prisma, id);
  }

  for (const [id, predicate, object] of [
    [assertionAlly, allyOf, characterB],
    [assertionEnemy, enemyOf, characterC],
    // The SAME fact as `assertionAlly`, asserted a second time. Premis §8.3 allows
    // it explicitly (two authors, or an assert → terminate → assert-again interval
    // set), so the log holds two rows and the fold must be able to as well.
    [assertionAllyAgain, allyOf, characterB],
  ] as const) {
    await seedOriginAssertion(prisma, {
      id,
      projectId,
      predicate,
      subjectEntityId: characterA,
      objectEntityId: object,
      now,
    });
  }

  await seedOriginAssertion(prisma, {
    id: neighbourAssertion,
    projectId: neighbourProjectId,
    predicate: allyOf,
    subjectEntityId: characterA,
    objectEntityId: characterB,
    now,
  });

  // An `attribute_change` row: the one log row that legitimately carries neither a
  // predicate nor an object, which is what makes it the fixture for the reader's
  // null mapping. Provenance comes from a parent transition — the
  // `assertions_has_provenance` CHECK wants one of the two, and an
  // attribute change has no definition to point at.
  await prisma.narrativeTransition.create({
    data: {
      id: attributeTransition,
      projectId,
      sourceEntityType: "chapter",
      sourceEntityId: characterC,
      title: "Bab yang menamai ulang",
      declaredByUserId: ownerUserId,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.assertion.create({
    data: {
      id: attributeAssertion,
      projectId,
      narrativeTransitionId: attributeTransition,
      operation: "attribute_change",
      targetEntityType: "character",
      targetEntityId: characterA,
      fieldPath: "name",
      newValue: "Bima Sakti",
      appliedAt: now,
      createdAt: now,
    },
  });
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

describe("PrismaEvaluationGraphRepository", () => {
  describe("upsertFact", () => {
    it("folds an assertion into two nodes and one edge that names it", async () => {
      await graph.upsertFact(allyFact({}));

      const edge = await prisma.evaluationEdge.findUniqueOrThrow({
        where: {
          sourceAssertionId_projectId: {
            sourceAssertionId: assertionAlly,
            projectId,
          },
        },
        include: { sourceNode: true, targetNode: true },
      });

      expect(edge.relationshipType).toBe(allyOf);
      expect(edge.sourceNode.entityId).toBe(characterA);
      expect(edge.sourceNode.entityType).toBe("character");
      expect(edge.targetNode.entityId).toBe(characterB);

      // The provenance pointer is the reason this stage exists: without it the
      // executor would have to find an edge's origin by matching the fact pattern
      // back onto the log, which is bug class C-1.
      expect(edge.sourceAssertionId).toBe(assertionAlly);
    });

    it("reuses the node when a second fact touches the same entity", async () => {
      await graph.upsertFact(allyFact({}));
      await graph.upsertFact(
        allyFact({
          sourceAssertionId: assertionEnemy,
          relationshipType: enemyOf,
          objectEntityId: characterC,
        }),
      );

      const nodes = await prisma.evaluationNode.findMany({
        where: { projectId },
        select: { entityId: true },
      });

      // Three entities, three nodes — not four. `(project_id, entity_id)` is the
      // node's identity, so `characterA` is one node holding two edges rather than
      // one node per fact.
      expect(nodes.map((node) => node.entityId).sort()).toEqual(
        [characterA, characterB, characterC].sort(),
      );
      expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(2);
    });

    it("is idempotent when the same assertion is folded twice", async () => {
      await graph.upsertFact(allyFact({}));
      await graph.upsertFact(allyFact({}));

      // A redelivered projector event must not produce a second edge. The conflict
      // target is the assertion id, which is what makes this an upsert rather than
      // a duplicate.
      expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(1);
      expect(await prisma.evaluationNode.count({ where: { projectId } })).toBe(2);
    });

    it("keeps both edges when the same fact is asserted by two assertions", async () => {
      await graph.upsertFact(allyFact({}));
      await graph.upsertFact(allyFact({ sourceAssertionId: assertionAllyAgain }));

      // The counterpart of the test above, and the reason the unique index is on the
      // ASSERTION rather than on (project, source, target, predicate): a fact
      // asserted twice is two rows, each retractable on its own. Under a fact-level
      // unique the second assertion would collide with the row a `terminate` had
      // deliberately left standing, and the re-assertion would be silently lost.
      const edges = await prisma.evaluationEdge.findMany({
        where: { projectId },
        select: { sourceAssertionId: true },
      });

      expect(edges.map((edge) => edge.sourceAssertionId).sort()).toEqual(
        [assertionAlly, assertionAllyAgain].sort(),
      );
    });

    it("refuses an assertion that belongs to another project", async () => {
      const error = await captureError(
        graph.upsertFact(allyFact({ sourceAssertionId: neighbourAssertion })),
      );

      expect(error).toBeInstanceOf(Error);

      // Nothing partial landed. The node upserts run in the SAME transaction as the
      // edge, so a rejected edge takes its endpoints with it — otherwise the graph
      // would hold endpoints for a fact it does not contain, indistinguishable later
      // from an entity that genuinely has no relationships.
      expect(await prisma.evaluationNode.count({ where: { projectId } })).toBe(0);
      expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(0);
    });

    it("refuses a predicate the project has not defined", async () => {
      const error = await captureError(
        graph.upsertFact(allyFact({ relationshipType: "not_a_predicate" })),
      );

      // §ADDENDUM butir 6. Before this constraint the column was free TEXT with no
      // enum and no CHECK, so the diegetic fold could name a predicate the project
      // does not have — while the CRUD fold, one table over, could not. Two folds
      // over one log, one vocabulary.
      expect(error).toBeInstanceOf(Error);
      expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(0);
    });

    it("refuses deleting the origin assertion while its edge stands", async () => {
      await graph.upsertFact(allyFact({}));

      const error = await captureError(
        prisma.assertion.delete({ where: { id: assertionAlly } }),
      );

      // `onDelete: Restrict`. The application cannot delete an applied assertion at
      // all (append-only), so this refuses the one route left — hand-run SQL — and
      // refuses it for the right reason: an edge whose origin was deleted could no
      // longer say what fact it is a fold of. It is also why test cleanup is five
      // levels now, projections in front.
      expect(error).toBeInstanceOf(Error);
      expect(
        await prisma.assertion.count({ where: { id: assertionAlly } }),
      ).toBe(1);
    });
  });

  describe("deleteFactBySourceAssertion", () => {
    it("removes the retracted edge and leaves the nodes standing", async () => {
      await graph.upsertFact(allyFact({}));
      await graph.upsertFact(
        allyFact({
          sourceAssertionId: assertionEnemy,
          relationshipType: enemyOf,
          objectEntityId: characterC,
        }),
      );

      const removed = await graph.deleteFactBySourceAssertion({
        projectId,
        sourceAssertionId: assertionAlly,
      });

      expect(removed).toBe(1);

      const remaining = await prisma.evaluationEdge.findMany({
        where: { projectId },
        select: { sourceAssertionId: true },
      });

      expect(remaining).toEqual([{ sourceAssertionId: assertionEnemy }]);

      // The nodes stay. Both node foreign keys cascade, so deleting `characterA`
      // here would take the `enemy_of` edge with it — retracting one fact would
      // silently erase an unrelated one.
      expect(await prisma.evaluationNode.count({ where: { projectId } })).toBe(3);
    });

    it("answers zero when the assertion produced no edge", async () => {
      const removed = await graph.deleteFactBySourceAssertion({
        projectId,
        sourceAssertionId: assertionAlly,
      });

      // Zero is a NORMAL answer, twice over: a `retract` may target a `terminate`
      // row (premis §8.3 AMENDMENT 2026-08-18), and a `terminate` never produced an
      // edge to remove; a redelivered retraction finds the edge already gone. The
      // count is returned rather than swallowed so the projector can log the
      // difference instead of inferring it.
      expect(removed).toBe(0);
    });

    it("does not reach across projects with a borrowed assertion id", async () => {
      await graph.upsertFact(allyFact({}));

      const removed = await graph.deleteFactBySourceAssertion({
        projectId: neighbourProjectId,
        sourceAssertionId: assertionAlly,
      });

      // `projectId` is in the filter, not just in the id. A delete scoped to one
      // tenant cannot be turned into a cross-tenant delete by a caller that passes
      // an id from somewhere else.
      expect(removed).toBe(0);
      expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(1);
    });
  });
});

// The read half of stage B. `GraphProjector.test.ts` proves the FOLD's decisions on
// a fake log; this proves the fake is a fair stand-in for the real one — the
// mapping and, above all, the tenancy scoping, which a unit test with an injected
// reader cannot see at all.
describe("PrismaAssertionLogReader", () => {
  it("reads the row the projector will fold, endpoints included", async () => {
    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: assertionAlly,
    });

    // The whole reason the projector reads the log: `content.relationship.asserted`
    // carries no endpoints, so these two are only available from here.
    expect(row).toEqual({
      id: assertionAlly,
      operation: "relationship_add",
      relationshipType: allyOf,
      retracted: false,
      subject: { entityType: "character", entityId: characterA },
      object: { entityType: "character", entityId: characterB },
    });
  });

  it("does not read an assertion belonging to another project", async () => {
    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: neighbourAssertion,
    });

    // The id alone would have found it — `findUnique` on the primary key does. Scoping
    // the read to the project is what stops an event from one tenant folding another
    // tenant's fact, and it is the composite boundary every other key in this schema
    // enforces.
    expect(row).toBeNull();
  });

  it("answers null for an assertion the log does not have", async () => {
    const row = await assertionLog.findAssertion({
      projectId,
      // Inside this file's prefix, deliberately never written.
      assertionId: "67676767-0000-4000-8000-0000000000ff",
    });

    expect(row).toBeNull();
  });

  it("maps a row with no predicate and no object to nulls, not to a half endpoint", async () => {
    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: attributeAssertion,
    });

    // An attribute change is not a relationship fact, and the projector answers
    // `ignored` for it. What matters here is that the reader says so with nulls
    // rather than handing up an endpoint built from a null id.
    expect(row).toEqual({
      id: attributeAssertion,
      operation: "attribute_change",
      relationshipType: null,
      retracted: false,
      subject: { entityType: "character", entityId: characterA },
      object: null,
    });
  });
});

// Closing gerbang 4b-4 blokir G4-1, against a real database rather than a fake log: the
// hazard is a FACT ABOUT ROWS (is there a retraction of this assertion?), so the query
// that answers it has to be exercised where the rows live.
async function retract(assertionId: string): Promise<string> {
  const retraction = await prisma.assertion.create({
    data: {
      projectId,
      narrativeTransitionId: attributeTransition,
      operation: "retract",
      targetEntityType: "character",
      targetEntityId: characterA,
      targetAssertionId: assertionId,
      // The composite self-FK carries the target's KIND, so a retraction cannot claim to
      // act on a row of a different type than it really does (C-1).
      targetOperation: "relationship_add",
      appliedAt: now,
      createdAt: now,
    },
    select: { id: true },
  });

  return retraction.id;
}

// A real `terminate` row — the one fixture combination this file never wrote before, and
// the reason blokir H-1 existed: every test that exercised the ordering guard wrote a
// `retract`, so the predicate telling the two apart had nothing holding it.
async function terminate(assertionId: string): Promise<string> {
  const termination = await prisma.assertion.create({
    data: {
      projectId,
      narrativeTransitionId: attributeTransition,
      operation: "terminate",
      targetEntityType: "character",
      targetEntityId: characterA,
      targetAssertionId: assertionId,
      targetOperation: "relationship_add",
      // A termination is VALID-TIME: it says the fact stopped holding at a story moment,
      // so it carries the anchor its parent transition declares. `anchor_complete` refuses
      // half an anchor.
      anchorEntityType: "chapter",
      anchorEntityId: characterC,
      appliedAt: now,
      createdAt: now,
    },
    select: { id: true },
  });

  return termination.id;
}

describe("ordering hazard: retract processed before assert", () => {

  it("reads the retraction through the same query the fold already makes", async () => {
    await retract(assertionAlly);

    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: assertionAlly,
    });

    // One query, via the log's own self-relation — not a second round trip on the hot path.
    expect(row?.retracted).toBe(true);
  });

  it("does not resurrect the fact when the assert arrives after the retraction", async () => {
    await retract(assertionAlly);

    const outcome = await projector.handleEvent("content.relationship.asserted", {
      projectId,
      assertionId: assertionAlly,
    });

    // Before this guard: `deleteMany` had matched nothing (0 is a documented NORMAL answer,
    // so no alarm), then this assert wrote the edge, and the withdrawn fact stood in the
    // graph permanently. Arrival order no longer decides the outcome.
    expect(outcome).toEqual({
      kind: "ignored",
      reason: "already_retracted_in_the_log",
    });
    expect(await prisma.evaluationEdge.count({ where: { projectId } })).toBe(0);
  });

  it("rebuilds the fold from the log, repairing damage that is already in the graph", async () => {
    // Simulates the damage the guard now prevents, by writing the fold directly — which is
    // exactly what an out-of-order pair produced before, and what a future ordering bug
    // would produce again. The rebuild is what makes such damage repairable instead of
    // permanent (premis §8.4: the projection is derived).
    await graph.upsertFact({
      projectId,
      sourceAssertionId: assertionAlly,
      relationshipType: allyOf,
      subject: { entityType: "character", entityId: characterA },
      object: { entityType: "character", entityId: characterB },
    });
    await graph.upsertFact({
      projectId,
      sourceAssertionId: assertionEnemy,
      relationshipType: enemyOf,
      subject: { entityType: "character", entityId: characterA },
      object: { entityType: "character", entityId: characterC },
    });
    // BOTH assertions of the A-B fact are withdrawn — `beforeEach` seeds it twice on
    // purpose (premis §8.3 allows the same fact asserted more than once), and a rebuild
    // that only handled the first would leave the fact standing through the second.
    await retract(assertionAlly);
    await retract(assertionAllyAgain);

    const outcome = await projector.rebuildProject(projectId);

    // The retracted fact is gone, the untouched one is back, and the endpoint left with no
    // facts at all is pruned — which is also the answer to "orphan nodes accumulate".
    const remaining = await prisma.evaluationEdge.findMany({
      where: { projectId },
      select: { sourceAssertionId: true },
    });

    expect(remaining).toEqual([{ sourceAssertionId: assertionEnemy }]);
    expect(outcome.factsFolded).toBe(1);
    expect(outcome.edgesDropped).toBe(2);
    // `characterB` was an endpoint of the withdrawn fact only, so the rebuild leaves it
    // with no edges — which is also the answer to "orphan nodes accumulate forever".
    expect(outcome.orphanNodesPruned).toBe(1);

    const nodes = await prisma.evaluationNode.findMany({
      where: { projectId },
      select: { entityId: true },
    });

    expect(nodes.map((node) => node.entityId).sort()).toEqual(
      [characterA, characterC].sort(),
    );
  });
});

// Blokir H-1 of the closure gate. The ordering guard asks the log one question, and the
// whole of keputusan beku 1 lives inside its `where`: `retract` withdraws a claim,
// `terminate` does NOT. A `terminate` row points at the same assertion through the same
// column, so without that filter a TERMINATED fact reads as "already withdrawn" — and the
// damage lands twice: the live fold starts refusing redelivered terminated facts, and
// `rebuildProject` deletes every fact that was ever terminated. Every table stays
// consistent, every test stayed green, and every question about a cut before the anchor
// turns wrong.
describe("terminate is NOT retraction, inside the ordering guard", () => {
  it("reads a terminated assertion as NOT retracted", async () => {
    await terminate(assertionAlly);

    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: assertionAlly,
    });

    expect(row?.retracted).toBe(false);
  });

  it("still folds a terminated fact on the live path", async () => {
    await terminate(assertionAlly);

    const outcome = await projector.handleEvent("content.relationship.asserted", {
      projectId,
      assertionId: assertionAlly,
    });

    // The fact HELD before its anchor, so its edge belongs in the graph — that is the
    // entire reason `terminate` leaves the row standing while `retract` deletes it.
    expect(outcome).toEqual({ kind: "folded", sourceAssertionId: assertionAlly });
    expect(
      await prisma.evaluationEdge.count({
        where: { projectId, sourceAssertionId: assertionAlly },
      }),
    ).toBe(1);
  });

  it("keeps terminated facts when the fold is rebuilt from the log", async () => {
    await terminate(assertionAlly);

    const outcome = await projector.rebuildProject(projectId);

    // The sharper half of the same regression: the repair tool would otherwise SWEEP AWAY
    // the past it exists to preserve. Three assertions are seeded, one of them terminated —
    // all three must come back.
    const remaining = await prisma.evaluationEdge.findMany({
      where: { projectId },
      select: { sourceAssertionId: true },
    });

    expect(remaining.map((edge) => edge.sourceAssertionId).sort()).toEqual(
      [assertionAlly, assertionAllyAgain, assertionEnemy].sort(),
    );
    expect(outcome.factsFolded).toBe(3);
  });

  it("still refuses the fact once the termination is followed by a retraction", async () => {
    await terminate(assertionAlly);
    await retract(assertionAlly);

    // Both rows now point at the same assertion. The filter has to pick the retraction out
    // of the pair rather than answer "there is something here".
    const row = await assertionLog.findAssertion({
      projectId,
      assertionId: assertionAlly,
    });

    expect(row?.retracted).toBe(true);
  });
});

// Syarat H-2: the rebuild's wipe is scoped to one project, like every sibling method.
describe("rebuild does not reach across projects", () => {
  it("leaves another project's fold standing", async () => {
    await graph.upsertFact({
      projectId: neighbourProjectId,
      sourceAssertionId: neighbourAssertion,
      relationshipType: allyOf,
      subject: { entityType: "character", entityId: characterA },
      object: { entityType: "character", entityId: characterB },
    });

    await projector.rebuildProject(projectId);

    // `pnpm graph:rebuild <projectId>` is an operator command, so an unscoped wipe would
    // take every tenant's graph with it — recoverable, but only by rebuilding each one, and
    // only if someone noticed.
    expect(
      await prisma.evaluationEdge.count({
        where: { projectId: neighbourProjectId },
      }),
    ).toBe(1);
  });
});
