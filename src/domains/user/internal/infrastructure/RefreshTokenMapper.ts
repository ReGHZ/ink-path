import {
  RefreshToken,
  type RefreshTokenProperties,
} from "../domain/RefreshToken.js";

export function toRefreshTokenDomain(row: RefreshTokenProperties): RefreshToken {
  return RefreshToken.reconstitute(row);
}

export function toRefreshTokenPersistence(token: RefreshToken) {
  const s = token.toSnapshot();
  return {
    userId: s.userId,
    tokenHash: s.tokenHash,
    familyId: s.familyId,
    parentTokenId: s.parentTokenId,
    replacedByTokenId: s.replacedByTokenId,
    expiresAt: s.expiresAt,
    revokedAt: s.revokedAt,
    revokedReason: s.revokedReason,
    lastUsedAt: s.lastUsedAt,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
  };
}
