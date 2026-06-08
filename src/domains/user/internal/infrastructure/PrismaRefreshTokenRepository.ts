import {
  toRefreshTokenDomain,
  toRefreshTokenPersistence,
} from "./RefreshTokenMapper.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { RefreshToken } from "../domain/RefreshToken.js";
import type { RefreshTokenRepository } from "../domain/RefreshTokenRepository.js";

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) { }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    return row ? toRefreshTokenDomain(row) : null;
  }

  async findActiveByFamilyId(familyId: string): Promise<RefreshToken[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { familyId, revokedAt: null },
    });
    return rows.map((row) => toRefreshTokenDomain(row));
  }

  async findActiveByUserId(userId: string): Promise<RefreshToken[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null },
    });
    return rows.map((row) => toRefreshTokenDomain(row));
  }

  async insert(token: RefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: token.id,
        createdAt: token.createdAt,
        ...toRefreshTokenPersistence(token),
      },
    });
  }

  async update(token: RefreshToken): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: toRefreshTokenPersistence(token),
    });
  }
}

export function createRefreshTokenRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): RefreshTokenRepository {
  return new PrismaRefreshTokenRepository(prisma);
}
