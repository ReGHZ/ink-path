import { describe, expect, it } from "vitest";

import { CharacterService } from "./CharacterService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Character } from "../../domain/story/Character.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
} from "../../domain/story/CharacterRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";
import type { ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { ContentRepositories, ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-07-21T00:00:00.000Z");

class FakeCharacterRepository implements CharacterRepository {
  readonly characters = new Map<string, Character>();

  findById(id: string): Promise<Character | null> {
    return Promise.resolve(this.characters.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Character[]> {
    return Promise.resolve(
      [...this.characters.values()].filter((c) => c.projectId === projectId),
    );
  }

  insert(character: Character): Promise<void> {
    if (this.characters.has(character.id)) {
      return Promise.reject(new CharacterRepositoryConflictError());
    }
    this.characters.set(character.id, character);
    return Promise.resolve();
  }

  update(character: Character): Promise<void> {
    // Mirrors PrismaCharacterRepository.update()'s `version: {increment: 1}`
    // — the passed-in entity is NOT refreshed with the new version, same
    // caveat as the real repository, so bump it here on the stored copy.
    const bumped = Character.reconstitute({
      ...character.toSnapshot(),
      version: character.version + 1,
    });
    this.characters.set(character.id, bumped);
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    const existing = this.characters.get(id);

    if (!existing) {
      return Promise.reject(new CharacterRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new CharacterRepositoryConflictError());
    }

    this.characters.delete(id);
    return Promise.resolve();
  }

  // Same reasoning as FakeWorldElementRepository.linkRevision(): the domain
  // invariant (currentRevisionId always non-empty on a constructed
  // Character) means the transient "physical null" row PrismaCharacterRepository
  // briefly writes has no representation as a Character instance at all —
  // this in-memory fake only needs to satisfy the interface.
  linkRevision(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeContentRevisionRepository implements ContentRevisionRepository {
  readonly revisions = new Map<string, ContentRevision>();

  findById(id: string): Promise<ContentRevision | null> {
    return Promise.resolve(this.revisions.get(id) ?? null);
  }

  findByEntity(): Promise<ContentRevision[]> {
    return Promise.resolve([...this.revisions.values()]);
  }

  insert(contentRevision: ContentRevision): Promise<void> {
    this.revisions.set(contentRevision.id, contentRevision);
    return Promise.resolve();
  }
}

class FakeOutboxEventRepository implements OutboxEventRepository {
  readonly events: OutboxEvent[] = [];

  insert(event: OutboxEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class FakeContentUnitOfWork implements ContentUnitOfWork<CharacterRepository> {
  constructor(
    private readonly entity: CharacterRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<CharacterRepository>,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return work(
      { entity: this.entity, contentRevisions: this.contentRevisions },
      this.outboxEvents,
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

function createService() {
  const characters = new FakeCharacterRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const idGenerator = new FakeIdGenerator();
  const uow = new FakeContentUnitOfWork(characters, contentRevisions, outboxEvents);

  return {
    characters,
    contentRevisions,
    outboxEvents,
    service: new CharacterService(clock, idGenerator, characters, uow),
  };
}

async function seedCharacter(
  characters: FakeCharacterRepository,
  overrides: Partial<{
    name: string;
    archetype: string | null;
    background: string | null;
    personality: string | null;
    description: string | null;
  }> = {},
): Promise<Character> {
  const character = Character.create({
    id: "char-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: overrides.name ?? "Draft Character",
    archetype: overrides.archetype ?? null,
    background: overrides.background ?? null,
    personality: overrides.personality ?? null,
    description: overrides.description ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await characters.insert(character);
  return character;
}

describe("CharacterService", () => {
  describe("createCharacter", () => {
    it("creates the entity and its create revision atomically, returns characterId", async () => {
      const { characters, contentRevisions, service } = createService();

      const result = await service.createCharacter({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Kael of Vael",
      });

      expect(result.characterId).toBeDefined();
      expect(characters.characters.size).toBe(1);
      expect(contentRevisions.revisions.size).toBe(1);
    });

    it("links the created entity to its own create revision, at version 0", async () => {
      const { characters, service } = createService();

      const result = await service.createCharacter({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Kael of Vael",
      });

      const persisted = characters.characters.get(result.characterId);

      expect(persisted?.version).toBe(0);
      expect(persisted?.currentRevisionId).toBeTruthy();
    });

    it("records the create revision with revisionNumber 0 and an after snapshot", async () => {
      const { contentRevisions, service } = createService();

      await service.createCharacter({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Kael of Vael",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("create");
      expect(revision.revisionNumber).toBe(0);
      expect(revision.afterSnapshot).not.toBeNull();
      expect(revision.beforeSnapshot).toBeNull();
    });

    it("publishes a content.created outbox event with a correctly-keyed payload", async () => {
      const { outboxEvents, service } = createService();

      const result = await service.createCharacter({
        requestingUserId: "user-1",
        projectId: "proj-1",
        name: "Kael of Vael",
      });

      expect(outboxEvents.events).toHaveLength(1);
      const event = outboxEvents.events[0];
      expect(event?.eventType).toBe("content.created");
      expect(event?.aggregateType).toBe("character");
      expect(event?.aggregateId).toBe(result.characterId);
      expect(event?.routingKey).toBe("content.created");
      expect(event?.exchange).toBe("saas.events");
      expect(event?.payload).toMatchObject({ projectId: "proj-1" });
    });
  });

  describe("getCharacterById", () => {
    it("returns CharacterDetail with all fields correctly mapped", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters, {
        name: "Kael of Vael",
        background: "A wandering scholar",
      });

      const detail = await service.getCharacterById("proj-1", "char-1");

      expect(detail).toEqual({
        id: "char-1",
        projectId: "proj-1",
        createdByUserId: "user-1",
        name: "Kael of Vael",
        archetype: null,
        background: "A wandering scholar",
        personality: null,
        goal: null,
        description: null,
        content: null,
        status: "draft",
        currentRevisionId: "rev-0",
        createdAt: now,
        updatedAt: now,
      });
    });

    it("does not leak entity internals", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      const detail = await service.getCharacterById("proj-1", "char-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the character does not exist", async () => {
      const { service } = createService();

      await expect(
        service.getCharacterById("proj-1", "missing"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the character belongs to a different project", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await expect(
        service.getCharacterById("proj-2", "char-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("listCharacterByProject", () => {
    it("returns only characters belonging to the given project", async () => {
      const { characters, service } = createService();

      await characters.insert(
        Character.create({
          id: "char-1",
          projectId: "proj-1",
          createdByUserId: "user-1",
          name: "In Project 1",
          currentRevisionId: "rev-1",
          now,
        }),
      );
      await characters.insert(
        Character.create({
          id: "char-2",
          projectId: "proj-2",
          createdByUserId: "user-1",
          name: "In Project 2",
          currentRevisionId: "rev-2",
          now,
        }),
      );

      const found = await service.listCharacterByProject("proj-1");

      expect(found).toHaveLength(1);
      expect(found[0]?.id).toBe("char-1");
    });

    it("returns an empty array when the project has no characters", async () => {
      const { service } = createService();

      const found = await service.listCharacterByProject("proj-1");

      expect(found).toHaveLength(0);
    });
  });

  describe("updateCharacter", () => {
    it("updates fields and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      const detail = await service.updateCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
        name: "Revised Character",
        background: "Updated background",
      });

      expect(detail.name).toBe("Revised Character");
      expect(detail.background).toBe("Updated background");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the update, including the new currentRevisionId and bumped version", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      const detail = await service.updateCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
        name: "Revised Character",
      });

      const persisted = characters.characters.get("char-1");
      expect(persisted?.name).toBe("Revised Character");
      expect(persisted?.currentRevisionId).toBe(detail.currentRevisionId);
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision with before/after snapshots and revisionNumber = oldVersion + 1", async () => {
      const { characters, contentRevisions, service } = createService();
      await seedCharacter(characters);

      await service.updateCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
        name: "Revised Character",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Draft Character" });
      expect(revision.afterSnapshot).toMatchObject({ name: "Revised Character" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { characters, outboxEvents, service } = createService();
      await seedCharacter(characters);

      await service.updateCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
        name: "Revised Character",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the update is a no-op", async () => {
      const { characters, contentRevisions, outboxEvents, service } = createService();
      await seedCharacter(characters);

      await service.updateCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
        name: "Draft Character",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(characters.characters.get("char-1")?.currentRevisionId).toBe("rev-0");
    });

    it("throws NOT_FOUND when the character does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateCharacter("proj-1", "missing", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the character belongs to a different project", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await expect(
        service.updateCharacter("proj-2", "char-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when the new name is blank", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await expect(
        service.updateCharacter("proj-1", "char-1", {
          requestingUserId: "user-1",
          name: "   ",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Character name is required",
      });
    });

    it("maps a repository conflict to CONFLICT", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);
      characters.update = (): Promise<void> =>
        Promise.reject(new CharacterRepositoryConflictError());

      await expect(
        service.updateCharacter("proj-1", "char-1", {
          requestingUserId: "user-1",
          name: "New Name",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe("changeCharacterStatus", () => {
    it("changes status and returns the updated detail, with a fresh currentRevisionId", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters, {
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      const detail = await service.changeCharacterStatus("proj-1", "char-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      expect(detail.status).toBe("active");
      expect(detail.currentRevisionId).not.toBe("rev-0");
    });

    it("persists the status change, including the bumped version", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters, {
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      await service.changeCharacterStatus("proj-1", "char-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      const persisted = characters.characters.get("char-1");
      expect(persisted?.status).toBe("active");
      expect(persisted?.version).toBe(1);
    });

    it("records an update revision for the status change, not a separate changeType", async () => {
      const { characters, contentRevisions, service } = createService();
      await seedCharacter(characters, {
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      await service.changeCharacterStatus("proj-1", "char-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("update");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ status: "draft" });
      expect(revision.afterSnapshot).toMatchObject({ status: "active" });
    });

    it("publishes a content.updated outbox event", async () => {
      const { characters, outboxEvents, service } = createService();
      await seedCharacter(characters, {
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      await service.changeCharacterStatus("proj-1", "char-1", {
        requestingUserId: "user-1",
        status: "active",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.updated");
    });

    it("writes nothing when the status is unchanged", async () => {
      const { characters, contentRevisions, outboxEvents, service } = createService();
      await seedCharacter(characters);

      await service.changeCharacterStatus("proj-1", "char-1", {
        requestingUserId: "user-1",
        status: "draft",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
      expect(characters.characters.get("char-1")?.currentRevisionId).toBe("rev-0");
    });

    it("maps the domain invariant violation to VALIDATION_ERROR when activating without required fields", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await expect(
        service.changeCharacterStatus("proj-1", "char-1", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "Active character must have archetype",
      });
    });

    it("throws NOT_FOUND when the character does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeCharacterStatus("proj-1", "missing", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the character belongs to a different project", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters, {
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      await expect(
        service.changeCharacterStatus("proj-2", "char-1", {
          requestingUserId: "user-1",
          status: "active",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("deleteCharacter", () => {
    it("deletes the entity", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await service.deleteCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
      });

      expect(characters.characters.has("char-1")).toBe(false);
    });

    it("records a delete revision with a before snapshot and revisionNumber = version + 1", async () => {
      const { characters, contentRevisions, service } = createService();
      await seedCharacter(characters, { name: "Disposable Character" });

      await service.deleteCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
      });

      const revision = [...contentRevisions.revisions.values()][0];
      if (!revision) throw new Error("test fixture: revision missing");

      expect(revision.changeType).toBe("delete");
      expect(revision.revisionNumber).toBe(1);
      expect(revision.beforeSnapshot).toMatchObject({ name: "Disposable Character" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("publishes a content.deleted outbox event", async () => {
      const { characters, outboxEvents, service } = createService();
      await seedCharacter(characters);

      await service.deleteCharacter("proj-1", "char-1", {
        requestingUserId: "user-1",
      });

      expect(outboxEvents.events).toHaveLength(1);
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("throws NOT_FOUND when the character does not exist", async () => {
      const { service } = createService();

      await expect(
        service.deleteCharacter("proj-1", "missing", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws NOT_FOUND when the character belongs to a different project", async () => {
      const { characters, service } = createService();
      await seedCharacter(characters);

      await expect(
        service.deleteCharacter("proj-2", "char-1", {
          requestingUserId: "user-1",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });
});
