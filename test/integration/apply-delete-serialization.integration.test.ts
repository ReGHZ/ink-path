import { asValue } from "awilix";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createNarrativeTransitionService,
  type MutateTransitionInput,
  type NarrativeTransitionService,
} from "../../src/domains/content/internal/application/transition/NarrativeTransitionService.js";
import { NarrativeTransition } from "../../src/domains/content/internal/domain/transition/NarrativeTransition.js";
import { createNarrativeTransitionUnitOfWork } from "../../src/domains/content/internal/infrastructure/PrismaNarrativeTransitionUnitOfWork.js";
import { PrismaNarrativeTransitionRepository } from "../../src/domains/content/internal/infrastructure/transition/PrismaNarrativeTransitionRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createAppContainer } from "../../src/infrastructure/container.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { ErrorCode } from "../../src/shared/errors/ErrorCode.js";
import { isTransientDatabaseError } from "../../src/shared/infrastructure/prismaErrors.js";
import { deleteEvaluationFold } from "../helpers/foldCleanup.js";

import type { NarrativeTransitionUnitOfWork } from "../../src/domains/content/internal/application/ports/NarrativeTransitionUnitOfWork.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Langkah 4b-5, langkah 0+1 (`notes/phase-11-validation.md` §4b-5).
//
// These tests describe BEHAVIOUR, never a locking mechanism. Nothing here names
// `FOR UPDATE`, a lock mode, or a statement shape — the assertions are 409 / 404
// / "exactly one fact" / "no orphan child", all of which have to hold both under
// the two-level lock that exists today and under the predicate-carrying writes
// meant to replace it. That is the whole point: the file is the BRIDGE between
// the two mechanisms, not a description of either. `for-update-lock.integration.test.ts`
// asserts lock MODE and therefore dies with its subject; this one must survive
// the swap untouched, and if it needs editing at step 3, the replacement changed
// behaviour and the swap is wrong.
//
// Two clients, two pools, two backends. Reusing one client would put both
// transactions on the same connection, where the second queues behind the first
// no matter what the SQL says — a control that always passes (the finding that
// produced fixture block 019).
//
// The interleaving is produced by wrapping the UNIT OF WORK of connection A: the
// wrapper runs the service's whole transaction body, then parks BEFORE the
// commit, holding every lock that body took. No sleep-based approximation of
// "in flight" — the transaction is provably still open.
//
// FIXTURE ID BLOCK 022 — owner/project ids end in `...0000000022NN`, transition
// and entity ids use the `6b6b6b6b` prefix. Both were unused when this file was
// written (blocks 000-021 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-6a/70
// claimed elsewhere). Vitest runs test FILES in parallel and each cleans up its
// own project, so a shared block makes two files delete each other's fixtures
// intermittently. Grep the block AND the prefix before adding fixtures.
const BASE = new Date("2026-08-20T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000002201";
const projectId = "00000000-0000-4000-8000-000000002202";

const transitionId = "6b6b6b6b-0000-4000-8000-000000000001";
const otherTransitionId = "6b6b6b6b-0000-4000-8000-000000000002";
const effectId = "6b6b6b6b-0000-4000-8000-000000000011";
const otherEffectId = "6b6b6b6b-0000-4000-8000-000000000012";
const characterId = "6b6b6b6b-0000-4000-8000-0000000000ca";
const otherCharacterId = "6b6b6b6b-0000-4000-8000-0000000000cb";
const chapterId = "6b6b6b6b-0000-4000-8000-0000000000cc";
const characterRevisionId = "6b6b6b6b-0000-4000-8000-0000000000da";
const otherCharacterRevisionId = "6b6b6b6b-0000-4000-8000-0000000000db";

// Advancing clock, not the constant one the unit suites use. Two reasons, and
// the second is the one that matters here: a constant clock cannot tell "the
// second apply did nothing" from "the second apply rewrote the same value", so
// T3's timestamp comparison would be vacuous. It is also the harness the
// `const now` guard needs (`notes/tech-debt.md` §Penjaga `const now`).
let tick = 0;
const clock = {
  now: (): Date => new Date(BASE.getTime() + tick++ * 1000),
};

const prisma = createPrismaClient();
const rival = createPrismaClient();

const containerA = createAppContainer();
const containerB = createAppContainer();

containerA.register("prisma", asValue(prisma));
containerB.register("prisma", asValue(rival));

const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const transitions = new PrismaNarrativeTransitionRepository(prisma);

const writer: MutateTransitionInput = {
  requestingUserId: ownerUserId,
  requestingMembership: { role: "writer", canDelete: true },
};

// Long enough that an unblocked call has finished many times over, short enough
// to stay well inside Prisma's 5s interactive-transaction timeout. A lower bound
// on "B had its chance", never an upper bound on how long an honest query may
// take: a slow machine can only make a mutant survive, and the recorded ORDER of
// events is what closes that hole.
const CHANCE_TO_RUN_MS = 400;

type Gate = { readonly opened: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { opened, open };
}

function serviceOver(
  container: typeof containerA,
  unitOfWork: NarrativeTransitionUnitOfWork,
  idGenerator: { generate: () => string } = container.resolve("idGenerator"),
): NarrativeTransitionService {
  return createNarrativeTransitionService({
    clock,
    idGenerator,
    narrativeTransitionRepository: container.resolve(
      "narrativeTransitionRepository",
    ),
    transitionEffectRepository: container.resolve("transitionEffectRepository"),
    contentEntityLocator: container.resolve("contentEntityLocator"),
    narrativeTransitionUnitOfWork: unitOfWork,
    relationshipDefinitionReader: container.resolve(
      "relationshipDefinitionReader",
    ),
  });
}

// Connection B: ordinary service, nothing wrapped.
const rivalService = serviceOver(
  containerB,
  createNarrativeTransitionUnitOfWork({ prisma: rival }),
);

// Connection A, unwrapped. Used by the three-party test, where A is not the one
// being held.
const plainService = serviceOver(
  containerA,
  createNarrativeTransitionUnitOfWork({ prisma }),
);

// Same connection, but every id it mints is the one the caller names — so a
// THIRD party can apply the effect A is about to create without waiting for A to
// return it. Under the mechanism that protects this race A never returns at all
// (it is blocked), which is exactly why the id cannot come from its result.
function mintingService(id: string): NarrativeTransitionService {
  return serviceOver(
    containerA,
    createNarrativeTransitionUnitOfWork({ prisma }),
    { generate: () => id },
  );
}

// Connection B, paused in the MIDDLE of its transaction: right after it has read
// the children of a transition and before it acts on that list. The unit-of-work
// wrapper above can only park at the end of the body, which is too late to
// express the window the aggregate-root lock exists to close.
function interceptingService(
  afterReadingChildren: () => Promise<void>,
): NarrativeTransitionService {
  const inner = createNarrativeTransitionUnitOfWork({ prisma: rival });

  const unitOfWork: NarrativeTransitionUnitOfWork = {
    transaction: (work) =>
      inner.transaction(async (repositories, outboxEvents) => {
        // A Proxy rather than an object spread: the repository is a class
        // instance, so its methods live on the prototype and a spread would
        // silently drop all of them.
        const transitionEffects = new Proxy(repositories.transitionEffects, {
          get(target, property, receiver) {
            if (property === "findByTransitionId") {
              return async (transitionId: string) => {
                const rows = await target.findByTransitionId(transitionId);
                await afterReadingChildren();
                return rows;
              };
            }

            const value: unknown = Reflect.get(target, property, receiver);

            return typeof value === "function"
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        });

        return work({ ...repositories, transitionEffects }, outboxEvents);
      }),
  };

  return serviceOver(containerB, unitOfWork);
}

// Parks a service in the MIDDLE of a multi-row loop: right after the first row is
// processed, while its lock on that row is held and the rest of the loop has not
// run. Neither existing wrapper can express that — `holdingService` parks after the
// whole body, `interceptingService` before the loop starts — and the lock-ORDER
// property only exists between the first and second row.
function interceptingAfterFirst(
  client: PrismaClient,
  container: typeof containerA,
  method: "claimForApply" | "deleteIfPending",
): {
  service: NarrativeTransitionService;
  reachedFirst: Promise<void>;
  release: () => void;
} {
  const inner = createNarrativeTransitionUnitOfWork({ prisma: client });
  const reached = gate();
  const release = gate();
  let calls = 0;

  const unitOfWork: NarrativeTransitionUnitOfWork = {
    transaction: (work) =>
      inner.transaction(async (repositories, outboxEvents) => {
        const transitionEffects = new Proxy(repositories.transitionEffects, {
          get(target, property, receiver) {
            if (property === method) {
              return async (...args: unknown[]) => {
                const result = await (
                  target[method] as (...inner: unknown[]) => Promise<unknown>
                ).apply(target, args);

                calls += 1;

                if (calls === 1) {
                  reached.open();
                  await release.opened;
                }

                return result;
              };
            }

            const value: unknown = Reflect.get(target, property, receiver);

            return typeof value === "function"
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        });

        return work({ ...repositories, transitionEffects }, outboxEvents);
      }),
  };

  return {
    service: serviceOver(container, unitOfWork),
    reachedFirst: reached.opened,
    release: release.open,
  };
}

// Connection A: same service, but its transaction parks after the body and
// before the commit. `reached` resolves once the body is done (locks held),
// `release` lets the commit happen.
function holdingService(): {
  service: NarrativeTransitionService;
  reached: Promise<void>;
  release: () => void;
} {
  const inner = createNarrativeTransitionUnitOfWork({ prisma });
  const held = gate();
  const release = gate();

  const unitOfWork: NarrativeTransitionUnitOfWork = {
    transaction: (work) =>
      inner.transaction(async (repositories, outboxEvents) => {
        const result = await work(repositories, outboxEvents);

        held.open();
        await release.opened;

        return result;
      }),
  };

  return {
    service: serviceOver(containerA, unitOfWork),
    reached: held.opened,
    release: release.open,
  };
}

// Settles the promise into a flag without awaiting it, so a test can assert
// "still running" rather than "finished with X".
function watch<T>(promise: Promise<T>): { settled: () => boolean } {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  return { settled: () => settled };
}

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await deleteEvaluationFold(client, [projectId]);
  await client.contentRelationship.deleteMany({ where: { projectId } });
  await client.transitionEffect.deleteMany({ where: { projectId } });
  await client.narrativeTransition.deleteMany({ where: { projectId } });
  await client.character.deleteMany({ where: { projectId } });
  await client.contentRevision.deleteMany({ where: { projectId } });
  await client.outboxEvent.deleteMany({ where: { projectId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

beforeEach(async () => {
  tick = 0;

  await cleanDatabase(prisma);

  await users.insert(
    User.create({
      id: ownerUserId,
      email: "apply-delete-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now: BASE,
    }),
  );

  await projects.insert(
    Project.create({
      id: projectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Apply delete serialization project",
      now: BASE,
    }),
  );

  // Real rows: `applyAttributeChange` mutates the entity and writes a revision,
  // so an effect pointing at a phantom character would answer 404 for the wrong
  // reason and every assertion below would be measuring that instead.
  //
  // The creation revision is part of that realism and not fixture ceremony: the
  // domain refuses a character whose `current_revision_id` is empty
  // (`Character.ts:276-281`), and the real create path writes revision number
  // `version`, i.e. 0 for a fresh entity (`CharacterService.ts:221`). An apply
  // therefore writes revision number 1 — which is what lets the assertions below
  // count apply-produced revisions with `revisionNumber > 0` instead of
  // depending on a table that starts empty.
  await prisma.contentRevision.createMany({
    data: [
      {
        id: characterRevisionId,
        projectId,
        entityType: "character",
        entityId: characterId,
        revisionNumber: 0,
        changedByUserId: ownerUserId,
        changeType: "create",
        // `content_revisions_snapshot_presence` (migrasi
        // `20260711000200_init_constraints`): a `create` revision carries an
        // after-snapshot and no before-snapshot.
        afterSnapshot: { name: "Li Wei", archetype: null },
        createdAt: BASE,
      },
      {
        id: otherCharacterRevisionId,
        projectId,
        entityType: "character",
        entityId: otherCharacterId,
        revisionNumber: 0,
        changedByUserId: ownerUserId,
        changeType: "create",
        afterSnapshot: { name: "Chen", archetype: null },
        createdAt: BASE,
      },
    ],
  });

  await prisma.character.createMany({
    data: [
      {
        id: characterId,
        projectId,
        createdByUserId: ownerUserId,
        name: "Li Wei",
        currentRevisionId: characterRevisionId,
      },
      {
        id: otherCharacterId,
        projectId,
        createdByUserId: ownerUserId,
        name: "Chen",
        currentRevisionId: otherCharacterRevisionId,
      },
    ],
  });

  for (const [id, title] of [
    [transitionId, "Kematian di bab 12"],
    [otherTransitionId, "Perpisahan di bab 13"],
  ] as const) {
    await transitions.insert(
      NarrativeTransition.create({
        id,
        projectId,
        sourceEntityType: "chapter",
        sourceEntityId: chapterId,
        title,
        description: null,
        declaredByUserId: ownerUserId,
        reversesTransitionId: null,
        now: BASE,
      }),
    );
  }

  await prisma.transitionEffect.createMany({
    data: [
      {
        id: effectId,
        narrativeTransitionId: transitionId,
        projectId,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: characterId,
        fieldPath: "archetype",
        newValue: "mentor",
        createdAt: BASE,
      },
      {
        id: otherEffectId,
        narrativeTransitionId: otherTransitionId,
        projectId,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: otherCharacterId,
        fieldPath: "archetype",
        newValue: "rival",
        createdAt: BASE,
      },
    ],
  });
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
  await rival.$disconnect();
});

describe("apply vs delete, serialised — behaviour, not mechanism", () => {
  // T1. The delete has to WAIT and then refuse. "0 rows deleted, reported as
  // success" is the failure this test exists to reject: it would leave the
  // caller believing a fact was withdrawn.
  it("makes a delete of an effect wait for an in-flight apply and then refuses it", async () => {
    const order: string[] = [];
    const holder = holdingService();

    const applying = holder.service
      .applyEffect(projectId, effectId, writer)
      .then((detail) => {
        order.push("apply committed");
        return detail;
      });

    await holder.reached;

    const deleting = rivalService
      .deleteEffect(projectId, effectId, writer)
      .catch((error: unknown) => {
        order.push("delete resolved");
        throw error;
      });
    const deletion = watch(deleting);

    await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

    try {
      expect(deletion.settled()).toBe(false);
    } finally {
      holder.release();
      await applying;
    }

    await expect(deleting).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });

    expect(order).toEqual(["apply committed", "delete resolved"]);

    const row = await prisma.transitionEffect.findUnique({
      where: { id: effectId },
    });

    expect(row?.appliedAt).not.toBeNull();
  });

  // T2. Invariant 7.7, stated as behaviour: the assertion log must not keep a
  // fact whose effect row is gone. Reads the three surfaces a fact can land on
  // rather than the one the current code happens to use.
  it("writes no fact when the effect was deleted before the apply ran", async () => {
    await rivalService.deleteEffect(projectId, effectId, writer);

    await expect(
      rivalService.applyEffect(projectId, effectId, writer),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const [revisions, relationships, edges, character] = await Promise.all([
      prisma.contentRevision.count({
        where: { projectId, entityId: characterId, revisionNumber: { gt: 0 } },
      }),
      prisma.contentRelationship.count({ where: { projectId } }),
      prisma.evaluationEdge.count({ where: { projectId } }),
      prisma.character.findUnique({ where: { id: characterId } }),
    ]);

    expect(revisions).toBe(0);
    expect(relationships).toBe(0);
    expect(edges).toBe(0);
    // The entity itself never moved either — a revision count of zero alone
    // would still allow a silent write to the column.
    expect(character?.archetype).toBeNull();
  });

  // T3. The loser of an apply race must be told "already applied" (idempotent
  // success), not "the field already holds that value" (409). Both answers keep
  // the data correct; only one of them is the contract, and the difference is
  // exactly what serialisation buys.
  it("applies exactly once when two applies race, and the loser succeeds idempotently", async () => {
    const holder = holdingService();

    const applying = holder.service.applyEffect(projectId, effectId, writer);

    await holder.reached;

    const rivalApplying = rivalService.applyEffect(projectId, effectId, writer);
    const rivalRun = watch(rivalApplying);

    await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

    try {
      expect(rivalRun.settled()).toBe(false);
    } finally {
      holder.release();
      await applying;
    }

    const afterWinner = await prisma.transitionEffect.findUnique({
      where: { id: effectId },
    });

    await expect(rivalApplying).resolves.toMatchObject({ id: effectId });

    const afterLoser = await prisma.transitionEffect.findUnique({
      where: { id: effectId },
    });

    // Same instant and same revision id: the loser wrote nothing. With an
    // advancing clock a second application could not possibly reuse either.
    expect(afterLoser?.appliedAt?.toISOString()).toBe(
      afterWinner?.appliedAt?.toISOString(),
    );
    expect(afterLoser?.contentRevisionId).toBe(afterWinner?.contentRevisionId);

    const revisions = await prisma.contentRevision.count({
      where: { projectId, entityId: characterId, revisionNumber: { gt: 0 } },
    });

    expect(revisions).toBe(1);
  });

  // T4. The parent delete must see the child that was applied inside its guard
  // window. Destroying an applied effect is the 7.7 failure with the pieces
  // swapped: the fact survives in the log, its provenance does not.
  it("makes a transition delete wait for an in-flight apply of its child and then refuses it", async () => {
    const holder = holdingService();

    const applying = holder.service.applyEffect(projectId, effectId, writer);

    await holder.reached;

    const deleting = rivalService.deleteTransition(
      projectId,
      transitionId,
      writer,
    );
    const deletion = watch(deleting);

    await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

    try {
      expect(deletion.settled()).toBe(false);
    } finally {
      holder.release();
      await applying;
    }

    await expect(deleting).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });

    const [transition, effect] = await Promise.all([
      prisma.narrativeTransition.findUnique({ where: { id: transitionId } }),
      prisma.transitionEffect.findUnique({ where: { id: effectId } }),
    ]);

    expect(transition).not.toBeNull();
    expect(effect?.appliedAt).not.toBeNull();
  });

  // T5. A child born inside the delete's window either goes with the parent or
  // stops the delete. What must never happen is the third outcome: the parent
  // gone and a child left pointing at nothing.
  it("never leaves a child effect without its parent transition", async () => {
    const holder = holdingService();

    const adding = holder.service.addEffect(projectId, transitionId, {
      ...writer,
      effectType: "attribute_change",
      targetEntityType: "character",
      targetEntityId: otherCharacterId,
      fieldPath: "archetype",
      newValue: "traitor",
    });

    await holder.reached;

    const deleting = rivalService.deleteTransition(
      projectId,
      transitionId,
      writer,
    );
    const deletion = watch(deleting);

    await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

    try {
      expect(deletion.settled()).toBe(false);
    } finally {
      holder.release();
      await adding;
    }

    const outcome = await deleting.then(
      () => "deleted" as const,
      (error: unknown) => {
        expect(error).toMatchObject({ code: ErrorCode.CONFLICT });
        return "refused" as const;
      },
    );

    const [transition, children] = await Promise.all([
      prisma.narrativeTransition.findUnique({ where: { id: transitionId } }),
      prisma.transitionEffect.findMany({
        where: { narrativeTransitionId: transitionId },
      }),
    ]);

    if (outcome === "deleted") {
      expect(transition).toBeNull();
      expect(children).toHaveLength(0);
    } else {
      expect(transition).not.toBeNull();
      // Refused means the newborn survived with its parent, not that it vanished.
      expect(children.length).toBeGreaterThan(0);
    }
  });

  // T7. The window the aggregate-root lock exists for, and the only test here
  // that can see it (`NarrativeTransitionService.ts:498-503`, found at gate 7.7).
  // Three parties, because two cannot express it: B has already read the child
  // list, A then creates a child, a third call applies it, and only then does B
  // act on the list it read. The child it never saw is applied — and a blanket
  // delete carries no predicate to notice.
  //
  // Stated as behaviour, so it survives the mechanism swap: IF a fact was
  // applied, its provenance row must still exist. A revision numbered above the
  // creation snapshot is that fact's fingerprint, and it outlives the effect row
  // the delete would destroy — which is the only reason the assertion can be
  // made at all.
  it("never destroys a child that was applied while its parent was being deleted", async () => {
    const newbornId = "6b6b6b6b-0000-4000-8000-0000000000ee";
    const readChildren = gate();
    const proceed = gate();

    const deleter = interceptingService(async () => {
      readChildren.open();
      await proceed.opened;
    });

    const deleting = deleter
      .deleteTransition(projectId, transitionId, writer)
      .then(
        () => "deleted" as const,
        () => "refused" as const,
      );

    await readChildren.opened;

    // Born and applied inside B's window — or blocked for the whole of it, which
    // is what the current mechanism does and is equally acceptable behaviour.
    const newborn = mintingService(newbornId)
      .addEffect(projectId, transitionId, {
        ...writer,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: otherCharacterId,
        fieldPath: "archetype",
        newValue: "traitor",
      })
      .then(
        () => plainService.applyEffect(projectId, newbornId, writer),
        () => null,
      )
      .catch(() => null);

    await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

    proceed.open();

    const [outcome] = await Promise.all([deleting, newborn]);

    const appliedFacts = await prisma.contentRevision.count({
      where: {
        projectId,
        entityId: otherCharacterId,
        revisionNumber: { gt: 0 },
      },
    });

    if (appliedFacts > 0) {
      // Something was applied. Then the delete must have refused, and the row
      // that says WHICH transition applied it must still be there.
      expect(outcome).toBe("refused");

      const effect = await prisma.transitionEffect.findUnique({
        where: { id: newbornId },
      });

      expect(effect?.appliedAt).not.toBeNull();
    } else {
      // Nothing was applied, so the delete was free to succeed.
      expect(outcome).toBe("deleted");
    }
  });

  // T8. Closes G2-4 (`quality-gate/gerbang-mutu-g2-2026-08-20.md`). The comment at
  // `NarrativeTransitionService.ts:399-404` claims bulk apply and transition delete
  // "take row locks in the same sequence and cannot deadlock against each other".
  // Until now that was pinned only by an assertion over Prisma's ARGUMENTS
  // (`orderBy` in the adapter unit test) — statement shape, not behaviour, which is
  // the exact complaint the deleted `for-update-lock` file wrote about itself.
  //
  // Two rows are the minimum that can express an order, so this needs its own
  // transition with two pending effects, and they target DIFFERENT characters: two
  // attribute changes on one entity would make the second apply fail on "already
  // holds the intended value" and the test would be measuring D5 instead of lock
  // order.
  //
  // Choreography that works under BOTH orderings, which is why the gate on B is
  // raced rather than awaited: with the orders aligned, B blocks on its very first
  // delete and never reaches its gate; with them reversed, B sails past the first
  // row and parks — and only then can the cycle form.
  it("does not deadlock when a bulk apply and a transition delete run head-on", async () => {
    const orderedTransitionId = "6b6b6b6b-0000-4000-8000-000000000003";
    const firstEffectId = "6b6b6b6b-0000-4000-8000-000000000021";
    const secondEffectId = "6b6b6b6b-0000-4000-8000-000000000022";

    await transitions.insert(
      NarrativeTransition.create({
        id: orderedTransitionId,
        projectId,
        sourceEntityType: "chapter",
        sourceEntityId: chapterId,
        title: "Dua efek, satu urutan",
        description: null,
        declaredByUserId: ownerUserId,
        reversesTransitionId: null,
        now: BASE,
      }),
    );

    await prisma.transitionEffect.createMany({
      data: [
        {
          id: firstEffectId,
          narrativeTransitionId: orderedTransitionId,
          projectId,
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: characterId,
          fieldPath: "archetype",
          newValue: "mentor",
          // Explicit and distinct: `createdAt asc, id asc` IS the order under test,
          // so two rows sharing a timestamp would leave it decided by the id
          // tie-break and hide what this test is about.
          createdAt: BASE,
        },
        {
          id: secondEffectId,
          narrativeTransitionId: orderedTransitionId,
          projectId,
          effectType: "attribute_change",
          targetEntityType: "character",
          targetEntityId: otherCharacterId,
          fieldPath: "archetype",
          newValue: "rival",
          createdAt: new Date(BASE.getTime() + 1000),
        },
      ],
    });

    // A claims the FIRST row and holds it, mid-loop.
    const applier = interceptingAfterFirst(prisma, containerA, "claimForApply");
    const applying = applier.service.applyTransition(
      projectId,
      orderedTransitionId,
      writer,
    );

    await applier.reachedFirst;

    // B walks the same list. Aligned orders → it blocks here, on the row A holds.
    // Reversed → it deletes the OTHER row and parks, which is what would let the
    // cycle close.
    const deleter = interceptingAfterFirst(
      rival,
      containerB,
      "deleteIfPending",
    );
    const deleting = deleter.service.deleteTransition(
      projectId,
      orderedTransitionId,
      writer,
    );

    await Promise.race([
      deleter.reachedFirst,
      new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS)),
    ]);

    applier.release();
    deleter.release();

    const [appliedOutcome, deletedOutcome] = await Promise.allSettled([
      applying,
      deleting,
    ]);

    // THE discriminating assertion. A deadlock is not a slow test or a lost race:
    // Postgres kills one side outright, and the classifier says so by SQLSTATE
    // (`deadlock-classification.integration.test.ts` proves that shape is real).
    // Reverse either loop and one of these two becomes a killed victim.
    for (const outcome of [appliedOutcome, deletedOutcome]) {
      if (outcome.status === "rejected") {
        expect(isTransientDatabaseError(outcome.reason)).toBe(false);
        expect(String(outcome.reason)).not.toMatch(/deadlock/i);
      }
    }

    // And the outcome is the ordinary serialised one: the writer that got there
    // first finishes, the structural caller is refused with the sentence it would
    // have given anyway.
    expect(appliedOutcome.status).toBe("fulfilled");
    expect(deletedOutcome.status).toBe("rejected");

    if (deletedOutcome.status === "rejected") {
      expect(deletedOutcome.reason).toMatchObject({
        code: ErrorCode.CONFLICT,
      });
    }

    const survivors = await prisma.transitionEffect.findMany({
      where: { narrativeTransitionId: orderedTransitionId },
      select: { id: true, appliedAt: true },
      orderBy: { createdAt: "asc" },
    });

    // All-or-nothing (decision D9): a bulk apply that half-committed would show up
    // here as one applied row and one pending.
    expect(survivors).toHaveLength(2);
    expect(survivors.every((row) => row.appliedAt !== null)).toBe(true);
  });

  // T6. The control for the controls. If unrelated work also blocked, T1/T3/T4/T5
  // could be measuring connection saturation or a lock left by the fixture
  // rather than the rows they name.
  it("does not block work on a different transition while an apply is in flight", async () => {
    const holder = holdingService();

    const applying = holder.service.applyEffect(projectId, effectId, writer);

    await holder.reached;

    try {
      await expect(
        rivalService.deleteEffect(projectId, otherEffectId, writer),
      ).resolves.toBeUndefined();
    } finally {
      holder.release();
      await applying;
    }

    const other = await prisma.transitionEffect.findUnique({
      where: { id: otherEffectId },
    });

    expect(other).toBeNull();
  });
});
