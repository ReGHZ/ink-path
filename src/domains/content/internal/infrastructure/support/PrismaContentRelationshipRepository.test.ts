import { describe, expect, it } from "vitest";

import { ContentRelationshipMapper } from "./ContentRelationshipMapper.js";
import {
  PrismaContentRelationshipRepository,
  type ContentRelationshipDatabase,
} from "./PrismaContentRelationshipRepository.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";

import type { ContentRelationship as PrismaContentRelationship } from "../../../../../generated/prisma/client.js";

// Hand-written fake client rather than Postgres, for the two things that are
// otherwise unprovable:
//
//  - the ORDER CONTRACT of findByEntity (obligation 5 of the 7.1 gate). Its
//    tie-break is `id` asc, which needs two rows sharing a `createdAt`; the
//    end-to-end suite runs on a real clock and cannot produce that pair, so a
//    missing tie-break would sit there looking green forever.
//  - the 0-row split (404 vs 409) and the P2002 split (duplicate vs conflict).
//    Both are branches that only fire under interleaving or a constraint
//    violation, i.e. exactly what an integration test cannot arrange on demand.
//
// 7.4 still exercises the same methods against the real database; this covers
// the decisions the database cannot be asked to reproduce.
const NOW = new Date("2026-08-15T00:00:00.000Z");

function storedRow(
  overrides: Partial<PrismaContentRelationship> = {},
): PrismaContentRelationship {
  return {
    id: "relationship-1",
    version: 0,
    projectId: "project-1",
    sourceEntityType: "character",
    sourceEntityId: "character-1",
    targetEntityType: "faction",
    targetEntityId: "faction-1",
    relationType: "member_of",
    sourceAssertionId: "assertion-1",
    note: null,
    createdByUserId: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// Shape verified empirically for this Prisma/driver-adapter combination and
// documented in `shared/infrastructure/prismaErrors.ts:111-132`: a P2002 carries
// `constraint.fields` (raw database column names), not `constraint.index`.
function uniqueViolation(columns: readonly string[]): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: {
      driverAdapterError: {
        cause: {
          kind: "UniqueConstraintViolation",
          constraint: { fields: [...columns] },
        },
      },
    },
  });
}

const IDENTITY_COLUMNS = [
  "project_id",
  "relation_type",
  "source_entity_type",
  "source_entity_id",
  "target_entity_type",
  "target_entity_id",
];

type FakeBehaviour = {
  rows?: PrismaContentRelationship[];
  findUniqueResult?: PrismaContentRelationship | { id: string } | null;
  createError?: Error;
  writeCount?: number;
};

function createFakeDatabase(behaviour: FakeBehaviour = {}) {
  const calls = {
    findUnique: [] as unknown[],
    findMany: [] as unknown[],
    create: [] as unknown[],
    updateMany: [] as unknown[],
    deleteMany: [] as unknown[],
  };

  const client = {
    contentRelationship: {
      findUnique: (args: unknown) => {
        calls.findUnique.push(args);
        return Promise.resolve(behaviour.findUniqueResult ?? null);
      },
      findMany: (args: unknown) => {
        calls.findMany.push(args);
        return Promise.resolve(behaviour.rows ?? []);
      },
      create: (args: unknown) => {
        calls.create.push(args);
        return behaviour.createError
          ? Promise.reject(behaviour.createError)
          : Promise.resolve(storedRow());
      },
      updateMany: (args: unknown) => {
        calls.updateMany.push(args);
        return Promise.resolve({ count: behaviour.writeCount ?? 1 });
      },
      deleteMany: (args: unknown) => {
        calls.deleteMany.push(args);
        return Promise.resolve({ count: behaviour.writeCount ?? 1 });
      },
    },
  };

  return {
    calls,
    repository: new PrismaContentRelationshipRepository(
      client as unknown as ContentRelationshipDatabase,
    ),
  };
}

describe("PrismaContentRelationshipRepository", () => {
  describe("findByEntity", () => {
    it("asks for both sides of the row inside one project scope", async () => {
      const { calls, repository } = createFakeDatabase();

      await repository.findByEntity("project-1", "faction", "faction-1");

      expect(calls.findMany[0]).toMatchObject({
        where: {
          projectId: "project-1",
          OR: [
            { sourceEntityType: "faction", sourceEntityId: "faction-1" },
            { targetEntityType: "faction", targetEntityId: "faction-1" },
          ],
        },
      });
    });

    // The port states the order as part of its contract, so the adapter is
    // where that promise is either kept or quietly dropped.
    it("orders by createdAt asc with id asc as tie-break", async () => {
      const { calls, repository } = createFakeDatabase();

      await repository.findByEntity("project-1", "character", "character-1");

      expect(calls.findMany[0]).toMatchObject({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    });

    it("maps every row through the mapper", async () => {
      const { repository } = createFakeDatabase({
        rows: [storedRow(), storedRow({ id: "relationship-2" })],
      });

      const relationships = await repository.findByEntity(
        "project-1",
        "character",
        "character-1",
      );

      expect(relationships.map((relationship) => relationship.id)).toEqual([
        "relationship-1",
        "relationship-2",
      ]);
    });
  });

  describe("insert", () => {
    it("writes the aggregate's own id alongside the mapped columns", async () => {
      const { calls, repository } = createFakeDatabase();
      const relationship = ContentRelationshipMapper.toDomain(storedRow());

      await repository.insert(relationship);

      expect(calls.create[0]).toMatchObject({
        data: {
          id: "relationship-1",
          sourceEntityType: "character",
          sourceEntityId: "character-1",
          targetEntityType: "faction",
          targetEntityId: "faction-1",
          relationType: "member_of",
        },
      });
    });

    it("turns a violation of the natural-identity index into a duplicate error", async () => {
      const { repository } = createFakeDatabase({
        createError: uniqueViolation(IDENTITY_COLUMNS),
      });

      await expect(
        repository.insert(ContentRelationshipMapper.toDomain(storedRow())),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryDuplicateError);
    });

    // A primary-key collision is a transient anomaly, not a relationship the
    // user already created — collapsing the two would make the service unable
    // to tell the caller which 409 it hit.
    it("keeps any other unique violation a plain conflict", async () => {
      const { repository } = createFakeDatabase({
        createError: uniqueViolation(["id"]),
      });

      await expect(
        repository.insert(ContentRelationshipMapper.toDomain(storedRow())),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryConflictError);
    });

    it("lets a foreign-key violation surface raw", async () => {
      const foreignKeyViolation = Object.assign(
        new Error("Foreign key constraint failed"),
        { code: "P2003" },
      );
      const { repository } = createFakeDatabase({
        createError: foreignKeyViolation,
      });

      await expect(
        repository.insert(ContentRelationshipMapper.toDomain(storedRow())),
      ).rejects.toBe(foreignKeyViolation);
    });
  });

  describe("update", () => {
    it("guards the write with the version the aggregate was read at", async () => {
      const { calls, repository } = createFakeDatabase();

      await repository.update(
        ContentRelationshipMapper.toDomain(storedRow({ version: 4 })),
      );

      expect(calls.updateMany[0]).toMatchObject({
        where: { id: "relationship-1", version: 4 },
        data: { version: { increment: 1 } },
      });
    });

    it("answers conflict when 0 rows matched but the row is still there", async () => {
      const { repository } = createFakeDatabase({
        writeCount: 0,
        findUniqueResult: { id: "relationship-1" },
      });

      await expect(
        repository.update(ContentRelationshipMapper.toDomain(storedRow())),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryConflictError);
    });

    it("answers not-found when 0 rows matched because the row is gone", async () => {
      const { repository } = createFakeDatabase({
        writeCount: 0,
        findUniqueResult: null,
      });

      await expect(
        repository.update(ContentRelationshipMapper.toDomain(storedRow())),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryNotFoundError);
    });
  });

  describe("delete", () => {
    it("guards the delete with the expected version", async () => {
      const { calls, repository } = createFakeDatabase();

      await repository.delete("relationship-1", 4);

      expect(calls.deleteMany[0]).toMatchObject({
        where: { id: "relationship-1", version: 4 },
      });
    });

    it("answers conflict when 0 rows matched but the row is still there", async () => {
      const { repository } = createFakeDatabase({
        writeCount: 0,
        findUniqueResult: { id: "relationship-1" },
      });

      await expect(
        repository.delete("relationship-1", 4),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryConflictError);
    });

    it("answers not-found when 0 rows matched because the row is gone", async () => {
      const { repository } = createFakeDatabase({
        writeCount: 0,
        findUniqueResult: null,
      });

      await expect(
        repository.delete("relationship-1", 4),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryNotFoundError);
    });
  });
});
