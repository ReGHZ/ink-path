import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import {
  Character,
  type CharacterStatus,
} from "../../domain/story/Character.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
  CharacterRepositoryReferencedError,
} from "../../domain/story/CharacterRepositoryError.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateCharacterInput = {
  requestingUserId: string;
  projectId: string;
  name: string;
  archetype?: string | null;
  background?: string | null;
  personality?: string | null;
  goal?: string | null;
  description?: string | null;
  content?: string | null;
};

export type CreateCharacterResult = {
  characterId: string;
};

export type CharacterDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  archetype: string | null;
  background: string | null;
  personality: string | null;
  goal: string | null;
  description: string | null;
  content: string | null;
  status: CharacterStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Plain, JSON-serializable mirror of CharacterProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(character: Character): Record<string, unknown> {
  const snapshot = character.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    name: snapshot.name,
    archetype: snapshot.archetype,
    background: snapshot.background,
    personality: snapshot.personality,
    goal: snapshot.goal,
    description: snapshot.description,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export type ChangeCharacterStatusInput = {
  requestingUserId: string;
  status: CharacterStatus;
};

export type UpdateCharacterInput = {
  requestingUserId: string;
  name?: string;
  archetype?: string | null;
  background?: string | null;
  personality?: string | null;
  goal?: string | null;
  description?: string | null;
  content?: string | null;
};

export type DeleteCharacterInput = {
  requestingUserId: string;
};

function mapCharacterError(error: unknown): never {
  if (error instanceof CharacterRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Character not found");
  }

  if (error instanceof CharacterRepositoryConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Character was modified concurrently",
    );
  }

  if (error instanceof CharacterRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Character is still referenced and cannot be deleted",
    );
  }

  // Generic catch, not a specific DomainErrorCode branch like ProjectService's
  // mapProjectError — every DomainError from Character.validate() (via
  // updateDetails()/changeStatus()) is a Flow 3 "400 Domain validation error"
  // by definition, regardless of which invariant it names. Without this,
  // errorHandler.ts only special-cases AppError, so a DomainError falls
  // through to a raw 500 — indistinguishable from a real bug to the caller.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class CharacterService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly characterRepository: CharacterRepository,
    private readonly characterUnitOfWork: ContentUnitOfWork<CharacterRepository>,
  ) { }

  async createCharacter(
    input: CreateCharacterInput,
  ): Promise<CreateCharacterResult> {
    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    const character = Character.create({
      id: this.idGenerator.generate(),
      projectId: input.projectId,
      createdByUserId: input.requestingUserId,
      name: input.name,
      archetype: input.archetype,
      background: input.background,
      personality: input.personality,
      goal: input.goal,
      description: input.description,
      content: input.content,
      // Pre-generated so the in-memory entity is domain-valid from the
      // start (policy 06 §4 currentRevisionId decision) — the physical row
      // is written without it first; see CharacterMapper.toCreatePersistence
      // and CharacterRepository.linkRevision for the DB-side half.
      currentRevisionId: revisionId,
      now,
    });

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "character",
      entityId: character.id,
      revisionNumber: character.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(character),
      now,
    });

    // No error mapping here, deliberately — same as ProjectService.createProject()
    // and WorldElementService.createWorldElement(). Every failure path in this
    // transaction (insert conflict, revision conflict, linkRevision NotFound/
    // Conflict) requires either a UUID collision or another writer touching a
    // row that cannot exist outside this transaction yet — not a normal,
    // user-facing condition, so it surfaces raw as a bug.
    await this.characterUnitOfWork.transaction(
      async (repositories, outboxEvents) => {
        await repositories.entity.insert(character);
        await repositories.contentRevisions.insert(revision);
        await repositories.entity.linkRevision(
          character.id,
          revisionId,
          character.version,
        );
        await outboxEvents.insert({
          id: this.idGenerator.generate(),
          eventType: "content.created",
          eventVersion: 1,
          aggregateType: "character",
          aggregateId: character.id,
          projectId: character.projectId,
          triggeredByUserId: input.requestingUserId,
          payload: {
            projectId: character.projectId,
            entityType: "character",
            entityId: character.id,
            revisionId,
            revisionNumber: character.version,
            changedByUserId: input.requestingUserId,
          },
          routingKey: "content.created",
          exchange: "saas.events",
        });
      },
    );

    return { characterId: character.id };
  }

  async getCharacterById(
    projectId: string,
    characterId: string,
  ): Promise<CharacterDetail> {
    const character = await this.loadExistingCharacter(projectId, characterId);

    return this.toCharacterDetail(character);
  }

  async listCharacterByProject(projectId: string): Promise<CharacterDetail[]> {
    const characters =
      await this.characterRepository.findByProjectId(projectId);

    return characters.map((character) => this.toCharacterDetail(character));
  }

  async changeCharacterStatus(
    projectId: string,
    characterId: string,
    input: ChangeCharacterStatusInput,
  ): Promise<CharacterDetail> {
    const character = await this.loadExistingCharacter(projectId, characterId);
    const oldVersion = character.version;
    const beforeSnapshot = toRevisionSnapshot(character);

    let changed: boolean;
    try {
      changed = character.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapCharacterError(error);
    }

    if (!changed) {
      return this.toCharacterDetail(character);
    }

    return this.persistChange(
      character,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }


  async updateCharacter(
    projectId: string,
    characterId: string,
    input: UpdateCharacterInput,
  ): Promise<CharacterDetail> {
    const character = await this.loadExistingCharacter(projectId, characterId);
    const oldVersion = character.version;
    const beforeSnapshot = toRevisionSnapshot(character);

    let changed: boolean;
    try {
      changed = character.updateDetails({
        name: input.name,
        archetype: input.archetype,
        background: input.background,
        personality: input.personality,
        goal: input.goal,
        description: input.description,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapCharacterError(error);
    }

    if (!changed) {
      return this.toCharacterDetail(character);
    }

    return this.persistChange(
      character,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteCharacter(
    projectId: string,
    characterId: string,
    input: DeleteCharacterInput,
  ): Promise<void> {
    const character = await this.loadExistingCharacter(projectId, characterId);
    const now = this.clock.now()

    // Constraint validation (Flow 3 Delete step 5 — active M:N relationship
    // check via ContentRelationship) is NOT done here, same gap as
    // WorldElementService.deleteWorldElement(): ContentRelationship has no
    // domain/repository yet in this codebase. The only guard currently
    // enforced is the DB-level FK check already inside repository.delete()
    // (comments still targeting this character -> CharacterRepositoryReferencedError).
    const revisionId = this.idGenerator.generate()
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "character",
      entityId: character.id,
      revisionNumber: character.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(character),
      now,
    })

    try {
      await this.characterUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "character",
            aggregateId: character.id,
            projectId: character.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: character.projectId,
              entityType: "character",
              entityId: character.id,
              revisionId,
              revisionNumber: character.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(
            character.id,
            character.version
          )
        },
      )
    } catch (error) {
      mapCharacterError(error)
    }
  }

  private async persistChange(
    character: Character,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<CharacterDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(character);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: character.projectId,
      entityType: "character",
      entityId: character.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: character.updatedAt,
    });

    const characterToPersist = Character.reconstitute({
      ...character.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.characterUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(characterToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "character",
            aggregateId: character.id,
            projectId: character.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: character.projectId,
              entityType: "character",
              entityId: character.id,
              revisionId,
              revisionNumber: oldVersion + 1,
              changedByUserId: requestingUserId,
            },
            routingKey: "content.updated",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapCharacterError(error);
    }

    return this.toCharacterDetail(characterToPersist);
  }

  private async loadExistingCharacter(
    projectId: string,
    characterId: string,
  ): Promise<Character> {
    const character = await this.characterRepository.findById(characterId);

    if (character?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Character not found");
    }

    return character;
  }

  private toCharacterDetail(character: Character): CharacterDetail {
    return {
      id: character.id,
      projectId: character.projectId,
      createdByUserId: character.createdByUserId,
      name: character.name,
      archetype: character.archetype,
      background: character.background,
      personality: character.personality,
      goal: character.goal,
      description: character.description,
      content: character.content,
      status: character.status,
      currentRevisionId: character.currentRevisionId,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    };
  }
}

export function createCharacterService({
  clock,
  idGenerator,
  characterRepository,
  characterUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  characterRepository: CharacterRepository;
  characterUnitOfWork: ContentUnitOfWork<CharacterRepository>;
}): CharacterService {
  return new CharacterService(
    clock,
    idGenerator,
    characterRepository,
    characterUnitOfWork,
  );
}
