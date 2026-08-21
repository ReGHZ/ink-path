import { describe, expect, it } from "vitest";

import {
  PrismaAssertionRepository,
  type AssertionDatabase,
} from "./PrismaAssertionRepository.js";
import { Assertion } from "../../domain/transition/Assertion.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { Assertion as PrismaAssertion } from "../../../../../generated/prisma/client.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const row: PrismaAssertion = {
  id: "assertion-1",
  narrativeTransitionId: "transition-1",
  projectId: "project-1",
  operation: "attribute_change",
  targetEntityType: "character",
  targetEntityId: "character-1",
  fieldPath: "archetype",
  newValue: "mentor",
  relationshipType: null,
  relatedEntityType: null,
  relatedEntityId: null,
  // Assertion-log columns (2026-08-18). All null here on purpose: this fixture
  // is a Phase 7 transition assertion, which is exactly the row shape that carries
  // none of them.
  relationshipDefinitionId: null,
  anchorEntityType: null,
  anchorEntityId: null,
  targetAssertionId: null,
  targetOperation: null,
  appliedAt: null,
  contentRevisionId: null,
  createdAt: now,
};

type Calls = {
  findUnique: number;
  findFirst: unknown[];
  findMany: unknown[];
  create: unknown[];
  updateMany: unknown[];
  deleteMany: unknown[];
};

function buildRepository(options: { count?: number } = {}) {
  const calls: Calls = {
    findUnique: 0,
    findFirst: [],
    findMany: [],
    create: [],
    updateMany: [],
    deleteMany: [],
  };

  // No `$queryRaw` fake since gerbang G2 (G2-2). It existed to let a test assert
  // the statement really said `FOR UPDATE`; that assertion died with the mechanism
  // at step 4b-5, and the predicate that replaced it is pinned behaviourally
  // instead (`test/integration/assertion-tenancy.integration.test.ts` and
  // `apply-delete-serialization.integration.test.ts`).
  const client = {
    assertion: {
      findUnique: () => {
        calls.findUnique += 1;

        return Promise.resolve(row);
      },
      // `findById` moved off findUnique when `assertions` became the
      // assertion log too: it now has to carry `narrativeTransitionId: { not:
      // null }` so an assertion id answers 404 rather than reaching a mapper
      // that would reject it with the wrong reason. The `where` is recorded
      // because that predicate IS the aggregate boundary.
      findFirst: (args: unknown) => {
        calls.findFirst.push(args);

        return Promise.resolve(row);
      },
      findMany: (args: unknown) => {
        calls.findMany.push(args);

        return Promise.resolve([row]);
      },
      create: (args: unknown) => {
        calls.create.push(args);

        return Promise.resolve(row);
      },
      updateMany: (args: unknown) => {
        calls.updateMany.push(args);

        return Promise.resolve({ count: options.count ?? 1 });
      },
      deleteMany: (args: unknown) => {
        calls.deleteMany.push(args);

        return Promise.resolve({ count: options.count ?? 1 });
      },
    },
  } as unknown as AssertionDatabase;

  return { repository: new PrismaAssertionRepository(client), calls };
}

function buildAppliedAssertion(): Assertion {
  const assertion = Assertion.reconstitute({
    id: "assertion-1",
    narrativeTransitionId: "transition-1",
    projectId: "project-1",
    operation: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "archetype",
    newValue: "mentor",
    relationshipType: null,
    relationshipDefinitionId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    anchorEntityType: null,
    anchorEntityId: null,
    targetAssertionId: null,
    targetOperation: null,
    appliedAt: null,
    contentRevisionId: null,
    createdAt: now,
  });

  assertion.markApplied({ contentRevisionId: "revision-1", now: later });

  return assertion;
}

describe("PrismaAssertionRepository", () => {
  // Since `assertions` became the assertion log as well, the TABLE is
  // wider than this AGGREGATE: it holds rows with no parent transition at all.
  // Without this predicate an assertion id reached the mapper and came back as
  // "Narrative transition id is required" — the wrong reason for a row designed
  // not to have one, where the right answer is simply 404.
  it("reads only rows that belong to a transition", async () => {
    const { repository, calls } = buildRepository();

    await repository.findById("assertion-1");

    expect(calls.findFirst).toEqual([
      { where: { id: "assertion-1", narrativeTransitionId: { not: null } } },
    ]);
  });

  // Both bulk apply and the delete guard walk this list to take their locks.
  // A non-total order would let the two acquire the same two rows in opposite
  // sequences — the textbook deadlock.
  it("returns a transition's assertions in a stable, total order", async () => {
    const { repository, calls } = buildRepository();

    await repository.findByTransitionId("transition-1");

    expect(calls.findMany[0]).toMatchObject({
      where: { narrativeTransitionId: "transition-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  // The invariant this once guarded MOVED in step 4b; it was not dropped.
  //
  // Before: `insert` discarded `applied_at`, so "an assertion cannot be declared as
  // already applied" was enforced here, by the column default. That worked while
  // a transition was the only writer. Relationship CRUD asserts facts that hold
  // the moment they are written and have no apply step that could set the column
  // later, so discarding it would store every asserted fact as permanently
  // pending.
  //
  // After: `insert` writes what the aggregate carries, and the DOMAIN is what
  // refuses the abuse — `Assertion.create()` hardcodes `appliedAt: null`,
  // and only `assertFact()` (parentless, relationship shapes only) can produce a
  // snapshot with a value. That domain half is asserted in
  // `../../domain/transition/Assertion.test.ts` ("is born pending…",
  // `:111`) — passing the column through here is only safe because that holds.
  it("passes applied state through on insert, but only the domain can produce it", async () => {
    const { repository, calls } = buildRepository();

    await repository.insert(buildAppliedAssertion());

    const data = (calls.create[0] as { data: Record<string, unknown> }).data;

    // `later`, not `now`: the fixture applies the assertion after creating it, so
    // this also shows the column is carried from the AGGREGATE rather than
    // stamped by the mapper.
    expect(data.appliedAt).toBe(later);
    // Still never written: `content_revision_id` points at a revision that apply
    // produces, and an asserted fact produces none.
    expect(data.contentRevisionId).toBeUndefined();
    expect(data.createdAt).toBe(now);
  });

  it("writes only the two mutable columns on update", async () => {
    const { repository, calls } = buildRepository();

    await repository.update(buildAppliedAssertion());

    const data = (calls.updateMany[0] as { data: Record<string, unknown> }).data;

    expect(Object.keys(data).sort()).toEqual([
      "appliedAt",
      "contentRevisionId",
    ]);
    expect(data.appliedAt).toBe(later);
  });

  it("reports a vanished row on update", async () => {
    const { repository } = buildRepository({ count: 0 });

    await expect(
      repository.update(buildAppliedAssertion()),
    ).rejects.toBeInstanceOf(NarrativeTransitionRepositoryNotFoundError);
  });

});
