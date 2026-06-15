import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { UserProject } from "../../src/domains/project/internal/domain/UserProject.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { PrismaProjectUnitOfWork } from "../../src/domains/project/internal/infrastructure/PrismaProjectUnitOfWork.js";
import { PrismaUserProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaUserProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-15T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000400";
const projectId = "11111111-0000-4000-8000-000000000400";
const userProjectId = "22222222-0000-4000-8000-000000000400";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projectRepository = new PrismaProjectRepository(prisma);
const userProjectRepository = new PrismaUserProjectRepository(prisma);
const unitOfWork = new PrismaProjectUnitOfWork(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.userProject.deleteMany({ where: { id: userProjectId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwner(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "project-uow@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);
}

function buildProject(): Project {
  return Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "UoW Test Project",
    now,
  });
}

function buildUserProject(): UserProject {
  return UserProject.create({ id: userProjectId, projectId, userId: ownerUserId, now });
}

describe("PrismaProjectUnitOfWork", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwner();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await prisma.$disconnect();
  });

  it("rolls back all repository writes when the transaction fails", async () => {
    const project = buildProject();
    const membership = buildUserProject();
    const expectedError = new Error("force rollback");

    await expect(
      unitOfWork.transaction(async (repos) => {
        await repos.projects.insert(project);
        await repos.userProjects.insert(membership);
        throw expectedError;
      }),
    ).rejects.toBe(expectedError);

    await expect(projectRepository.findById(projectId)).resolves.toBeNull();
    await expect(
      userProjectRepository.findActiveByProjectIdAndUserId(projectId, ownerUserId),
    ).resolves.toBeNull();
  });

  it("commits both repository writes when the transaction succeeds", async () => {
    const project = buildProject();
    const membership = buildUserProject();

    await unitOfWork.transaction(async (repos) => {
      await repos.projects.insert(project);
      await repos.userProjects.insert(membership);
    });

    const persistedProject = await projectRepository.findById(projectId);
    const persistedMembership = await userProjectRepository.findActiveByProjectIdAndUserId(
      projectId,
      ownerUserId,
    );

    expect(persistedProject?.id).toBe(projectId);
    expect(persistedProject?.name).toBe("UoW Test Project");
    expect(persistedMembership?.id).toBe(userProjectId);
    expect(persistedMembership?.role).toBe("writer");
  });

  it("returns the value produced by the transaction callback", async () => {
    const project = buildProject();

    const result = await unitOfWork.transaction(async (repos) => {
      await repos.projects.insert(project);
      return { created: project.id };
    });

    expect(result).toEqual({ created: projectId });
  });
});
