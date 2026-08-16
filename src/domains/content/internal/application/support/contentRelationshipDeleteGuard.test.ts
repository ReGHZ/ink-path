import { describe, expect, it } from "vitest";

import {
  assertNoBlockingRelationships,
  ContentRelationshipsBlockedError,
  mapBlockedByRelationshipsError,
  BLOCKING_RELATIONSHIP_DETAIL_LIMIT,
} from "./contentRelationshipDeleteGuard.js";
import { AppError } from "../../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import { ContentRelationshipRepositoryNotFoundError } from "../../domain/support/ContentRelationshipRepositoryError.js";

import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const PROJECT_ID = "proj-1";

type Endpoint = { entityType: ContentEntityType; entityId: string };

function relationship(
  id: string,
  relationType: string,
  source: Endpoint,
  target: Endpoint,
): ContentRelationship {
  return ContentRelationship.create({
    id,
    projectId: PROJECT_ID,
    relationType,
    source,
    target,
    createdByUserId: "user-1",
    now,
  });
}

// Records what the guard asked for: scoping is half of the contract here — an
// unscoped read would block a delete on another tenant's rows.
class FakeContentRelationshipRepository
  implements ContentRelationshipRepository
{
  readonly calls: Array<{
    projectId: string;
    entityType: ContentEntityType;
    entityId: string;
  }> = [];

  constructor(private readonly rows: ContentRelationship[]) { }

  findById(): Promise<ContentRelationship | null> {
    return Promise.reject(new Error("findById is not part of the delete guard"));
  }

  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    this.calls.push({ projectId, entityType, entityId });

    return Promise.resolve(this.rows);
  }

  insert(): Promise<void> {
    return Promise.reject(new Error("insert is not part of the delete guard"));
  }

  update(): Promise<void> {
    return Promise.reject(new Error("update is not part of the delete guard"));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error("delete is not part of the delete guard"));
  }
}

class FakeContentEntityLocator implements ContentEntityLocator {
  readonly lookups: string[] = [];
  private readonly entities = new Map<string, ContentEntityLocation>();

  seed(
    entityType: ContentEntityType,
    entityId: string,
    location: ContentEntityLocation,
  ): this {
    this.entities.set(`${entityType}:${entityId}`, location);
    return this;
  }

  locate({
    entityType,
    entityId,
  }: {
    entityType: ContentEntityType;
    entityId: string;
  }): Promise<ContentEntityLocation | null> {
    this.lookups.push(`${entityType}:${entityId}`);

    return Promise.resolve(
      this.entities.get(`${entityType}:${entityId}`) ?? null,
    );
  }
}

// Drives the full two-step the services perform: the guard raises inside the
// transaction, the mapper turns it into the AppError after the rollback.
async function conflictFrom(
  rows: ContentRelationship[],
  entity: { entityType: ContentEntityType; entityId: string },
  locator: ContentEntityLocator,
): Promise<AppError> {
  const repository = new FakeContentRelationshipRepository(rows);
  let blocked: unknown = null;

  try {
    await assertNoBlockingRelationships(repository, {
      projectId: PROJECT_ID,
      ...entity,
    });
  } catch (error) {
    blocked = error;
  }

  if (blocked === null) {
    throw new Error("test fixture: the guard did not block");
  }

  try {
    await mapBlockedByRelationshipsError(blocked, {
      contentEntityLocator: locator,
      entityLabel: "Character",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }

    throw error;
  }

  throw new Error("test fixture: the blocked error was not mapped to a conflict");
}

describe("assertNoBlockingRelationships", () => {
  it("passes silently when nothing points at the entity, scoped to the project", async () => {
    const repository = new FakeContentRelationshipRepository([]);

    await expect(
      assertNoBlockingRelationships(repository, {
        projectId: PROJECT_ID,
        entityType: "character",
        entityId: "char-1",
      }),
    ).resolves.toBeUndefined();

    // The scope is the guard's own responsibility: `content_relationships` has
    // no FK to fall back on, so a read that forgot `projectId` would let one
    // tenant's rows block another tenant's delete.
    expect(repository.calls).toEqual([
      { projectId: PROJECT_ID, entityType: "character", entityId: "char-1" },
    ]);
  });

  it("raises the internal blocked error carrying every row, not just the reported ones", async () => {
    const rows = [
      relationship(
        "rel-1",
        "member_of",
        { entityType: "character", entityId: "char-1" },
        { entityType: "faction", entityId: "faction-1" },
      ),
    ];
    const repository = new FakeContentRelationshipRepository(rows);

    await expect(
      assertNoBlockingRelationships(repository, {
        projectId: PROJECT_ID,
        entityType: "character",
        entityId: "char-1",
      }),
    ).rejects.toBeInstanceOf(ContentRelationshipsBlockedError);
  });
});

describe("mapBlockedByRelationshipsError", () => {
  // The nine services call this BEFORE their own map<Entity>Error(). If it
  // swallowed or rewrote anything else, a NotFound would stop answering 404.
  it("returns untouched for any error that is not a blocked delete", async () => {
    const locator = new FakeContentEntityLocator();

    await expect(
      mapBlockedByRelationshipsError(
        new ContentRelationshipRepositoryNotFoundError(),
        { contentEntityLocator: locator, entityLabel: "Character" },
      ),
    ).resolves.toBeUndefined();

    expect(locator.lookups).toEqual([]);
  });

  it("names the counterpart when the deleted entity is the SOURCE", async () => {
    const locator = new FakeContentEntityLocator().seed(
      "faction",
      "faction-1",
      { projectId: PROJECT_ID, entityName: "The Silver Hand" },
    );

    const conflict = await conflictFrom(
      [
        relationship(
          "rel-1",
          "member_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-1" },
        ),
      ],
      { entityType: "character", entityId: "char-1" },
      locator,
    );

    expect(conflict.message).toBe(
      "Character is still linked to 1 content relationship and cannot be deleted",
    );
    expect(conflict.details).toEqual({
      blockingRelationshipCount: 1,
      truncated: false,
      blockingRelationships: [
        {
          id: "rel-1",
          relationType: "member_of",
          entityType: "faction",
          entityId: "faction-1",
          entityName: "The Silver Hand",
        },
      ],
    });
  });

  // The mirror case, and the one a guard written from the create path would get
  // wrong: findByEntity() returns rows from BOTH sides, so half the blockers of
  // any given entity have it stored as the target.
  it("names the counterpart when the deleted entity is the TARGET", async () => {
    const locator = new FakeContentEntityLocator().seed("character", "char-1", {
      projectId: PROJECT_ID,
      entityName: "Kael of Vael",
    });

    const conflict = await conflictFrom(
      [
        relationship(
          "rel-1",
          "member_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-1" },
        ),
      ],
      { entityType: "faction", entityId: "faction-1" },
      locator,
    );

    expect(conflict.details).toMatchObject({
      blockingRelationships: [
        {
          entityType: "character",
          entityId: "char-1",
          entityName: "Kael of Vael",
        },
      ],
    });
  });

  it("looks a repeated counterpart up once, and still lists both rows", async () => {
    const locator = new FakeContentEntityLocator().seed(
      "faction",
      "faction-1",
      { projectId: PROJECT_ID, entityName: "The Silver Hand" },
    );

    const conflict = await conflictFrom(
      [
        relationship(
          "rel-1",
          "member_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-1" },
        ),
        relationship(
          "rel-2",
          "ally_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-1" },
        ),
      ],
      { entityType: "character", entityId: "char-1" },
      locator,
    );

    expect(locator.lookups).toEqual(["faction:faction-1"]);
    expect(conflict.details).toMatchObject({
      blockingRelationshipCount: 2,
      blockingRelationships: [
        { id: "rel-1", entityName: "The Silver Hand" },
        { id: "rel-2", entityName: "The Silver Hand" },
      ],
    });
  });

  // Both branches of "no name": the row is gone, or it belongs to another
  // project. The second one must not answer with that project's name — the
  // 409 would then confirm another tenant's entity by name.
  it("reports a null name for an unresolvable or foreign counterpart", async () => {
    const locator = new FakeContentEntityLocator().seed(
      "faction",
      "faction-2",
      { projectId: "other-project", entityName: "Another Tenant's Faction" },
    );

    const conflict = await conflictFrom(
      [
        relationship(
          "rel-1",
          "member_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-1" },
        ),
        relationship(
          "rel-2",
          "member_of",
          { entityType: "character", entityId: "char-1" },
          { entityType: "faction", entityId: "faction-2" },
        ),
      ],
      { entityType: "character", entityId: "char-1" },
      locator,
    );

    expect(conflict.details).toMatchObject({
      blockingRelationships: [
        { id: "rel-1", entityName: null },
        { id: "rel-2", entityName: null },
      ],
    });
  });

  // A blocked delete is answered, never silently shortened: the count is the
  // true one and `truncated` says the list was cut. The bound is what keeps the
  // error path from firing one aggregate load per blocking row.
  it("caps the listed rows, reports the true count, and stops looking names up past the cap", async () => {
    const overLimit = BLOCKING_RELATIONSHIP_DETAIL_LIMIT + 5;
    const locator = new FakeContentEntityLocator();
    const rows = Array.from({ length: overLimit }, (_, index) => {
      const sceneId = `scene-${index + 1}`;
      locator.seed("scene", sceneId, {
        projectId: PROJECT_ID,
        entityName: `Scene ${index + 1}`,
      });

      return relationship(
        `rel-${index + 1}`,
        "appears_in",
        { entityType: "character", entityId: "char-1" },
        { entityType: "scene", entityId: sceneId },
      );
    });

    const conflict = await conflictFrom(
      rows,
      { entityType: "character", entityId: "char-1" },
      locator,
    );

    expect(conflict.message).toBe(
      `Character is still linked to ${overLimit} content relationships and cannot be deleted`,
    );
    expect(conflict.details).toMatchObject({
      blockingRelationshipCount: overLimit,
      truncated: true,
    });
    expect(
      (conflict.details as { blockingRelationships: unknown[] })
        .blockingRelationships,
    ).toHaveLength(BLOCKING_RELATIONSHIP_DETAIL_LIMIT);
    expect(locator.lookups).toHaveLength(BLOCKING_RELATIONSHIP_DETAIL_LIMIT);
  });

  it("answers CONFLICT, which the error handler maps to 409", async () => {
    const locator = new FakeContentEntityLocator();
    const repository = new FakeContentRelationshipRepository([
      relationship(
        "rel-1",
        "member_of",
        { entityType: "character", entityId: "char-1" },
        { entityType: "faction", entityId: "faction-1" },
      ),
    ]);

    try {
      await assertNoBlockingRelationships(repository, {
        projectId: PROJECT_ID,
        entityType: "character",
        entityId: "char-1",
      });
    } catch (error) {
      await expect(
        mapBlockedByRelationshipsError(error, {
          contentEntityLocator: locator,
          entityLabel: "Character",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

      return;
    }

    throw new Error("test fixture: the guard did not block");
  });
});
