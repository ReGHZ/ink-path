import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Project } from "../../src/domains/project/internal/domain/Project.js";
import {
  ProjectRepositoryConflictError,
  ProjectRepositoryNotFoundError,
} from "../../src/domains/project/internal/domain/ProjectRepositoryError.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-15T00:00:00.000Z");
const later = new Date("2026-06-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000301";

const projectIds = [
  "11111111-0000-4000-8000-000000000001",
  "11111111-0000-4000-8000-000000000002",
  "11111111-0000-4000-8000-000000000003",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const repository = new PrismaProjectRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.project.deleteMany({ where: { id: { in: projectIds } } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwner(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "project-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);
}

function createProject(id: string, name: string): Project {
  return Project.create({
    id,
    ownerUserId,
    createdByUserId: ownerUserId,
    name,
    now,
  });
}

describe("PrismaProjectRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwner();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a project by id", async () => {
    const project = createProject(projectIds[0], "My Novel");

    await repository.insert(project);

    const found = await repository.findById(project.id);

    expect(found?.id).toBe(project.id);
    expect(found?.name).toBe("My Novel");
    expect(found?.ownerUserId).toBe(ownerUserId);
    expect(found?.status).toBe("draft");
    expect(found?.visibility).toBe("private");
  });

  it("returns null when project is not found by id", async () => {
    const found = await repository.findById(projectIds[0]);

    expect(found).toBeNull();
  });

  it("finds all projects by owner user id ordered by updatedAt descending", async () => {
    const first = createProject(projectIds[0], "First Project");
    const second = createProject(projectIds[1], "Second Project");

    // Insert sequentially: second is inserted after first, so DB @updatedAt(second) > @updatedAt(first)
    await repository.insert(first);
    await repository.insert(second);

    const projects = await repository.findByOwnerUserId(ownerUserId);

    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe(second.id);
    expect(projects[1].id).toBe(first.id);
  });

  it("returns empty array when owner has no projects", async () => {
    const projects = await repository.findByOwnerUserId(ownerUserId);

    expect(projects).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const project = createProject(projectIds[0], "Draft Novel");

    await repository.insert(project);

    project.updateDetails({
      name: "Published Novel",
      description: "A great story",
      genre: "Fantasy",
      now: later,
    });

    await repository.update(project);

    const persisted = await repository.findById(project.id);

    expect(persisted?.name).toBe("Published Novel");
    expect(persisted?.description).toBe("A great story");
    expect(persisted?.genre).toBe("Fantasy");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists activate transition through the mapper", async () => {
    const project = createProject(projectIds[0], "Draft Novel");

    await repository.insert(project);

    project.activate(later);
    await repository.update(project);

    const persisted = await repository.findById(project.id);

    expect(persisted?.status).toBe("active");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("persists archive transition through the mapper", async () => {
    const project = createProject(projectIds[0], "Draft Novel");

    await repository.insert(project);

    project.archive(later);
    await repository.update(project);

    const persisted = await repository.findById(project.id);

    expect(persisted?.status).toBe("archived");
    expect(persisted?.archivedAt).toEqual(later);
  });

  it("maps duplicate id insert to a neutral persistence error", async () => {
    const project = createProject(projectIds[0], "My Novel");
    const duplicate = createProject(projectIds[0], "Duplicate");

    await repository.insert(project);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      ProjectRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral repository error", async () => {
    const project = createProject(projectIds[0], "Ghost Project");

    await expect(repository.update(project)).rejects.toBeInstanceOf(
      ProjectRepositoryNotFoundError,
    );
  });
});
