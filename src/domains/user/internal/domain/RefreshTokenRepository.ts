import type { RefreshToken } from "./RefreshToken.js";

export type RefreshTokenRepository = {
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;

  findActiveByFamilyId(familyId: string): Promise<RefreshToken[]>;

  findActiveByUserId(userId: string): Promise<RefreshToken[]>;

  insert(token: RefreshToken): Promise<void>;

  update(token: RefreshToken): Promise<void>;
}
