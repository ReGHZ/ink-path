import { CharacterMapper } from "./CharacterMapper.js";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
  CharacterRepositoryReferencedError,
} from "../../domain/story/CharacterRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Character } from "../../domain/story/Character.js";
import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";

export type CharacterDatabase = Pick<PrismaClient, "character">;

export class PrismaCharacterRepository implements CharacterRepository {
  constructor(private readonly client: CharacterDatabase) {}

  async findById(id: string): Promise<Character | null> {
    const row = await this.client.character.findUnique({
      where: {
        id,
      },
    });

    return row ? CharacterMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<Character[]> {
    const rows = await this.client.character.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => CharacterMapper.toDomain(row));
  }

  async insert(character: Character): Promise<void> {
    try {
      await this.client.character.create({
        data: {
          id: character.id,
          ...CharacterMapper.toPersistence(character),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CharacterRepositoryConflictError();
      }

      // No parent-FK translation here, unlike Layer/WorldMap: Character has
      // no `parentId`/self-hierarchy, so the only FKs on this table are
      // `projectId`/`createdByUserId`/`currentRevisionId` — all of which the
      // calling Application Service is expected to have sourced from trusted,
      // already-validated context. A P2003 here means a bug upstream (stale
      // reference, broken ordering), not invalid raw user input, so it must
      // surface raw rather than be translated into a misleading domain error.
      throw error;
    }
  }

  async update(character: Character): Promise<void> {
    const result = await this.client.character.updateMany({
      where: {
        id: character.id,
        version: character.version,
      },
      data: CharacterMapper.toUpdatePersistence(character),
    });

    // No FK-violation catch here — see insert() for why: Character has no
    // parent-FK to translate, and a P2003 on any of its other FKs is a bug
    // upstream that must surface raw.
    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous: either the row is already gone, or it still
    // exists at a different version — same follow-up as Layer/WorldMap.
    const existing = await this.client.character.findUnique({
      where: { id: character.id },
      select: { id: true },
    });

    if (!existing) {
      throw new CharacterRepositoryNotFoundError();
    }

    throw new CharacterRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.character.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // Every P2003 on delete means the same thing: an inbound
      // `onDelete: Restrict` FK is blocking removal because a third row
      // still points at this character. Today that is
      // `comment_target_characters_character_id_fkey`
      // (`CommentTargetCharacter.character`, see
      // CharacterRepositoryError.ts) — there is no self-reference source the
      // way there is for Layer/WorldMap, but the translation is the same
      // generic catch-all, since delete-side P2003 is never ambiguous.
      if (isForeignKeyViolation(error)) {
        throw new CharacterRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.character.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new CharacterRepositoryNotFoundError();
    }

    throw new CharacterRepositoryConflictError();
  }
}

export function createCharacterRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): CharacterRepository {
  return new PrismaCharacterRepository(prisma);
}
