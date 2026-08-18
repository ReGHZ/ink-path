import { afterAll, beforeEach, describe, expect, it } from "vitest";


import {
  createRelationshipService,
  type RelationshipService,
} from "../../src/domains/content/internal/application/support/RelationshipService.js";
import { ContentRelationship } from "../../src/domains/content/internal/domain/support/ContentRelationship.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../src/domains/content/internal/domain/support/ContentRelationshipRepositoryError.js";
import { seededDefinition } from "../../src/domains/content/internal/domain/support/relationshipDefinitionSeed.js";
import { PrismaContentRelationshipRepository } from "../../src/domains/content/internal/infrastructure/support/PrismaContentRelationshipRepository.js";
import { PrismaRelationshipDefinitionReader } from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionReader.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import { AppError } from "../../src/shared/errors/AppError.js";
import { ErrorCode } from "../../src/shared/errors/ErrorCode.js";
import { seedProjectVocabulary } from "../helpers/relationshipVocabulary.js";


import type { ContentRelationshipRepository } from "../../src/domains/content/internal/domain/support/ContentRelationshipRepository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Two things only a real database can decide, both carried here from earlier
// gates:
//
//   1. The duplicate branch. `PrismaContentRelationshipRepository.test.ts` feeds
//      it a HAND-BUILT P2002, so it proves the branching, not that Postgres
//      raises what the branch expects (`notes/phase-7-content-relationship.md:591-595`
//      — "jangan geser test dedup"). Dedup is the whole reason canonicalisation
//      exists; if the real error does not match the six-column index, Duplicate
//      silently degrades to a generic Conflict and nobody notices.
//   2. The version guard. `expectedVersion` never crosses the wire (K4), so the
//      service reads it from the row it just loaded and an HTTP test cannot
//      schedule the interleaving that makes it stale. Two aggregates loaded from
//      the same row can — deterministically, with no sleeps and no races.
// FIXTURE ID BLOCK 015 — owner/project ids end in `...0000000015NN`, entity and
// relationship ids use the `65656565` prefix. Both were unused when this file was
// written (blocks 000-014 and prefixes 00000000/1x/2x/3x-9x/616263/64 are taken;
// `77777777` belongs to faction-repository).
//
// Vitest runs test FILES in parallel and every repository test cleans up by
// deleting its own project and user. Two files sharing a block therefore delete
// each other's fixtures mid-run, and the damage is symmetric — whichever file
// happens to reach `cleanDatabase` first breaks the other. It also fails
// intermittently: a full-suite run can pass by scheduling luck and fail on the
// next. This file collided with faction-repository on its first version and the
// suite still went green twice before the pair was run together.
//
// Before adding fixtures here or in a new file: grep `test/integration/` for the
// block AND the prefix. `tsc`, lint and a single-file run cannot see this.
const now = new Date("2026-08-15T00:00:00.000Z");
const later = new Date("2026-08-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001501";
const projectId = "00000000-0000-4000-8000-000000001502";
const otherProjectId = "00000000-0000-4000-8000-000000001503";

const characterA = "65656565-0000-4000-8000-00000000000a";
const characterB = "65656565-0000-4000-8000-00000000000b";
const factionA = "65656565-0000-4000-8000-0000000000fa";

const relationshipIds = [
  "65656565-0000-4000-8000-000000000001",
  "65656565-0000-4000-8000-000000000002",
  "65656565-0000-4000-8000-000000000003",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaContentRelationshipRepository(prisma);
// The real adapter over the real rows the seeder wrote — not a stub. The point
// of this file is that the database answers, and the vocabulary is now part of
// what it answers with.
const definitionReader = new PrismaRelationshipDefinitionReader(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Relationships first: `content_relationships.project_id` is onDelete:
  // Restrict, so deleting the project with a row still attached fails instead of
  // cleaning up.
  await client.contentRelationship.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  // Assertions before the vocabulary they reference (onDelete: Restrict).
  await client.transitionEffect.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  // Vocabulary before the project: `relationship_definitions` is onDelete:
  // Restrict, so a project still holding its predicates refuses to be deleted.
  await client.relationshipDefinition.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.project.deleteMany({
    where: { id: { in: [projectId, otherProjectId] } },
  });
  await client.user.deleteMany({ where: { id: ownerUserId } });

}

async function seedOwnerAndProjects(): Promise<void> {
  await users.insert(
    User.create({
      id: ownerUserId,
      email: "relationship-owner@example.com",
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
      name: "Relationship test project",
      now,
    }),
  );

  // Second project with the SAME entity ids used on purpose: it is the only way
  // to prove the tenant filter is doing work rather than being satisfied by
  // fixtures that could never collide.
  await projects.insert(
    Project.create({
      id: otherProjectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Relationship other project",
      now,
    }),
  );

  // Both projects need the predicate vocabulary: since step 4 a relationship row
  // references it by composite foreign key.
  await seedProjectVocabulary(prisma, projectId);
  await seedProjectVocabulary(prisma, otherProjectId);
}

// No content entities are seeded anywhere in this file, and that is not an
// oversight: `content_relationships` references entities polymorphically with no
// FK, so a row can point at ids that were never created. The adapter's behaviour
// is identical either way, and pretending otherwise would hide that the missing
// FK is exactly the accepted risk 7.4b has to decide on.
function relationship(
  id: string,
  overrides: {
    projectId?: string;
    relationType?: string;
    source?: { entityType: "character" | "faction"; entityId: string };
    target?: { entityType: "character" | "faction"; entityId: string };
    note?: string | null;
    now?: Date;
  } = {},
): ContentRelationship {
  const relationType = overrides.relationType ?? "ally_of";

  return ContentRelationship.create({
    id,
    projectId: overrides.projectId ?? projectId,
    relationType,
    // The seeded row for this predicate — the same one the seeder wrote into
    // both fixture projects. Derived from `relationType` so a case that changes
    // only the predicate cannot keep another one's pair matrix.
    definition: seededDefinition(relationType),
    source: overrides.source ?? { entityType: "character", entityId: characterA },
    target: overrides.target ?? { entityType: "character", entityId: characterB },
    note: overrides.note,
    createdByUserId: ownerUserId,
    now: overrides.now ?? now,
  });
}

// Loads and asserts presence in one step: every caller below needs a real
// aggregate to mutate, and a fixture that vanished should fail as a fixture
// error rather than as a confusing assertion three lines later.
async function loadRelationship(id: string): Promise<ContentRelationship> {
  const found = await repository.findById(id);

  if (!found) {
    throw new Error(`Fixture relationship ${id} was not persisted`);
  }

  return found;
}

describe("PrismaContentRelationshipRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerAndProjects();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await prisma.$disconnect();
  });

  describe("duplicate detection against the real unique index", () => {
    it("rejects the SAME non-directional pair written in reverse", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      // Written B->A. The domain canonicalises before persisting, so this
      // produces byte-identical natural identity to the row above — which is the
      // entire dedup mechanism (K5: no read-before-write).
      const mirrored = relationship(relationshipIds[1], {
        source: { entityType: "character", entityId: characterB },
        target: { entityType: "character", entityId: characterA },
      });

      await expect(repository.insert(mirrored)).rejects.toBeInstanceOf(
        ContentRelationshipRepositoryDuplicateError,
      );

      expect(await prisma.contentRelationship.count({ where: { projectId } })).toBe(
        1,
      );
    });

    it("classifies a primary-key collision as Conflict, not Duplicate", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      // Same id, different natural identity: the P2002 fires on the PK, not on
      // the six-column index. This is what proves `matchesUniqueConstraint`
      // reads a REAL driver-adapter payload correctly — a fake error can only
      // prove that the function does what its own fake says.
      const sameId = relationship(relationshipIds[0], {
        relationType: "enemy_of",
      });

      const thrown = await repository
        .insert(sameId)
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(ContentRelationshipRepositoryConflictError);
      // Redundant today — the two errors are sibling classes, so the assertion
      // above already excludes Duplicate. It is here for the day someone makes
      // Duplicate extend Conflict: from then on the positive assertion alone
      // would stop discriminating, silently.
      expect(thrown).not.toBeInstanceOf(
        ContentRelationshipRepositoryDuplicateError,
      );
    });

    it("keeps both orientations of a DIRECTIONAL type", async () => {
      // The mirror image of the first test: `influences` is directional, so
      // A->B and B->A are two different facts and the index must NOT collide.
      // Without this, a unique index that was accidentally too wide would look
      // correct to the dedup test alone.
      await repository.insert(
        relationship(relationshipIds[0], {
          relationType: "influences",
          source: { entityType: "character", entityId: characterA },
          target: { entityType: "faction", entityId: factionA },
        }),
      );
      await repository.insert(
        relationship(relationshipIds[1], {
          relationType: "influences",
          source: { entityType: "faction", entityId: factionA },
          target: { entityType: "character", entityId: characterA },
        }),
      );

      expect(await prisma.contentRelationship.count({ where: { projectId } })).toBe(
        2,
      );
    });

    it("allows the same pair under a different relation type", async () => {
      await repository.insert(relationship(relationshipIds[0]));
      await repository.insert(
        relationship(relationshipIds[1], { relationType: "enemy_of" }),
      );

      expect(await prisma.contentRelationship.count({ where: { projectId } })).toBe(
        2,
      );
    });
  });

  describe("version guard on update", () => {
    it("increments the version and writes the note when the guard matches", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      const loaded = await loadRelationship(relationshipIds[0]);
      expect(loaded.version).toBe(0);

      loaded.updateNote({ note: "first note", now: later });
      await repository.update(loaded);

      const row = await prisma.contentRelationship.findUnique({
        where: { id: relationshipIds[0] },
      });

      expect(row?.version).toBe(1);
      expect(row?.note).toBe("first note");
      // The aggregate keeps the version it was READ at — the increment belongs
      // to the mapper (`ContentRelationshipMapper.ts:98-110`). If the entity
      // mutated its own version, the guard below could never go stale.
      expect(loaded.version).toBe(0);
      expect(row?.updatedAt.toISOString()).toBe(later.toISOString());
    });

    it("rejects a stale writer with Conflict and leaves the row untouched", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      // Two aggregates from the same row: exactly the interleaving the guard
      // exists for, made deterministic. Over HTTP this is a race that cannot be
      // scheduled, which is why it is proven here instead of in the e2e.
      const first = await loadRelationship(relationshipIds[0]);
      const second = await loadRelationship(relationshipIds[0]);

      first.updateNote({ note: "winner", now: later });
      await repository.update(first);

      second.updateNote({ note: "loser", now: later });
      await expect(repository.update(second)).rejects.toBeInstanceOf(
        ContentRelationshipRepositoryConflictError,
      );

      const row = await prisma.contentRelationship.findUnique({
        where: { id: relationshipIds[0] },
      });

      // Not just "it threw": a guard that threw AFTER writing would be worse
      // than no guard, because the caller would retry over its own change.
      expect(row?.note).toBe("winner");
      expect(row?.version).toBe(1);
    });

    it("answers NotFound, not Conflict, when the row is gone entirely", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      const loaded = await loadRelationship(relationshipIds[0]);
      await prisma.contentRelationship.delete({
        where: { id: relationshipIds[0] },
      });

      loaded.updateNote({ note: "into the void", now: later });

      // Both cases match zero rows; only the second lookup can tell them apart,
      // and the two get different HTTP answers (404 vs 409).
      await expect(repository.update(loaded)).rejects.toBeInstanceOf(
        ContentRelationshipRepositoryNotFoundError,
      );
    });
  });

  describe("version guard on delete", () => {
    it("deletes the row when the guard matches", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      await repository.delete(relationshipIds[0], 0);

      expect(await repository.findById(relationshipIds[0])).toBeNull();
    });

    it("refuses a stale delete with Conflict and keeps the row", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      const loaded = await loadRelationship(relationshipIds[0]);
      loaded.updateNote({ note: "bumped", now: later });
      await repository.update(loaded);

      // Version 0 is what a reader that loaded before the note change would
      // carry. Without the guard this delete would silently succeed — and there
      // is no `content_revisions` history for this table, so the row would be
      // unrecoverable.
      await expect(repository.delete(relationshipIds[0], 0)).rejects.toBeInstanceOf(
        ContentRelationshipRepositoryConflictError,
      );

      expect(await repository.findById(relationshipIds[0])).not.toBeNull();
    });

    it("answers NotFound for a row that is already gone", async () => {
      await expect(
        repository.delete(relationshipIds[0], 0),
      ).rejects.toBeInstanceOf(ContentRelationshipRepositoryNotFoundError);
    });
  });

  describe("findByEntity", () => {
    it("returns rows from BOTH sides of the entity", async () => {
      await repository.insert(
        relationship(relationshipIds[0], {
          relationType: "influences",
          source: { entityType: "character", entityId: characterA },
          target: { entityType: "faction", entityId: factionA },
        }),
      );
      await repository.insert(
        relationship(relationshipIds[1], {
          relationType: "influences",
          source: { entityType: "faction", entityId: factionA },
          target: { entityType: "character", entityId: characterA },
        }),
      );

      const found = await repository.findByEntity(
        projectId,
        "character",
        characterA,
      );

      expect(found.map((r) => r.id).sort()).toEqual(
        [relationshipIds[0], relationshipIds[1]].sort(),
      );
    });

    it("orders by createdAt then id, with the tie-break exercised", async () => {
      // Identical `now` for all three: since the mapper writes both timestamps
      // explicitly (7.2 fix), rows created in the same millisecond really do tie
      // in the column, and only the `id` tie-break makes the order total. A wall
      // clock cannot produce this reliably.
      const ids = [...relationshipIds].sort();

      await repository.insert(
        relationship(ids[2], { relationType: "ally_of" }),
      );
      await repository.insert(
        relationship(ids[0], { relationType: "enemy_of" }),
      );
      await repository.insert(
        relationship(ids[1], { relationType: "related_to" }),
      );

      const found = await repository.findByEntity(
        projectId,
        "character",
        characterA,
      );

      expect(found.map((r) => r.id)).toEqual(ids);
    });

    it("never returns another project's row for the same entity id", async () => {
      await repository.insert(relationship(relationshipIds[0]));
      await repository.insert(
        relationship(relationshipIds[1], { projectId: otherProjectId }),
      );

      const found = await repository.findByEntity(
        projectId,
        "character",
        characterA,
      );

      expect(found.map((r) => r.id)).toEqual([relationshipIds[0]]);
    });
  });

  // Item 13 asks for a stale guard to answer **409**, not merely to throw
  // ConflictError. Two links prove that today: this file proves the repository
  // raises Conflict against real Postgres, and RelationshipService.test.ts
  // proves Conflict maps to 409 — but with a FAKE repository, so nothing walked
  // the whole chain. These two tests do, by giving the service a repository that
  // bumps the version behind its back between the read and the write. That is
  // the interleaving the guard exists for; over HTTP it is a race that cannot be
  // scheduled, which is why it is staged here.
  describe("through RelationshipService, against the real database", () => {
    const membership = { role: "writer", canDelete: true } as const;
    const clock = { now: () => later };
    const idGenerator = { generate: () => crypto.randomUUID() };
    // The locator is faked on purpose: what is under test is the version chain,
    // and a real locator would drag nine repositories in without changing the
    // outcome. Its own wiring is proven in content-relationship-wiring.
    // `entityName` is required by the port and never read on the paths under
    // test — update and delete resolve nothing by name. Empty string rather than
    // a plausible label so a test that starts depending on it reads as wrong.
    const locator = {
      locate: () => Promise.resolve({ projectId, entityName: "" }),
    };

    // Reads through the real repository, then advances the row's version so the
    // aggregate the service is holding is already out of date by the time it
    // writes. Only findById is decorated — every other call is the real thing.
    function serviceOverStaleReads(): RelationshipService {
      const staleReading: ContentRelationshipRepository = {
        findById: async (id) => {
          const found = await repository.findById(id);

          await prisma.contentRelationship.updateMany({
            where: { id },
            data: { version: { increment: 1 }, note: "written by someone else" },
          });

          return found;
        },
        findByEntity: (...args) => repository.findByEntity(...args),
        insert: (entity) => repository.insert(entity),
        update: (entity) => repository.update(entity),
        delete: (id, expectedVersion) => repository.delete(id, expectedVersion),
      };

      return createRelationshipService({
        clock,
        idGenerator,
        contentRelationshipRepository: staleReading,
        contentEntityLocator: locator,
        relationshipDefinitionReader: definitionReader,
      });
    }

    it("answers 409, not a silent overwrite, when the note update is stale", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      const error = await serviceOverStaleReads()
        .updateRelationshipNote(projectId, relationshipIds[0], {
          requestingUserId: ownerUserId,
          requestingMembership: membership,
          note: "my note",
        })
        .catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.CONFLICT);

      const row = await prisma.contentRelationship.findUnique({
        where: { id: relationshipIds[0] },
      });

      expect(row?.note).toBe("written by someone else");
    });

    it("answers 409, not a silent delete, when the delete guard is stale", async () => {
      await repository.insert(relationship(relationshipIds[0]));

      const error = await serviceOverStaleReads()
        .deleteRelationship(projectId, relationshipIds[0], {
          requestingUserId: ownerUserId,
          requestingMembership: membership,
        })
        .catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
      // The row survives. There is no `content_revisions` history for this
      // table, so a delete that slipped past the guard would be unrecoverable.
      expect(await repository.findById(relationshipIds[0])).not.toBeNull();
    });

    it("answers 404 when the row is gone rather than merely changed", async () => {
      const service = createRelationshipService({
        clock,
        idGenerator,
        contentRelationshipRepository: repository,
        contentEntityLocator: locator,
        relationshipDefinitionReader: definitionReader,
      });

      const error = await service
        .deleteRelationship(projectId, relationshipIds[0], {
          requestingUserId: ownerUserId,
          requestingMembership: membership,
        })
        .catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  it("findById is NOT project-scoped — ownership is the service's job", async () => {
    // Documents the port's contract rather than a bug: the service compares
    // `projectId` itself and answers 404 (`RelationshipService.loadExistingRelationship`).
    // If this ever starts filtering, that comparison becomes dead code and the
    // reason for it is lost.
    await repository.insert(
      relationship(relationshipIds[0], { projectId: otherProjectId }),
    );

    const found = await repository.findById(relationshipIds[0]);

    expect(found?.projectId).toBe(otherProjectId);
  });
});
