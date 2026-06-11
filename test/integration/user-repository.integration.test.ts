import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { User } from "../../src/domains/user/internal/domain/User.js";
import {
  UserRepositoryConflictError,
  UserRepositoryNotFoundError,
} from "../../src/domains/user/internal/domain/UserRepositoryError.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-10T00:00:00.000Z");
const later = new Date("2026-06-10T01:00:00.000Z");

const prisma = createPrismaClient();
const repository = new PrismaUserRepository(prisma);
const userIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
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

function createUser(id: string, email: string, username?: string | null): User {
  return User.create({
    id,
    email,
    username,
    passwordHash: "hashed-password",
    displayName: "Writer",
    now,
  });
}

describe("PrismaUserRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a user by id, email, and username", async () => {
    const user = createUser(
      "00000000-0000-4000-8000-000000000001",
      "Writer@Example.COM",
      "writer",
    );

    await repository.insert(user);

    const byId = await repository.findById(user.id);
    const byEmail = await repository.findByEmail("writer@example.com");
    const byUsername = await repository.findByUsername("writer");

    expect(byId?.id).toBe(user.id);
    expect(byId?.email).toBe("writer@example.com");
    expect(byId?.displayName).toBe("Writer");
    expect(byEmail?.id).toBe(user.id);
    expect(byUsername?.id).toBe(user.id);
  });

  it("persists profile updates through the mapper", async () => {
    const user = createUser(
      "00000000-0000-4000-8000-000000000002",
      "writer@example.com",
    );

    await repository.insert(user);

    user.changeProfile({
      avatarUrl: "https://example.com/avatar.png",
      displayName: "Updated Writer",
      now: later,
    });

    await repository.update(user);

    const persistedUser = await repository.findById(user.id);

    expect(persistedUser?.displayName).toBe("Updated Writer");
    expect(persistedUser?.avatarUrl).toBe("https://example.com/avatar.png");
    expect(persistedUser?.updatedAt).toEqual(expect.any(Date));
  });

  it("maps unique constraint race conflicts to a neutral persistence error", async () => {
    const firstUser = createUser(
      "00000000-0000-4000-8000-000000000003",
      "writer@example.com",
    );
    const duplicateEmailUser = createUser(
      "00000000-0000-4000-8000-000000000004",
      "WRITER@example.com",
    );

    await repository.insert(firstUser);

    await expect(repository.insert(duplicateEmailUser)).rejects.toBeInstanceOf(
      UserRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral repository error", async () => {
    const user = createUser(
      "00000000-0000-4000-8000-000000000005",
      "writer@example.com",
    );

    await expect(repository.update(user)).rejects.toBeInstanceOf(
      UserRepositoryNotFoundError,
    );
  });
});
