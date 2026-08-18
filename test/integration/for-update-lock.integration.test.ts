import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { NarrativeTransition } from "../../src/domains/content/internal/domain/transition/NarrativeTransition.js";
import {
  PrismaNarrativeTransitionRepository,
  type NarrativeTransitionDatabase,
} from "../../src/domains/content/internal/infrastructure/transition/PrismaNarrativeTransitionRepository.js";
import {
  PrismaTransitionEffectRepository,
  type TransitionEffectDatabase,
} from "../../src/domains/content/internal/infrastructure/transition/PrismaTransitionEffectRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// What both repositories accept. Narrow enough that a transaction client
// satisfies it, which is the only reason these calls can be made from inside
// `$transaction` without a cast.
type LockingDatabase = NarrativeTransitionDatabase & TransitionEffectDatabase;

// Closes the `FOR UPDATE` debt recorded at gerbang 7.9 (`notes/tech-debt.md`).
//
// What already existed proved two things and not the third: a unit test asserts
// the STATEMENT TEXT contains `FOR UPDATE`, and the end-to-end tests assert the
// OUTCOME is idempotent. Neither shows the read lock is what produces the
// outcome — and that was demonstrated, not suspected: with the clause deleted,
// 24 end-to-end tests stayed green. Over HTTP the second request almost always
// lands after the first commits, so the interleaving that needs a read lock
// never happens.
//
// Only two connections can tell the difference, and only against the adapter
// directly. Connection A takes the lock inside a transaction and holds it;
// connection B asks for the same row and must WAIT. Without `FOR UPDATE` B
// returns immediately, which is exactly the mutation this file has to kill.
//
// Both repositories are covered because both carry the clause for different
// reasons: the effect lock guards apply-vs-apply (the idempotency re-check on
// `applied_at`), the transition lock guards apply-vs-delete (a structural
// caller must see the world the first one left).
//
// FIXTURE ID BLOCK 019 — owner/project ids end in `...0000000019NN`, transition
// and entity ids use the `70707070` prefix. Both unused when this file was
// written (blocks 000-018 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-69
// claimed elsewhere). Vitest runs test FILES in parallel and each cleans up its
// own project, so a shared block makes two files delete each other's fixtures
// intermittently. Grep the block AND the prefix before adding fixtures.
const now = new Date("2026-08-18T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001901";
const projectId = "00000000-0000-4000-8000-000000001902";

const transitionId = "70707070-0000-4000-8000-000000000001";
const effectId = "70707070-0000-4000-8000-000000000002";
const characterId = "70707070-0000-4000-8000-0000000000ca";
const chapterId = "70707070-0000-4000-8000-0000000000cb";

// Two clients, two pools, two backends — the whole point. Reusing one client
// would put both transactions on the same connection, where the second simply
// queues behind the first and would "block" no matter what the SQL said.
const prisma = createPrismaClient();
const rival = createPrismaClient();

const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const transitions = new PrismaNarrativeTransitionRepository(prisma);

// Long enough that a local query that is NOT blocked has finished many times
// over, short enough to stay well inside Prisma's 5s interactive-transaction
// timeout. It is a lower bound on "B had its chance", never an upper bound on
// how long a legitimate query may take, so a slow machine cannot make the
// honest case fail — it can only make a mutant survive, and the ordering
// assertion below is what closes that.
const CHANCE_TO_RUN_MS = 400;

// A promise plus the handle that settles it. Written out because the test needs
// to hold a database transaction open across an assertion, which no
// await-shaped construct expresses.
type Gate = { readonly opened: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { opened, open };
}

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.transitionEffect.deleteMany({ where: { projectId } });
  await client.narrativeTransition.deleteMany({ where: { projectId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

beforeEach(async () => {
  await cleanDatabase(prisma);

  await users.insert(
    User.create({
      id: ownerUserId,
      email: "for-update-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  await projects.insert(
    Project.create({
      id: projectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "For update project",
      now,
    }),
  );

  await transitions.insert(
    NarrativeTransition.create({
      id: transitionId,
      projectId,
      sourceEntityType: "chapter",
      sourceEntityId: chapterId,
      title: "Kematian di bab 12",
      description: null,
      declaredByUserId: ownerUserId,
      reversesTransitionId: null,
      now,
    }),
  );

  await prisma.transitionEffect.create({
    data: {
      id: effectId,
      narrativeTransitionId: transitionId,
      projectId,
      effectType: "attribute_change",
      targetEntityType: "character",
      targetEntityId: characterId,
      fieldPath: "archetype",
      newValue: "mentor",
      createdAt: now,
    },
  });
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
  await rival.$disconnect();
});

// One scenario, run against both repositories. `read` is the locking call under
// test; everything else is identical, so a divergence between the two rows is a
// difference in the SQL and nothing else.
async function expectSecondReaderToWait(
  read: (client: LockingDatabase) => Promise<unknown>,
): Promise<void> {
  const order: string[] = [];
  const release = gate();
  const locked = gate();

  const holder = prisma.$transaction(async (tx) => {
    await read(tx);
    // The lock is held from here until this callback returns and the
    // transaction commits.
    locked.open();
    await release.opened;
    order.push("holder committed");
  });

  await locked.opened;

  let rivalResolved = false;
  const waiter = rival
    .$transaction(async (tx) => read(tx))
    .then((row) => {
      rivalResolved = true;
      order.push("rival read");
      return row;
    });

  await new Promise((resolve) => setTimeout(resolve, CHANCE_TO_RUN_MS));

  try {
    // The discriminating assertion. Delete `FOR UPDATE` from the adapter and
    // the rival's read is already done by now.
    expect(rivalResolved).toBe(false);
  } finally {
    // Released even when the assertion above fails. Without this the holder's
    // transaction stays open until Prisma's 5s timeout while still holding the
    // row lock, so ONE broken expectation turns into every later test in this
    // file waiting on it — and a mutant would look like it killed three tests
    // when it killed one. Observed while running the SKIP LOCKED mutant.
    release.open();
    await holder;
  }

  await expect(waiter).resolves.not.toBeNull();
  // Order, not just timing: the rival's read has to land AFTER the holder's
  // commit, which is the property the idempotency re-check depends on.
  expect(order).toEqual(["holder committed", "rival read"]);
}

describe("FOR UPDATE row locks, proved with two connections", () => {
  it("makes a second reader of the same transition effect wait for the holder", async () => {
    await expectSecondReaderToWait((client) =>
      new PrismaTransitionEffectRepository(client).findByIdForUpdate(effectId),
    );
  });

  it("makes a second reader of the same narrative transition wait for the holder", async () => {
    await expectSecondReaderToWait((client) =>
      new PrismaNarrativeTransitionRepository(client).findByIdForUpdate(
        transitionId,
      ),
    );
  });

  // The control for the control. If `findById` also blocked, the assertions
  // above would be measuring something other than the clause under test —
  // connection saturation, say, or a table-level lock left by the fixture.
  it("does not make a plain read wait, so the wait above is the clause and not the setup", async () => {
    const release = gate();
    const locked = gate();

    const holder = prisma.$transaction(async (tx) => {
      await new PrismaTransitionEffectRepository(tx).findByIdForUpdate(effectId);
      locked.open();
      await release.opened;
    });

    await locked.opened;

    try {
      const unlockedRead = await new PrismaTransitionEffectRepository(
        rival,
      ).findById(effectId);

      expect(unlockedRead?.id).toBe(effectId);
    } finally {
      release.open();
      await holder;
    }
  });
});
