import { describe, expect, it } from "vitest";

import { RelationshipService } from "./RelationshipService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";
import { SEEDED_DEFINITIONS } from "../../domain/support/relationshipDefinitionSeed.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { OutboxEvent } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { TransitionEffect } from "../../domain/transition/TransitionEffect.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";
import type { RelationshipDefinitionReader } from "../ports/RelationshipDefinitionReader.js";
import type { RelationshipUnitOfWork } from "../ports/RelationshipUnitOfWork.js";


// The seeded vocabulary, which is what a project has from the moment it is
// created. Deliberately not a stub that says yes: an unknown predicate answers
// null here exactly as the database does, so the service's own 400 is what the
// tests exercise.
const seededDefinitionReader: RelationshipDefinitionReader = {
  findByPredicate: (_projectId: string, predicate: string) =>
    Promise.resolve(SEEDED_DEFINITIONS.get(predicate) ?? null),
  findAllByProject: () => Promise.resolve(SEEDED_DEFINITIONS),
};

const now = new Date("2026-08-15T00:00:00.000Z");

const writer: ProjectMembership = { role: "writer", canDelete: true };
const editorNoDelete: ProjectMembership = { role: "editor", canDelete: false };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

class FakeContentRelationshipRepository
  implements ContentRelationshipRepository
{
  readonly relationships = new Map<string, ContentRelationship>();
  readonly deleteCalls: Array<{ id: string; expectedVersion: number }> = [];
  readonly updateCalls: string[] = [];
  duplicateOnInsert = false;
  conflictOnInsert = false;
  conflictOnUpdate = false;
  notFoundOnUpdate = false;
  conflictOnDelete = false;
  notFoundOnDelete = false;

  findById(id: string): Promise<ContentRelationship | null> {
    return Promise.resolve(this.relationships.get(id) ?? null);
  }

  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    return Promise.resolve(
      [...this.relationships.values()].filter(
        (relationship) =>
          relationship.projectId === projectId &&
          ((relationship.sourceEntityType === entityType &&
            relationship.sourceEntityId === entityId) ||
            (relationship.targetEntityType === entityType &&
              relationship.targetEntityId === entityId)),
      ),
    );
  }

  insert(contentRelationship: ContentRelationship): Promise<void> {
    if (this.duplicateOnInsert) {
      return Promise.reject(new ContentRelationshipRepositoryDuplicateError());
    }

    if (this.conflictOnInsert) {
      return Promise.reject(new ContentRelationshipRepositoryConflictError());
    }

    this.relationships.set(contentRelationship.id, contentRelationship);
    return Promise.resolve();
  }

  update(contentRelationship: ContentRelationship): Promise<void> {
    this.updateCalls.push(contentRelationship.id);

    if (this.conflictOnUpdate) {
      return Promise.reject(new ContentRelationshipRepositoryConflictError());
    }

    if (this.notFoundOnUpdate) {
      return Promise.reject(new ContentRelationshipRepositoryNotFoundError());
    }

    this.relationships.set(
      contentRelationship.id,
      ContentRelationship.reconstitute({
        ...contentRelationship.toSnapshot(),
        version: contentRelationship.version + 1,
      }),
    );
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    this.deleteCalls.push({ id, expectedVersion });

    if (this.conflictOnDelete) {
      return Promise.reject(new ContentRelationshipRepositoryConflictError());
    }

    if (this.notFoundOnDelete) {
      return Promise.reject(new ContentRelationshipRepositoryNotFoundError());
    }

    this.relationships.delete(id);
    return Promise.resolve();
  }
}

// Keyed the same way the real adapter dispatches — by (entityType, entityId) —
// so a test can seed an entity that exists in ANOTHER project, which is the
// only way to prove the 404-not-403 rule.
class FakeContentEntityLocator implements ContentEntityLocator {
  private readonly entities = new Map<string, ContentEntityLocation>();

  // `entityName` carries a derived default rather than being seeded per call:
  // RelationshipService reads only `projectId` (registry rules 5-7), and the
  // field exists for the 7.4b delete guard, which is a different caller. A
  // hard-coded constant here would make every seeded entity share one name and
  // hide a dispatch mistake if this fake is ever reused.
  seed(entityType: ContentEntityType, entityId: string, projectId: string) {
    this.entities.set(`${entityType}:${entityId}`, {
      projectId,
      entityName: `${entityType} ${entityId}`,
    });
    return this;
  }

  locate({
    entityType,
    entityId,
  }: {
    entityType: ContentEntityType;
    entityId: string;
  }): Promise<ContentEntityLocation | null> {
    return Promise.resolve(
      this.entities.get(`${entityType}:${entityId}`) ?? null,
    );
  }
}

class FakeIdGenerator implements IdGenerator {
  private nextId = 1;

  generate(): string {
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return id;
  }
}

const clock: Clock = { now: () => now };

// Returns the AppError a call rejected with, so a test can assert on its
// MESSAGE and not only its code. `.catch()` alone would have widened the type to
// "error or the successful result", and would have silently reported a call
// that never failed at all.
async function captureFailure(
  work: Promise<unknown>,
): Promise<Error & { code: string }> {
  try {
    await work;
  } catch (error) {
    return error as Error & { code: string };
  }

  throw new Error("expected the call to fail, but it resolved");
}

// Runs the work inline against the SAME fakes the assertions below read, so a
// test can still see what the transaction wrote. No rollback simulation: what
// this fake proves is that both writes are attempted through one boundary, and
// the real rollback is exercised against Postgres in
// `test/integration/content-relationship-repository.integration.test.ts`.
function createUnitOfWork(
  relationships: ContentRelationshipRepository,
): {
  unitOfWork: RelationshipUnitOfWork;
  assertions: TransitionEffect[];
  outbox: OutboxEvent[];
} {
  const assertions: TransitionEffect[] = [];
  const outbox: OutboxEvent[] = [];

  return {
    assertions,
    outbox,
    unitOfWork: {
      transaction: (work) =>
        work(
          {
            assertions: {
              insert: (assertion) => {
                assertions.push(assertion);

                return Promise.resolve();
              },
              findById: () => Promise.resolve(null),
              findByIdForUpdate: () => Promise.resolve(null),
              findByTransitionId: () => Promise.resolve([]),
              update: () => Promise.resolve(),
              delete: () => Promise.resolve(),
              deleteByTransitionId: () => Promise.resolve(),
            },
            contentRelationships: relationships,
          },
          {
            insert: (event) => {
              outbox.push(event);

              return Promise.resolve();
            },
          },
        ),
    },
  };
}

function createService() {
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator()
    .seed("character", "character-1", "proj-1")
    .seed("faction", "faction-1", "proj-1")
    .seed("event", "event-1", "proj-1")
    .seed("faction", "faction-outsider", "proj-2");

  const { unitOfWork, assertions, outbox } = createUnitOfWork(relationships);

  return {
    relationships,
    locator,
    assertions,
    outbox,
    service: new RelationshipService(
      clock,
      new FakeIdGenerator(),
      relationships,
      locator,
      seededDefinitionReader,
      unitOfWork,
    ),
  };
}

function createInput(
  overrides: Partial<{
    relationType: string;
    sourceEntityType: ContentEntityType;
    sourceEntityId: string;
    targetEntityType: ContentEntityType;
    targetEntityId: string;
    note: string | null;
    requestingMembership: ProjectMembership;
  }> = {},
) {
  return {
    requestingUserId: "user-1",
    requestingMembership: overrides.requestingMembership ?? writer,
    projectId: "proj-1",
    sourceEntityType: overrides.sourceEntityType ?? ("character" as const),
    sourceEntityId: overrides.sourceEntityId ?? "character-1",
    targetEntityType: overrides.targetEntityType ?? ("faction" as const),
    targetEntityId: overrides.targetEntityId ?? "faction-1",
    relationType: overrides.relationType ?? "member_of",
    note: overrides.note ?? null,
  };
}

function seedRelationship(
  relationships: FakeContentRelationshipRepository,
  overrides: Partial<{ id: string; projectId: string; version: number }> = {},
): ContentRelationship {
  const relationship = ContentRelationship.reconstitute({
    id: overrides.id ?? "relationship-1",
    version: overrides.version ?? 0,
    projectId: overrides.projectId ?? "proj-1",
    sourceEntityType: "character",
    sourceEntityId: "character-1",
    targetEntityType: "faction",
    targetEntityId: "faction-1",
    relationType: "member_of",
    note: "outer disciple",
    createdByUserId: "user-1",
    createdAt: now,
    updatedAt: now,
  });

  relationships.relationships.set(relationship.id, relationship);
  return relationship;
}

describe("RelationshipService", () => {
  describe("createRelationship", () => {
    it("stores the relationship and returns it", async () => {
      const { relationships, service } = createService();

      const detail = await service.createRelationship(createInput());

      expect(relationships.relationships.size).toBe(1);
      expect(detail.relationType).toBe("member_of");
      expect(detail.sourceEntityId).toBe("character-1");
      expect(detail.targetEntityId).toBe("faction-1");
      expect(detail.createdByUserId).toBe("user-1");
    });

    // Rule 9: the endpoints the caller sent are NOT the endpoints stored. That
    // reordering is what makes `A↔B` and `B↔A` collide on the unique index, so
    // it has to be visible in the response too — otherwise a client would think
    // its own orientation was kept.
    it("canonicalises a non-directional pair before storing it", async () => {
      const { service } = createService();

      const detail = await service.createRelationship(
        createInput({
          relationType: "ally_of",
          sourceEntityType: "faction",
          sourceEntityId: "faction-1",
          targetEntityType: "character",
          targetEntityId: "character-1",
        }),
      );

      expect(detail.sourceEntityType).toBe("character");
      expect(detail.targetEntityType).toBe("faction");
    });

    it("rejects a reviewer before touching the repository", async () => {
      const { relationships, service } = createService();

      await expect(
        service.createRelationship(
          createInput({ requestingMembership: reviewer }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(relationships.relationships.size).toBe(0);
    });

    it("answers 404 when the source entity does not exist", async () => {
      const { relationships, service } = createService();

      await expect(
        service.createRelationship(
          createInput({ sourceEntityId: "character-missing" }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      expect(relationships.relationships.size).toBe(0);
    });

    // The entity exists — it simply belongs to another tenant. 403 would
    // confirm its existence just as well as a 200 would; only 404 does not.
    it("answers 404, never 403, for an entity owned by another project", async () => {
      const { relationships, service } = createService();

      await expect(
        service.createRelationship(
          createInput({ targetEntityId: "faction-outsider" }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      expect(relationships.relationships.size).toBe(0);
    });

    // Obligation 1 of the 7.1 gate: errorHandler.ts only special-cases AppError,
    // so without mapRelationshipError this exact call would answer a raw 500
    // instead of the 400 Flow 4 specifies.
    it("maps an unknown relation type to a 400, not a 500", async () => {
      const { service } = createService();

      const failure = await captureFailure(
        service.createRelationship(
          createInput({ relationType: "cultivates_with" }),
        ),
      );

      expect(failure.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(failure.message).toMatch(/Unknown relation type/);
    });

    it("maps a disallowed entity pair to a 400", async () => {
      const { service } = createService();

      await expect(
        service.createRelationship(
          createInput({
            relationType: "member_of",
            sourceEntityType: "event",
            sourceEntityId: "event-1",
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("maps a self-relationship to a 400", async () => {
      const { service } = createService();

      await expect(
        service.createRelationship(
          createInput({
            relationType: "ally_of",
            targetEntityType: "character",
            targetEntityId: "character-1",
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    // Obligation 3: the repository keeps duplicate and version-conflict apart,
    // and that separation is worth nothing unless the two reach the caller as
    // different messages. Both are 409, so the code alone cannot tell them
    // apart — the assertion is on the messages.
    it("gives a duplicate and a version conflict two different 409 messages", async () => {
      const duplicateCase = createService();
      duplicateCase.relationships.duplicateOnInsert = true;

      const duplicate = await captureFailure(
        duplicateCase.service.createRelationship(createInput()),
      );

      const conflictCase = createService();
      conflictCase.relationships.conflictOnInsert = true;

      const conflict = await captureFailure(
        conflictCase.service.createRelationship(createInput()),
      );

      expect(duplicate.code).toBe(ErrorCode.CONFLICT);
      expect(conflict.code).toBe(ErrorCode.CONFLICT);
      expect(duplicate.message).not.toBe(conflict.message);
      expect(duplicate.message).toMatch(/already exists/);
      expect(conflict.message).toMatch(/concurrently/);
    });
  });

  describe("reads", () => {
    // Obligation 4: findById is not project-scoped, so this comparison is the
    // only thing standing between a tenant and another tenant's row. The row is
    // really there — the 404 is the service's decision, not an empty lookup.
    it("hides a relationship owned by another project behind 404", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships, { projectId: "proj-2" });

      await expect(
        service.getRelationshipById("proj-1", "relationship-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      expect(relationships.relationships.size).toBe(1);
    });

    it("returns a relationship in its own project to any role", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      const detail = await service.getRelationshipById(
        "proj-1",
        "relationship-1",
      );

      expect(detail.id).toBe("relationship-1");
      expect(detail).not.toHaveProperty("version");
    });

    it("lists relationships from both sides of the entity", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      const asSource = await service.listRelationshipsByEntity(
        "proj-1",
        "character",
        "character-1",
      );
      const asTarget = await service.listRelationshipsByEntity(
        "proj-1",
        "faction",
        "faction-1",
      );

      expect(asSource.map((relationship) => relationship.id)).toEqual([
        "relationship-1",
      ]);
      expect(asTarget.map((relationship) => relationship.id)).toEqual([
        "relationship-1",
      ]);
    });

    // Flow 4 §Read step 4. Without the entity check this would answer an empty
    // list, which reads as "this entity has no relationships" rather than "this
    // entity is not yours".
    it("answers 404 when listing relationships of an entity from another project", async () => {
      const { service } = createService();

      await expect(
        service.listRelationshipsByEntity(
          "proj-1",
          "faction",
          "faction-outsider",
        ),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("updateRelationshipNote", () => {
    it("writes the new note", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      const detail = await service.updateRelationshipNote(
        "proj-1",
        "relationship-1",
        {
          requestingUserId: "user-1",
          requestingMembership: writer,
          note: "promoted to inner disciple",
        },
      );

      expect(detail.note).toBe("promoted to inner disciple");
      expect(relationships.updateCalls).toEqual(["relationship-1"]);
    });

    // A no-op PATCH must not burn a version increment: the row has no
    // content_revisions history, so every pointless write is also a pointless
    // chance to collide with a real one.
    it("does not touch the repository when the note is unchanged", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      await service.updateRelationshipNote("proj-1", "relationship-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        note: "outer disciple",
      });

      expect(relationships.updateCalls).toEqual([]);
    });

    it("rejects a reviewer", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      await expect(
        service.updateRelationshipNote("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          note: "anything",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(relationships.updateCalls).toEqual([]);
    });

    it("maps a version conflict to a 409", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);
      relationships.conflictOnUpdate = true;

      await expect(
        service.updateRelationshipNote("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          note: "changed",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it("maps a vanished row to a 404", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);
      relationships.notFoundOnUpdate = true;

      await expect(
        service.updateRelationshipNote("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          note: "changed",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("deleteRelationship", () => {
    // The delete-guard exists only if the version actually travels from the
    // read to the write. Asserting the recorded argument is what proves it —
    // a `delete(id)` that ignored the version would still make every other
    // delete test pass.
    it("passes the version it just read as the guard", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships, { version: 3 });

      await service.deleteRelationship("proj-1", "relationship-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(relationships.deleteCalls).toEqual([
        { id: "relationship-1", expectedVersion: 3 },
      ]);
      expect(relationships.relationships.size).toBe(0);
    });

    // The one place this domain diverges from every Phase 4-6 service: Flow 4
    // lines 17 and 159 give Editor delete WITHOUT `can_delete`, because cutting
    // a link destroys no content. Reusing assertCanDelete here would have been
    // the natural copy-paste and would have been wrong.
    it("lets an editor without can_delete remove a relationship", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      await service.deleteRelationship("proj-1", "relationship-1", {
        requestingUserId: "user-1",
        requestingMembership: editorNoDelete,
      });

      expect(relationships.relationships.size).toBe(0);
    });

    it("rejects a reviewer", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships);

      await expect(
        service.deleteRelationship("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: reviewer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(relationships.deleteCalls).toEqual([]);
    });

    it("hides another project's relationship behind 404 without deleting it", async () => {
      const { relationships, service } = createService();
      seedRelationship(relationships, { projectId: "proj-2" });

      await expect(
        service.deleteRelationship("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      expect(relationships.deleteCalls).toEqual([]);
      expect(relationships.relationships.size).toBe(1);
    });

    it("maps a stale version to a 409 and a vanished row to a 404", async () => {
      const conflictCase = createService();
      seedRelationship(conflictCase.relationships);
      conflictCase.relationships.conflictOnDelete = true;

      await expect(
        conflictCase.service.deleteRelationship("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

      const notFoundCase = createService();
      seedRelationship(notFoundCase.relationships);
      notFoundCase.relationships.notFoundOnDelete = true;

      await expect(
        notFoundCase.service.deleteRelationship("proj-1", "relationship-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });
});
