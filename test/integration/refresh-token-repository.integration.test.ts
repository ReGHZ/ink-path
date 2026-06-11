import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { RefreshToken } from "../../src/domains/user/internal/domain/RefreshToken.js";
import {
  RefreshTokenRepositoryConflictError,
  RefreshTokenRepositoryNotFoundError,
} from "../../src/domains/user/internal/domain/RefreshTokenRepositoryError.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaRefreshTokenRepository } from "../../src/domains/user/internal/infrastructure/PrismaRefreshTokenRepository.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-10T00:00:00.000Z");
const later = new Date("2026-06-10T01:00:00.000Z");
const queryTime = new Date("2026-06-10T02:00:00.000Z");
const expiresAt = new Date("2026-06-17T00:00:00.000Z");
const expiredAtQueryTime = new Date("2026-06-10T01:30:00.000Z");

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const repository = new PrismaRefreshTokenRepository(prisma);
const userIds = [
  "00000000-0000-4000-8000-000000000100",
  "00000000-0000-4000-8000-000000000101",
];

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.refreshToken.deleteMany({
    where: {
      userId: { in: userIds },
    },
  });
  await client.user.deleteMany({
    where: {
      id: { in: userIds },
    },
  });
}

async function seedUser(id = "00000000-0000-4000-8000-000000000100") {
  const user = User.create({
    id,
    email: `${id}@example.com`,
    username: null,
    passwordHash: "hashed-password",
    now,
  });

  await users.insert(user);

  return user;
}

function createRefreshToken(input: {
  id: string;
  userId: string;
  tokenHash: string;
  familyId?: string;
  parentTokenId?: string | null;
  expiresAt?: Date;
}): RefreshToken {
  return RefreshToken.create({
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    familyId: input.familyId ?? "10000000-0000-4000-8000-000000000001",
    parentTokenId: input.parentTokenId,
    expiresAt: input.expiresAt ?? expiresAt,
    userAgent: "Vitest",
    ipAddress: "127.0.0.1",
    now,
  });
}

describe("PrismaRefreshTokenRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a refresh token by token hash", async () => {
    const user = await seedUser();
    const token = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000001",
      userId: user.id,
      tokenHash: "hash-1",
    });

    await repository.insert(token);

    const persistedToken = await repository.findByTokenHash(token.tokenHash);

    expect(persistedToken?.id).toBe(token.id);
    expect(persistedToken?.userId).toBe(user.id);
    expect(persistedToken?.familyId).toBe(token.familyId);
    expect(persistedToken?.createdAt).toEqual(now);
    expect(persistedToken?.userAgent).toBe("Vitest");
    expect(persistedToken?.ipAddress).toBe("127.0.0.1");
  });

  it("finds only usable active tokens by family id", async () => {
    const user = await seedUser();
    const familyId = "10000000-0000-4000-8000-000000000002";
    const activeToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000002",
      userId: user.id,
      tokenHash: "hash-active",
      familyId,
    });
    const expiredToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000003",
      userId: user.id,
      tokenHash: "hash-expired",
      familyId,
      expiresAt: expiredAtQueryTime,
    });
    const revokedToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000004",
      userId: user.id,
      tokenHash: "hash-revoked",
      familyId,
    });
    const replacedToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000005",
      userId: user.id,
      tokenHash: "hash-replaced",
      familyId,
    });
    const replacementToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000006",
      userId: user.id,
      tokenHash: "hash-replacement",
      familyId,
      parentTokenId: replacedToken.id,
    });

    revokedToken.revoke("logout", later);

    await repository.insert(activeToken);
    await repository.insert(expiredToken);
    await repository.insert(revokedToken);
    await repository.insert(replacedToken);
    await repository.insert(replacementToken);

    replacedToken.rotateTo(replacementToken.id, later);
    await repository.update(replacedToken);

    const activeTokens = await repository.findActiveByFamilyId(
      familyId,
      queryTime,
    );

    expect(activeTokens.map((token) => token.id).sort()).toEqual([
      activeToken.id,
      replacementToken.id,
    ]);
  });

  it("finds only usable active tokens by user id", async () => {
    const user = await seedUser();
    const otherUser = await seedUser("00000000-0000-4000-8000-000000000101");
    const activeToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000007",
      userId: user.id,
      tokenHash: "hash-user-active",
    });
    const expiredToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000008",
      userId: user.id,
      tokenHash: "hash-user-expired",
      expiresAt: expiredAtQueryTime,
    });
    const revokedToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000014",
      userId: user.id,
      tokenHash: "hash-user-revoked",
    });
    const replacedToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000015",
      userId: user.id,
      tokenHash: "hash-user-replaced",
    });
    const replacementToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000016",
      userId: user.id,
      tokenHash: "hash-user-replacement",
      parentTokenId: replacedToken.id,
    });
    const otherUserToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000009",
      userId: otherUser.id,
      tokenHash: "hash-other-user",
    });

    revokedToken.revoke("logout", later);

    await repository.insert(activeToken);
    await repository.insert(expiredToken);
    await repository.insert(revokedToken);
    await repository.insert(replacedToken);
    await repository.insert(replacementToken);
    await repository.insert(otherUserToken);

    replacedToken.rotateTo(replacementToken.id, later);
    await repository.update(replacedToken);

    const activeTokens = await repository.findActiveByUserId(user.id, queryTime);

    expect(activeTokens.map((token) => token.id).sort()).toEqual([
      activeToken.id,
      replacementToken.id,
    ]);
  });

  it("persists lifecycle updates through the mapper", async () => {
    const user = await seedUser();
    const token = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000010",
      userId: user.id,
      tokenHash: "hash-used",
    });

    await repository.insert(token);

    token.markUsed(later);
    await repository.update(token);

    const persistedToken = await repository.findByTokenHash(token.tokenHash);

    expect(persistedToken?.lastUsedAt).toEqual(later);
    expect(persistedToken?.createdAt).toEqual(now);
    expect(persistedToken?.tokenHash).toBe("hash-used");
  });

  it("maps unique constraint race conflicts to a neutral persistence error", async () => {
    const user = await seedUser();
    const firstToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000011",
      userId: user.id,
      tokenHash: "hash-duplicate",
    });
    const duplicateHashToken = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000012",
      userId: user.id,
      tokenHash: "hash-duplicate",
    });

    await repository.insert(firstToken);

    await expect(repository.insert(duplicateHashToken)).rejects.toBeInstanceOf(
      RefreshTokenRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral repository error", async () => {
    const user = await seedUser();
    const token = createRefreshToken({
      id: "20000000-0000-4000-8000-000000000013",
      userId: user.id,
      tokenHash: "hash-missing-update",
    });

    await expect(repository.update(token)).rejects.toBeInstanceOf(
      RefreshTokenRepositoryNotFoundError,
    );
  });
});
