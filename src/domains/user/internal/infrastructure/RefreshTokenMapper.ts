import {
  RefreshToken,
  type RefreshTokenProperties,
} from "../domain/RefreshToken.js";

import type {
  RefreshToken as PrismaRefreshToken,
  Prisma,
} from "../../../../generated/prisma/client.js";

export const RefreshTokenMapper = {
  toDomain(row: PrismaRefreshToken): RefreshToken {
    const props: RefreshTokenProperties = {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      familyId: row.familyId,
      parentTokenId: row.parentTokenId,
      replacedByTokenId: row.replacedByTokenId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revokedReason: row.revokedReason,
      lastUsedAt: row.lastUsedAt,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    };

    return RefreshToken.reconstitute(props);
  },

  toPersistence(token: RefreshToken): Prisma.RefreshTokenUncheckedCreateInput {
    const snapshot = token.toSnapshot();

    return {
      userId: snapshot.userId,
      tokenHash: snapshot.tokenHash,
      familyId: snapshot.familyId,
      parentTokenId: snapshot.parentTokenId,
      replacedByTokenId: snapshot.replacedByTokenId,
      expiresAt: snapshot.expiresAt,
      revokedAt: snapshot.revokedAt,
      revokedReason: snapshot.revokedReason,
      lastUsedAt: snapshot.lastUsedAt,
      userAgent: snapshot.userAgent,
      ipAddress: snapshot.ipAddress,
      createdAt: snapshot.createdAt,
    };
  },
};
