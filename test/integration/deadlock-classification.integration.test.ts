import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { isTransientDatabaseError } from "../../src/shared/infrastructure/prismaErrors.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Langkah 4b-5 langkah 7, dan the test that has to come FIRST — before any
// mapping is written, because it is the one that can invalidate the design.
//
// The debt says a Postgres deadlock (`40P01`) surfaces as 500 because nothing at
// the HTTP boundary recognises it (`notes/tech-debt.md` §Deadlock Postgres). The
// fix everyone reaches for is "map the code" — and it rests on an assumption
// nobody has measured: that a deadlock reaches this codebase as a Prisma error
// carrying `code: "P2034"`, which is what `isTransientDatabaseError` matches on.
//
// There is direct evidence that assumption is risky. In this same slice a CHECK
// constraint violation arrived as `DriverAdapterError` with no Prisma code at
// all — a class that classifier answers `false` for. If a deadlock arrives the
// same way, the mapping would be written, its unit test would pass against a
// hand-built error object, and production would keep answering 500.
//
// So this file does not test our code first. It makes Postgres produce a REAL
// deadlock and looks at what actually arrives.
//
// FIXTURE ID BLOCK 023 — owner/project ids end in `...0000000023NN`, entity ids
// use the `6c6c6c6c` prefix. Both unused when this file was written (blocks
// 000-022 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-6b/70 claimed
// elsewhere). Grep the block AND the prefix before adding fixtures.
const BASE = new Date("2026-08-20T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000002301";
const projectId = "00000000-0000-4000-8000-000000002302";

const firstCharacterId = "6c6c6c6c-0000-4000-8000-0000000000c1";
const secondCharacterId = "6c6c6c6c-0000-4000-8000-0000000000c2";

// Two clients, two backends: a deadlock needs two sessions that can each hold a
// lock the other wants. On one client the second transaction would simply queue.
const prisma = createPrismaClient();
const rival = createPrismaClient();

type Gate = { readonly opened: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { opened, open };
}

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.character.deleteMany({ where: { projectId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

beforeEach(async () => {
  await cleanDatabase(prisma);

  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: "deadlock-owner@example.com",
      passwordHash: "hashed-password",
      createdAt: BASE,
      updatedAt: BASE,
    },
  });

  await prisma.project.create({
    data: {
      id: projectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Deadlock classification project",
      createdAt: BASE,
      updatedAt: BASE,
    },
  });

  // Written with the client rather than through the aggregate: this file locks
  // ROWS and never reads one back through a mapper, so the creation revision the
  // domain would demand is fixture weight with no assertion behind it.
  await prisma.character.createMany({
    data: [
      {
        id: firstCharacterId,
        projectId,
        createdByUserId: ownerUserId,
        name: "Li Wei",
      },
      {
        id: secondCharacterId,
        projectId,
        createdByUserId: ownerUserId,
        name: "Chen",
      },
    ],
  });
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
  await rival.$disconnect();
});

// Two writers taking the same two row locks in OPPOSITE order — the textbook
// deadlock, and the exact shape the debt names: bulk apply locks every effect row
// plus every target entity in one transaction, and two bulk applies of different
// transitions touching the same entities have no global order between them.
async function forceDeadlock(): Promise<unknown> {
  const firstLocked = gate();
  const secondLocked = gate();

  const holder = prisma.$transaction(async (tx) => {
    await tx.character.updateMany({
      where: { id: firstCharacterId },
      data: { archetype: "holder-first" },
    });

    firstLocked.open();
    await secondLocked.opened;

    await tx.character.updateMany({
      where: { id: secondCharacterId },
      data: { archetype: "holder-second" },
    });
  });

  const rivalWriter = rival.$transaction(async (tx) => {
    await tx.character.updateMany({
      where: { id: secondCharacterId },
      data: { archetype: "rival-second" },
    });

    secondLocked.open();
    await firstLocked.opened;

    await tx.character.updateMany({
      where: { id: firstCharacterId },
      data: { archetype: "rival-first" },
    });
  });

  const outcomes = await Promise.allSettled([holder, rivalWriter]);
  const rejected = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );

  // Postgres kills exactly one victim. Zero means no deadlock happened and this
  // test is measuring nothing at all; two would mean something else went wrong,
  // and either way the assertions below would be reading a shape they were not
  // handed by the failure they claim to describe.
  expect(rejected).toHaveLength(1);

  return rejected[0].reason;
}

describe("a real Postgres deadlock, as this codebase actually receives it", () => {
  // The SHAPE, asserted rather than printed. It is documentation and canary at
  // once: a Prisma or driver upgrade that moves the SQLSTATE somewhere else makes
  // this test fail loudly, instead of quietly returning the classifier to the
  // state this file was written to expose — answering `false` for every deadlock
  // while its own unit tests, built on hand-made error objects, stayed green.
  it("arrives as a DriverAdapterError carrying SQLSTATE 40P01 in its cause", async () => {
    const error = await forceDeadlock();

    expect((error as { name?: unknown }).name).toBe("DriverAdapterError");
    // No `code` of its own — this absence is the trap.
    expect((error as { code?: unknown }).code).toBeUndefined();
    expect((error as { cause?: unknown }).cause).toMatchObject({
      kind: "postgres",
      code: "40P01",
      message: "deadlock detected",
    });
  });

  it("is classified as transient by the shared classifier", async () => {
    const error = await forceDeadlock();

    expect(isTransientDatabaseError(error)).toBe(true);
  });

  // The control for the control: a permanent failure arrives in the SAME wrapper,
  // so "DriverAdapterError" cannot be the thing being matched. Without this test,
  // widening the classifier to the whole wrapper class would pass everything above
  // and turn a CHECK violation into an infinite retry.
  it("does not classify a constraint violation in the same wrapper as transient", async () => {
    const error = await prisma.contentRevision
      .create({
        data: {
          id: "6c6c6c6c-0000-4000-8000-0000000000e1",
          projectId,
          entityType: "character",
          entityId: firstCharacterId,
          revisionNumber: 1,
          changedByUserId: ownerUserId,
          // `create` with no after-snapshot violates
          // `content_revisions_snapshot_presence`, which is permanent by nature:
          // the same row will fail the same way forever.
          changeType: "create",
          createdAt: BASE,
        },
      })
      .then(
        () => null,
        (error_: unknown) => error_,
      );

    expect((error as { name?: unknown }).name).toBe("DriverAdapterError");
    expect(isTransientDatabaseError(error)).toBe(false);
  });
});
