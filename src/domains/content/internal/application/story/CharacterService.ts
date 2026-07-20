import { Character } from "../../domain/story/Character.js";
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

export class CharacterService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly characterUnitOfWork: ContentUnitOfWork<CharacterRepository>,
  ) {}

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
    await this.characterUnitOfWork.transaction(async (repositories) => {
      await repositories.entity.insert(character);
      await repositories.contentRevisions.insert(revision);
      await repositories.entity.linkRevision(
        character.id,
        revisionId,
        character.version,
      );
    });

    return { characterId: character.id };
  }
}

export function createCharacterService({
  clock,
  idGenerator,
  characterUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  characterUnitOfWork: ContentUnitOfWork<CharacterRepository>;
}): CharacterService {
  return new CharacterService(clock, idGenerator, characterUnitOfWork);
}
