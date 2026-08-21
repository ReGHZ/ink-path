import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaAssertionRepository } from "../../src/domains/content/internal/infrastructure/transition/PrismaAssertionRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Closes G2-3 (`quality-gate/gerbang-mutu-g2-2026-08-20.md`).
//
// The gate mutated `projectId` out of the `where` in `claimForApply` and the FULL
// suite — 1990 tests — stayed green. Its twin `deleteIfPending` died immediately,
// and the asymmetry has a cause worth writing down rather than patching blind:
//
//   `deleteAssertion` has no tenancy pre-check at all, so the predicate inside
//   `deleteIfPending` is the only guard on that path and an e2e reaches it.
//
//   `applyAssertion` DOES pre-check in the service (`loadPendingEffectForApply` →
//   `loadExistingAssertion(projectId, …)` → 404), so the adapter's predicate is pure
//   defense-in-depth and nothing observable from outside depends on it.
//
//   The unit fake is faithful (it enforces tenancy itself), so the unit suite
//   passes whether or not the ADAPTER does — two implementations of one port, and
//   only the fake's behaviour is asserted.
//
// Option (b) on the table was to document the predicate as defense-in-depth and
// leave it untested. Rejected: a guard with no test is a guard the next refactor
// deletes silently, and "the service checks first" is exactly the sentence that
// would be used to justify deleting it. So the adapter is tested AS AN ADAPTER,
// below the service that currently hides it.
//
// Each case is paired with a POSITIVE CONTROL on the owning project. Without it a
// green "foreign project cannot touch this row" proves nothing — the row might not
// be reachable at all, and the test would pass against a repository that refuses
// everything (the false-control shape T-5 was raised about).
//
// FIXTURE ID BLOCK 024 — owner/project ids end in `...0000000024NN`, transition and
// assertion ids use the `6d6d6d6d` prefix. Both unused when this file was written
// (blocks 000-023 taken; prefixes 00000000/1x/2x/3x-9x/616263/64-6c/70 claimed
// elsewhere). Grep the block AND the prefix before adding fixtures.
const BASE = new Date("2026-08-20T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000002401";
const projectId = "00000000-0000-4000-8000-000000002402";
// The neighbour. Same owner, different project — the shape a real tenancy slip
// takes here, since one writer legitimately holds several projects.
const otherProjectId = "00000000-0000-4000-8000-000000002403";

const transitionId = "6d6d6d6d-0000-4000-8000-000000000001";
const claimEffectId = "6d6d6d6d-0000-4000-8000-000000000011";
const deleteEffectId = "6d6d6d6d-0000-4000-8000-000000000012";
const chapterId = "6d6d6d6d-0000-4000-8000-0000000000cb";
const characterId = "6d6d6d6d-0000-4000-8000-0000000000ca";

const prisma: PrismaClient = createPrismaClient();

// Built over the pooled client on purpose. The port requires a transaction for the
// LOCK these statements take to be worth anything, and that property is proved
// elsewhere (`apply-delete-serialization.integration.test.ts`). What is under test
// here is the WHERE clause, which is the same statement in or out of a transaction.
const assertions = new PrismaAssertionRepository(prisma);

async function cleanDatabase(): Promise<void> {
  await prisma.assertion.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await prisma.narrativeTransition.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: [projectId, otherProjectId] } },
  });
  await prisma.user.deleteMany({ where: { id: ownerUserId } });
}

beforeEach(async () => {
  await cleanDatabase();

  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: "assertion-tenancy-owner@example.com",
      passwordHash: "hashed-password",
      createdAt: BASE,
      updatedAt: BASE,
    },
  });

  await prisma.project.createMany({
    data: [
      {
        id: projectId,
        ownerUserId,
        createdByUserId: ownerUserId,
        name: "Owning project",
        createdAt: BASE,
        updatedAt: BASE,
      },
      {
        id: otherProjectId,
        ownerUserId,
        createdByUserId: ownerUserId,
        name: "Neighbouring project",
        createdAt: BASE,
        updatedAt: BASE,
      },
    ],
  });

  await prisma.narrativeTransition.create({
    data: {
      id: transitionId,
      projectId,
      sourceEntityType: "chapter",
      sourceEntityId: chapterId,
      title: "Kematian di bab 12",
      declaredByUserId: ownerUserId,
      createdAt: BASE,
      updatedAt: BASE,
    },
  });

  // Two rows so a claim and a delete never contend for the same one: each case
  // needs its target still pending when it runs.
  await prisma.assertion.createMany({
    data: [claimEffectId, deleteEffectId].map((id) => ({
      id,
      narrativeTransitionId: transitionId,
      projectId,
      operation: "attribute_change" as const,
      targetEntityType: "character" as const,
      targetEntityId: characterId,
      fieldPath: "archetype",
      newValue: "mentor",
      createdAt: BASE,
    })),
  });
});

afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
});

describe("transition assertion adapter, project scope", () => {
  it("refuses to claim an assertion for a project that does not own it", async () => {
    const claim = await assertions.claimForApply(
      otherProjectId,
      claimEffectId,
      new Date(BASE.getTime() + 1000),
    );

    expect(claim.status).toBe("missing");

    // The row is the assertion that matters: "missing" with `applied_at` written
    // anyway would be a leak reported as a refusal.
    const row = await prisma.assertion.findUnique({
      where: { id: claimEffectId },
      select: { appliedAt: true },
    });

    expect(row?.appliedAt).toBeNull();
  });

  it("claims the same assertion for the project that does own it", async () => {
    const claimedAt = new Date(BASE.getTime() + 2000);

    const claim = await assertions.claimForApply(
      projectId,
      claimEffectId,
      claimedAt,
    );

    expect(claim.status).toBe("claimed");
    // The port promises the PRE-CLAIM aggregate, so `markApplied()` stays the only
    // thing that decides an assertion is applied. Asserted here because the tenancy
    // test would otherwise be the only caller in the suite that could notice.
    expect(claim.status === "claimed" ? claim.assertion.isApplied : true).toBe(
      false,
    );

    const row = await prisma.assertion.findUnique({
      where: { id: claimEffectId },
      select: { appliedAt: true },
    });

    expect(row?.appliedAt).toEqual(claimedAt);
  });

  it("refuses to delete an assertion for a project that does not own it", async () => {
    const outcome = await assertions.deleteIfPending(
      otherProjectId,
      deleteEffectId,
    );

    expect(outcome).toBe("missing");

    const row = await prisma.assertion.findUnique({
      where: { id: deleteEffectId },
    });

    expect(row).not.toBeNull();
  });

  it("deletes the same assertion for the project that does own it", async () => {
    const outcome = await assertions.deleteIfPending(projectId, deleteEffectId);

    expect(outcome).toBe("deleted");

    const row = await prisma.assertion.findUnique({
      where: { id: deleteEffectId },
    });

    expect(row).toBeNull();
  });
});
