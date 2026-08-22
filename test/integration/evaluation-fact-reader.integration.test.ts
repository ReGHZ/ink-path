import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { displayLabelFromSymbol } from "../../src/domains/content/internal/domain/support/relationshipDefinitionSeed.js";
import { NarrativeTransition } from "../../src/domains/content/internal/domain/transition/NarrativeTransition.js";
import { PrismaNarrativeTransitionRepository } from "../../src/domains/content/internal/infrastructure/transition/PrismaNarrativeTransitionRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { PrismaEvaluationFactReader } from "../../src/domains/validation/internal/infrastructure/PrismaEvaluationFactReader.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { deleteEvaluationFold } from "../helpers/foldCleanup.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Asserts over the SNAPSHOT, not over a rule outcome — and that is the whole
// reason this file exists. The 2026-08-18 quality gate showed that outcome-level
// tests cannot see most of what this reader does: several of its behaviours have
// no effect on the three canonical criteria, so they were deletable without
// turning a single test red.
//
// Proved by mutation, before this file existed:
//   · emptying `terminatedIds` → 38 tests still green
//   · emptying `retractedIds`  → 38 tests still green
//   · dropping `projectId` from the assertion query → 5 e2e tests still green
//
// Each of those is a wrong ANSWER, not a wrong internal: a retracted fact read
// as still holding produces `conflict` over a claim the author withdrew.
//
// FIXTURE ID BLOCK 018 — owner/project ids end in `...0000000018NN`, content and
// assertion ids use the `69696969` prefix. Both unused when this file was
// written (blocks 000-017 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-68
// claimed elsewhere). Vitest runs test FILES in parallel and each cleans up its
// own project, so a shared block makes two files delete each other's fixtures
// intermittently. Grep the block AND the prefix before adding fixtures.
const now = new Date("2026-08-18T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001801";
const projectId = "00000000-0000-4000-8000-000000001802";
const neighbourProjectId = "00000000-0000-4000-8000-000000001803";

const characterId = "69696969-0000-4000-8000-0000000000ca";
const chapterId = "69696969-0000-4000-8000-0000000000cb";
const sceneId = "69696969-0000-4000-8000-00000000005c";
const transitionId = "69696969-0000-4000-8000-000000000001";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const transitions = new PrismaNarrativeTransitionRepository(prisma);
const reader = new PrismaEvaluationFactReader(prisma);

let deadDefinitionId = "";

async function cleanDatabase(client: PrismaClient): Promise<void> {
  const ids = [projectId, neighbourProjectId];

  // Assertions before definitions before content before project: every FK on
  // this path is onDelete: Restrict, so any other order fails instead of
  // cascading, and the failure would land inside an unrelated test's fixtures.
  await deleteEvaluationFold(client, ids);
  await client.assertion.deleteMany({ where: { projectId: { in: ids } } });
  await client.narrativeTransition.deleteMany({
    where: { projectId: { in: ids } },
  });
  await client.relationshipDefinition.deleteMany({
    where: { projectId: { in: ids } },
  });
  await client.scene.deleteMany({ where: { projectId: { in: ids } } });
  await client.chapter.deleteMany({ where: { projectId: { in: ids } } });
  await client.character.deleteMany({ where: { projectId: { in: ids } } });
  await client.project.deleteMany({ where: { id: { in: ids } } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function assertDead(anchor: {
  type: "chapter" | "scene" | "event";
  id: string;
}): Promise<string> {
  const created = await prisma.assertion.create({
    data: {
      projectId,
      narrativeTransitionId: null,
      relationshipDefinitionId: deadDefinitionId,
      operation: "relationship_add",
      targetEntityType: "character",
      targetEntityId: characterId,
      anchorEntityType: anchor.type,
      anchorEntityId: anchor.id,
    },
  });

  return created.id;
}

beforeEach(async () => {
  await cleanDatabase(prisma);

  await users.insert(
    User.create({
      id: ownerUserId,
      email: "fact-reader-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  for (const [id, name] of [
    [projectId, "Fact reader project"],
    [neighbourProjectId, "Fact reader neighbour"],
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
  }

  await prisma.character.create({
    data: {
      id: characterId,
      projectId,
      createdByUserId: ownerUserId,
      name: "Bima",
    },
  });
  await prisma.chapter.create({
    data: {
      id: chapterId,
      projectId,
      createdByUserId: ownerUserId,
      title: "Chapter 12",
      order: 12,
    },
  });
  await prisma.scene.create({
    data: {
      id: sceneId,
      projectId,
      chapterId,
      createdByUserId: ownerUserId,
      title: "At the gate",
      orderInChapter: 3,
    },
  });

  await transitions.insert(
    NarrativeTransition.create({
      id: transitionId,
      projectId,
      sourceEntityType: "chapter",
      sourceEntityId: chapterId,
      title: "Kematian",
      description: null,
      declaredByUserId: ownerUserId,
      reversesTransitionId: null,
      now,
    }),
  );

  const dead = await prisma.relationshipDefinition.create({
    data: {
      projectId,
      predicate: "dead",
      objectRequired: false,
      directionality: "directional",
      inverseLabel: "dead",
      displayLabel: displayLabelFromSymbol("dead"),
      inverseDisplayLabel: displayLabelFromSymbol("dead"),
      signatures: {
        create: [{ subjectEntityType: "character", objectEntityType: null }],
      },
    },
  });
  deadDefinitionId = dead.id;
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

describe("PrismaEvaluationFactReader", () => {
  it("declares only the entity types it actually enumerates", async () => {
    const snapshot = await reader.read(projectId);

    // Six of the grammar's nine are absent, and the evaluator turns a binding
    // over any of them into `unsupported`. Listing three here is what makes
    // that possible; an empty entity list alone is indistinguishable from a
    // project that simply has no factions.
    expect([...snapshot.enumerableEntityTypes].sort()).toEqual([
      "chapter",
      "character",
      "scene",
    ]);
  });

  it("carries each predicate's arity so a rule can be checked against it", async () => {
    const snapshot = await reader.read(projectId);

    expect(snapshot.predicates).toEqual([
      { id: deadDefinitionId, objectRequired: false },
    ]);
  });

  describe("positions", () => {
    it("gives a scene both of its coordinates", async () => {
      const snapshot = await reader.read(projectId);
      const scene = snapshot.entities.find((entity) => entity.id === sceneId);

      // `orderInChapter` is what makes two scenes inside one chapter
      // comparable. Collapsing a scene to its chapter's order alone answered
      // `valid` for contradictions that sit inside a single chapter.
      expect(scene?.position).toEqual({
        kind: "scene",
        chapterOrder: 12,
        orderInChapter: 3,
      });
    });

    it("gives a chapter no position inside itself", async () => {
      const snapshot = await reader.read(projectId);
      const chapter = snapshot.entities.find(
        (entity) => entity.id === chapterId,
      );

      expect(chapter?.position).toEqual({ kind: "chapter", chapterOrder: 12 });
    });

    it("resolves a scene anchor to that scene's exact position", async () => {
      await assertDead({ type: "scene", id: sceneId });

      const snapshot = await reader.read(projectId);

      expect(snapshot.assertions[0]?.anchorPosition).toEqual({
        kind: "scene",
        chapterOrder: 12,
        orderInChapter: 3,
      });
    });

    it("leaves an event anchor unplaced", async () => {
      const event = await prisma.event.create({
        data: {
          projectId,
          createdByUserId: ownerUserId,
          title: "A death nobody dated",
          timelineOrder: null,
        },
      });

      await assertDead({ type: "event", id: event.id });

      const snapshot = await reader.read(projectId);

      // The diegetic axis is not materialised by any projection yet. Null
      // propagates to `unsupported`; borrowing an artifact position would
      // invent an ordering the story does not have.
      expect(snapshot.assertions[0]?.anchorPosition).toBeNull();

      await deleteEvaluationFold(prisma, [projectId]);
      await prisma.assertion.deleteMany({ where: { projectId } });
      await prisma.event.deleteMany({ where: { id: event.id } });
    });
  });

  describe("retract and terminate", () => {
    it("drops a retracted assertion entirely", async () => {
      const assertionId = await assertDead({ type: "chapter", id: chapterId });

      await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: null,
          relationshipDefinitionId: deadDefinitionId,
          operation: "retract",
          targetEntityType: "character",
          targetEntityId: characterId,
          targetAssertionId: assertionId,
          targetOperation: "relationship_add",
        },
      });

      const snapshot = await reader.read(projectId);

      // Transaction-time: the claim counts as never having been made, at every
      // cut. Left in place it would produce `conflict` over something the
      // author withdrew.
      expect(snapshot.assertions).toHaveLength(0);
    });

    it("keeps a terminated assertion but marks it", async () => {
      const assertionId = await assertDead({ type: "chapter", id: chapterId });

      await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: null,
          relationshipDefinitionId: deadDefinitionId,
          operation: "terminate",
          targetEntityType: "character",
          targetEntityId: characterId,
          anchorEntityType: "scene",
          anchorEntityId: sceneId,
          targetAssertionId: assertionId,
          targetOperation: "relationship_add",
        },
      });

      const snapshot = await reader.read(projectId);

      // Valid-time: the fact HELD before its terminating anchor, so unlike a
      // retraction it must not disappear. The flag is what lets the evaluator
      // answer `unknown` rather than pretending in either direction.
      expect(snapshot.assertions).toHaveLength(1);
      expect(snapshot.assertions[0]?.terminated).toBe(true);
    });

    // The regression that a filter on `relationship_definition_id` used to
    // cause. `assertions_has_provenance` requires a parent transition
    // OR a predicate reference — not both — so this row is entirely legal, and
    // filtering on the predicate made the termination invisible while the fact
    // it terminates stayed readable.
    it("sees a terminate that carries only a parent transition", async () => {
      const assertionId = await assertDead({ type: "chapter", id: chapterId });

      await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: transitionId,
          relationshipDefinitionId: null,
          operation: "terminate",
          targetEntityType: "character",
          targetEntityId: characterId,
          targetAssertionId: assertionId,
          targetOperation: "relationship_add",
        },
      });

      const snapshot = await reader.read(projectId);

      expect(snapshot.assertions).toHaveLength(1);
      expect(snapshot.assertions[0]?.terminated).toBe(true);
    });

    it("does not turn a terminate row into an assertion of its own", async () => {
      const assertionId = await assertDead({ type: "chapter", id: chapterId });

      await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: null,
          relationshipDefinitionId: deadDefinitionId,
          operation: "terminate",
          targetEntityType: "character",
          targetEntityId: characterId,
          targetAssertionId: assertionId,
          targetOperation: "relationship_add",
        },
      });

      const snapshot = await reader.read(projectId);

      // Reading terminate rows for their target must not also fold them in as
      // facts — that would double the assertion and make the character dead
      // twice over.
      expect(snapshot.assertions).toHaveLength(1);
    });

    // C-1 (`quality-gate/gerbang-mutu-phase-11-slice-pass2-2026-08-18.md`),
    // decided in premis §8.3 AMENDMENT 2026-08-18. A mistyped termination is
    // corrected by retracting the terminate ROW — nothing erases it, the log
    // being append-only. Before this the retraction was stored and read as
    // nothing, so the fact stayed `terminated` forever and every rule over it
    // answered `unsupported` for good.
    //
    // The assertion below is on `terminated`, not on the outcome: `false` here
    // and `true` in the test above are the whole difference the correction
    // makes, and an outcome-level check would show it only indirectly.
    it("un-terminates a fact when the terminate row is itself retracted", async () => {
      const assertionId = await assertDead({ type: "chapter", id: chapterId });

      const termination = await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: null,
          relationshipDefinitionId: deadDefinitionId,
          operation: "terminate",
          targetEntityType: "character",
          targetEntityId: characterId,
          anchorEntityType: "scene",
          anchorEntityId: sceneId,
          targetAssertionId: assertionId,
          targetOperation: "relationship_add",
        },
      });

      await prisma.assertion.create({
        data: {
          projectId,
          narrativeTransitionId: null,
          relationshipDefinitionId: deadDefinitionId,
          operation: "retract",
          targetEntityType: "character",
          targetEntityId: characterId,
          targetAssertionId: termination.id,
          targetOperation: "terminate",
        },
      });

      const snapshot = await reader.read(projectId);

      // The fact itself was never retracted, so it is still here...
      expect(snapshot.assertions).toHaveLength(1);
      // ...and the termination that was withdrawn no longer marks it.
      expect(snapshot.assertions[0]?.terminated).toBe(false);
    });
  });

  // The mutation that survived the e2e tenancy test: dropping `projectId` from
  // the assertion query left all five e2e tests green, because the neighbour
  // project was empty and an empty assignment set answers `valid` regardless of
  // what leaked. Asserting over the snapshot is what kills that mutant —
  // outcome-level tests structurally cannot.
  it("reads no assertions for a project that has none, while another does", async () => {
    await assertDead({ type: "chapter", id: chapterId });

    const own = await reader.read(projectId);
    const neighbour = await reader.read(neighbourProjectId);

    expect(own.assertions).toHaveLength(1);
    expect(neighbour.assertions).toHaveLength(0);
    expect(neighbour.entities).toHaveLength(0);
    expect(neighbour.predicates).toHaveLength(0);
  });
});
