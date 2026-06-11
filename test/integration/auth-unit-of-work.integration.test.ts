import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaAuthUnitOfWork } from "../../src/domains/user/internal/infrastructure/PrismaAuthUnitOfWork.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-10T00:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000200";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const unitOfWork = new PrismaAuthUnitOfWork(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.refreshToken.deleteMany({
    where: {
      userId,
    },
  });
  await client.user.deleteMany({
    where: {
      id: userId,
    },
  });
}

function createUser(): User {
  return User.create({
    id: userId,
    email: "unit-of-work@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
}

describe("PrismaAuthUnitOfWork", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await prisma.$disconnect();
  });

  it("rolls back repository writes when the transaction fails", async () => {
    const user = createUser();
    const expectedError = new Error("force rollback");

    await expect(
      unitOfWork.transaction(async (repositories) => {
        await repositories.users.insert(user);
        throw expectedError;
      }),
    ).rejects.toBe(expectedError);

    await expect(users.findById(user.id)).resolves.toBeNull();
  });
});
