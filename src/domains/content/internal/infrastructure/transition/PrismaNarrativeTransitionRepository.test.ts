import { describe, expect, it } from "vitest";

import {
  PrismaNarrativeTransitionRepository,
  type NarrativeTransitionDatabase,
} from "./PrismaNarrativeTransitionRepository.js";
import { NarrativeTransition } from "../../domain/transition/NarrativeTransition.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { NarrativeTransition as PrismaNarrativeTransition } from "../../../../../generated/prisma/client.js";

// Hand-written fake client rather than Postgres, for the same two reasons the
// relationship adapter documents (`../support/PrismaContentRelationshipRepository.test.ts:15-25`):
// an ORDER CONTRACT whose tie-break needs two rows sharing a `createdAt` — which
// a real clock will not produce on demand — and a zero-row branch that only
// fires when a row vanishes mid-request.
const now = new Date("2026-08-16T00:00:00.000Z");

const row: PrismaNarrativeTransition = {
  id: "transition-1",
  projectId: "project-1",
  sourceEntityType: "scene",
  sourceEntityId: "scene-1",
  title: "Raja Terbunuh",
  description: null,
  declaredByUserId: "user-1",
  reversesTransitionId: null,
  createdAt: now,
  updatedAt: now,
};

type Calls = {
  findUnique: number;
  findMany: unknown[];
  create: unknown[];
  updateMany: unknown[];
  deleteMany: unknown[];
};

function buildRepository(
  options: {
    count?: number;
    rows?: PrismaNarrativeTransition[];
  } = {},
) {
  const calls: Calls = {
    findUnique: 0,
    findMany: [],
    create: [],
    updateMany: [],
    deleteMany: [],
  };

  // No `$queryRaw` fake since gerbang G2 (G2-2): the adapter's `Pick<>` no longer
  // includes it, so a fake that provided it was satisfying a capability the
  // production type had already dropped.
  const client = {
    narrativeTransition: {
      findUnique: () => {
        calls.findUnique += 1;

        return Promise.resolve(row);
      },
      findMany: (args: unknown) => {
        calls.findMany.push(args);

        return Promise.resolve(options.rows ?? [row]);
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
  } as unknown as NarrativeTransitionDatabase;

  return {
    repository: new PrismaNarrativeTransitionRepository(client),
    calls,
  };
}

function buildTransition(): NarrativeTransition {
  return NarrativeTransition.reconstitute({
    id: "transition-1",
    projectId: "project-1",
    sourceEntityType: "scene",
    sourceEntityId: "scene-1",
    title: "Raja Terbunuh",
    description: "Dua penjaga ikut tewas.",
    declaredByUserId: "user-1",
    reversesTransitionId: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("PrismaNarrativeTransitionRepository", () => {
  it("orders project lists newest first with a total tie-break", async () => {
    const { repository, calls } = buildRepository();

    await repository.findByProjectId("project-1");

    expect(calls.findMany[0]).toMatchObject({
      where: { projectId: "project-1" },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  });

  // The three columns of `@@index([projectId, sourceEntityType, sourceEntityId])`,
  // in that order — the index exists for this query and nothing else.
  it("scopes the source-entity list by project as well as by entity", async () => {
    const { repository, calls } = buildRepository();

    await repository.findBySourceEntity("project-1", "scene", "scene-1");

    expect(calls.findMany[0]).toMatchObject({
      where: {
        projectId: "project-1",
        sourceEntityType: "scene",
        sourceEntityId: "scene-1",
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  });

  it("writes both timestamps explicitly on insert", async () => {
    const { repository, calls } = buildRepository();

    await repository.insert(buildTransition());

    // Left to the column defaults, the row and the response body would carry
    // different clocks — declare RETURNS the transition it just wrote.
    expect(calls.create[0]).toMatchObject({
      data: { id: "transition-1", createdAt: now, updatedAt: now },
    });
  });

  it("writes only the two human labels on update", async () => {
    const { repository, calls } = buildRepository();

    await repository.update(buildTransition());

    const data = (calls.updateMany[0] as { data: Record<string, unknown> }).data;

    // Source entity, reversal link and declaring user are absent: applied
    // revisions already point back at this causality, so it must not be
    // rewritable through a label edit.
    expect(Object.keys(data).sort()).toEqual([
      "description",
      "title",
      "updatedAt",
    ]);
  });

  it("reports a vanished row on update", async () => {
    const { repository } = buildRepository({ count: 0 });

    await expect(repository.update(buildTransition())).rejects.toBeInstanceOf(
      NarrativeTransitionRepositoryNotFoundError,
    );
  });

  it("reports a vanished row on delete", async () => {
    const { repository } = buildRepository({ count: 0 });

    await expect(repository.delete("transition-1")).rejects.toBeInstanceOf(
      NarrativeTransitionRepositoryNotFoundError,
    );
  });
});
