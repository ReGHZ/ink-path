import { RefreshTokenMapper } from "./RefreshTokenMapper.js";
import {
  RefreshTokenRepositoryConflictError,
  RefreshTokenRepositoryNotFoundError,
} from "../domain/RefreshTokenRepositoryError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { RefreshToken } from "../domain/RefreshToken.js";
import type { RefreshTokenRepository } from "../domain/RefreshTokenRepository.js";

export type RefreshTokenDatabase = Pick<PrismaClient, "refreshToken">;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly client: RefreshTokenDatabase) {}

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.client.refreshToken.findUnique({
      where: { tokenHash },
    });
    return row ? RefreshTokenMapper.toDomain(row) : null;
  }

  async findActiveByFamilyId(
    familyId: string,
    now: Date,
  ): Promise<RefreshToken[]> {
    const rows = await this.client.refreshToken.findMany({
      where: {
        familyId,
        expiresAt: { gt: now },
        revokedAt: null,
        replacedByTokenId: null,
      },
    });

    return rows.map((row) => RefreshTokenMapper.toDomain(row));
  }

  async findActiveByUserId(userId: string, now: Date): Promise<RefreshToken[]> {
    const rows = await this.client.refreshToken.findMany({
      where: {
        userId,
        expiresAt: { gt: now },
        revokedAt: null,
        replacedByTokenId: null,
      },
    });

    return rows.map((row) => RefreshTokenMapper.toDomain(row));
  }

  async insert(token: RefreshToken): Promise<void> {
    try {
      await this.client.refreshToken.create({
        data: {
          id: token.id,
          ...RefreshTokenMapper.toPersistence(token),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RefreshTokenRepositoryConflictError();
      }

      throw error;
    }
  }

  async update(token: RefreshToken): Promise<void> {
    try {
      await this.client.refreshToken.update({
        where: {
          id: token.id,
        },
        data: RefreshTokenMapper.toPersistence(token),
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new RefreshTokenRepositoryNotFoundError();
      }

      throw error;
    }
  }
}

export function createRefreshTokenRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): RefreshTokenRepository {
  return new PrismaRefreshTokenRepository(prisma);
}
