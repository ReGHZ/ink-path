import { describe, expect, it } from "vitest";

import {
  PrismaTransitionEffectRepository,
  type TransitionEffectDatabase,
} from "./PrismaTransitionEffectRepository.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";
import { TransitionEffect } from "../../domain/transition/TransitionEffect.js";

import type { TransitionEffect as PrismaTransitionEffect } from "../../../../../generated/prisma/client.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const row: PrismaTransitionEffect = {
  id: "effect-1",
  narrativeTransitionId: "transition-1",
  projectId: "project-1",
  effectType: "attribute_change",
  targetEntityType: "character",
  targetEntityId: "character-1",
  fieldPath: "archetype",
  newValue: "mentor",
  relationshipType: null,
  relatedEntityType: null,
  relatedEntityId: null,
  // Assertion-log columns (2026-08-18). All null here on purpose: this fixture
  // is a Phase 7 transition effect, which is exactly the row shape that carries
  // none of them.
  relationshipDefinitionId: null,
  anchorEntityType: null,
  anchorEntityId: null,
  targetAssertionId: null,
  targetEffectType: null,
  appliedAt: null,
  contentRevisionId: null,
  createdAt: now,
};

type Calls = {
  raw: string[];
  findUnique: number;
  findFirst: unknown[];
  findMany: unknown[];
  create: unknown[];
  updateMany: unknown[];
  deleteMany: unknown[];
};

function buildRepository(
  options: { count?: number; lockedRows?: Array<{ id: string }> } = {},
) {
  const calls: Calls = {
    raw: [],
    findUnique: 0,
    findFirst: [],
    findMany: [],
    create: [],
    updateMany: [],
    deleteMany: [],
  };

  const client = {
    // Template-tag call: the fake receives the string fragments, which is
    // exactly what the assertion below needs — that the statement really does
    // say FOR UPDATE.
    $queryRaw: (fragments: TemplateStringsArray) => {
      calls.raw.push(fragments.join("?"));

      return Promise.resolve(options.lockedRows ?? [{ id: "effect-1" }]);
    },
    transitionEffect: {
      findUnique: () => {
        calls.findUnique += 1;

        return Promise.resolve(row);
      },
      // `findById` moved off findUnique when `transition_effects` became the
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
  } as unknown as TransitionEffectDatabase;

  return { repository: new PrismaTransitionEffectRepository(client), calls };
}

function buildAppliedEffect(): TransitionEffect {
  const effect = TransitionEffect.reconstitute({
    id: "effect-1",
    narrativeTransitionId: "transition-1",
    projectId: "project-1",
    effectType: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "archetype",
    newValue: "mentor",
    relationshipType: null,
    relatedEntityType: null,
    relatedEntityId: null,
    appliedAt: null,
    contentRevisionId: null,
    createdAt: now,
  });

  effect.markApplied({ contentRevisionId: "revision-1", now: later });

  return effect;
}

describe("PrismaTransitionEffectRepository", () => {
  // Since `transition_effects` became the assertion log as well, the TABLE is
  // wider than this AGGREGATE: it holds rows with no parent transition at all.
  // Without this predicate an assertion id reached the mapper and came back as
  // "Narrative transition id is required" — the wrong reason for a row designed
  // not to have one, where the right answer is simply 404.
  it("reads only rows that belong to a transition", async () => {
    const { repository, calls } = buildRepository();

    await repository.findById("effect-1");

    expect(calls.findFirst).toEqual([
      { where: { id: "effect-1", narrativeTransitionId: { not: null } } },
    ]);
  });

  // The lock IS the apply path's correctness. A version of this method that
  // read the row without `FOR UPDATE` would behave identically in every test
  // that is not concurrent — which is every test we can write — so the
  // statement itself is what has to be asserted.
  it("takes a row lock before reading the effect", async () => {
    const { repository, calls } = buildRepository();

    const effect = await repository.findByIdForUpdate("effect-1");

    expect(calls.raw).toHaveLength(1);
    expect(calls.raw[0]).toContain("FOR UPDATE");
    expect(calls.raw[0]).toContain("FROM transition_effects");
    expect(calls.raw[0]).not.toContain("SKIP LOCKED");
    expect(effect?.id).toBe("effect-1");
  });

  // SKIP LOCKED is what the outbox dispatcher wants and the exact opposite of
  // what apply wants: the second caller must WAIT and then discover
  // `applied_at` is set. Skipping would let it conclude the row does not exist
  // and answer 404 for an effect that is merely busy.
  it("answers null without a second read when the row does not exist", async () => {
    const { repository, calls } = buildRepository({ lockedRows: [] });

    expect(await repository.findByIdForUpdate("effect-1")).toBeNull();
    expect(calls.findUnique).toBe(0);
  });

  // Both bulk apply and the delete guard walk this list to take their locks.
  // A non-total order would let the two acquire the same two rows in opposite
  // sequences — the textbook deadlock.
  it("returns a transition's effects in a stable, total order", async () => {
    const { repository, calls } = buildRepository();

    await repository.findByTransitionId("transition-1");

    expect(calls.findMany[0]).toMatchObject({
      where: { narrativeTransitionId: "transition-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("never writes applied state on insert", async () => {
    const { repository, calls } = buildRepository();

    await repository.insert(buildAppliedEffect());

    const data = (calls.create[0] as { data: Record<string, unknown> }).data;

    // Even handed an applied aggregate, the create path must not carry
    // `applied_at`: declaring an effect as already applied is a state the domain
    // forbids on construction, and the column default is what enforces it here.
    expect(data.appliedAt).toBeUndefined();
    expect(data.contentRevisionId).toBeUndefined();
    expect(data.createdAt).toBe(now);
  });

  it("writes only the two mutable columns on update", async () => {
    const { repository, calls } = buildRepository();

    await repository.update(buildAppliedEffect());

    const data = (calls.updateMany[0] as { data: Record<string, unknown> }).data;

    expect(Object.keys(data).sort()).toEqual([
      "appliedAt",
      "contentRevisionId",
    ]);
    expect(data.appliedAt).toBe(later);
  });

  it("reports a vanished row on update and on delete", async () => {
    const { repository } = buildRepository({ count: 0 });

    await expect(
      repository.update(buildAppliedEffect()),
    ).rejects.toBeInstanceOf(NarrativeTransitionRepositoryNotFoundError);
    await expect(repository.delete("effect-1")).rejects.toBeInstanceOf(
      NarrativeTransitionRepositoryNotFoundError,
    );
  });

  // A transition with no effects is a legitimate thing to delete, so zero rows
  // removed is a normal outcome here — unlike delete(id), where it means the
  // caller named a row that is not there.
  it("tolerates a childless transition on cascade delete", async () => {
    const { repository, calls } = buildRepository({ count: 0 });

    await expect(
      repository.deleteByTransitionId("transition-1"),
    ).resolves.toBeUndefined();
    expect(calls.deleteMany[0]).toMatchObject({
      where: { narrativeTransitionId: "transition-1" },
    });
  });
});
