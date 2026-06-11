import type { RefreshToken } from "./RefreshToken.js";

export type RefreshTokenRepository = {
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;

  findActiveByFamilyId(familyId: string, now: Date): Promise<RefreshToken[]>;

  findActiveByUserId(userId: string, now: Date): Promise<RefreshToken[]>;

  insert(token: RefreshToken): Promise<void>;

  update(token: RefreshToken): Promise<void>;
};
