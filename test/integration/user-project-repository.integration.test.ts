import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { UserProject } from "../../src/domains/project/internal/domain/UserProject.js";
import {
  UserProjectRepositoryConflictError,
  UserProjectRepositoryNotFoundError,
} from "../../src/domains/project/internal/domain/UserProjectRepositoryError.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { PrismaUserProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaUserProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-06-15T00:00:00.000Z");
const later = new Date("2026-06-15T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000310";
const secondUserId = "00000000-0000-4000-8000-000000000311";
const projectId = "11111111-0000-4000-8000-000000000010";

const userProjectIds = [
  "22222222-0000-4000-8000-000000000001",
  "22222222-0000-4000-8000-000000000002",
  "22222222-0000-4000-8000-000000000003",
  "22222222-0000-4000-8000-000000000004",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaUserProjectRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.userProject.deleteMany({ where: { id: { in: userProjectIds } } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: { in: [ownerUserId, secondUserId] } } });
}

async function seedFixtures(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "up-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  const second = User.create({
    id: secondUserId,
    email: "up-member@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Test Project",
    now,
  });

  await users.insert(owner);
  await users.insert(second);
  await projects.insert(project);
}

function createMembership(id: string, userId = ownerUserId): UserProject {
  return UserProject.create({ id, projectId, userId, now });
}

function createRemovedMembership(id: string, userId: string): UserProject {
  return UserProject.reconstitute({
    id,
    projectId,
    userId,
    role: "writer",
    canDelete: false,
    aiAccess: "none",
    status: "removed",
    joinedAt: now,
    removedAt: later,
    invitedByUserId: null,
    createdAt: now,
    updatedAt: later,
  });
}

describe("PrismaUserProjectRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedFixtures();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds an active membership by projectId and userId", async () => {
    const membership = createMembership(userProjectIds[0]);

    await repository.insert(membership);

    const found = await repository.findActiveByProjectIdAndUserId(projectId, ownerUserId);

    expect(found?.id).toBe(membership.id);
    expect(found?.projectId).toBe(projectId);
    expect(found?.userId).toBe(ownerUserId);
    expect(found?.role).toBe("writer");
    expect(found?.canDelete).toBe(true);
    expect(found?.aiAccess).toBe("full");
    expect(found?.status).toBe("active");
    expect(found?.joinedAt).toEqual(now);
  });

  it("returns null when no membership record exists", async () => {
    const found = await repository.findActiveByProjectIdAndUserId(projectId, ownerUserId);

    expect(found).toBeNull();
  });

  it("returns null when membership exists but is not active", async () => {
    const removed = createRemovedMembership(userProjectIds[0], ownerUserId);

    await repository.insert(removed);

    const found = await repository.findActiveByProjectIdAndUserId(projectId, ownerUserId);

    expect(found).toBeNull();
  });

  it("finds all active memberships by projectId ordered by joinedAt ascending", async () => {
    const ownerMembership = createMembership(userProjectIds[0], ownerUserId);
    // second member joins as editor to avoid the unique_active_writer partial index
    const memberMembership = UserProject.create({
      id: userProjectIds[1],
      projectId,
      userId: secondUserId,
      now: later,
    });
    memberMembership.changeRole("editor", later);

    await repository.insert(ownerMembership);
    await repository.insert(memberMembership);

    const memberships = await repository.findActiveByProjectId(projectId);

    expect(memberships).toHaveLength(2);
    expect(memberships[0].id).toBe(ownerMembership.id);
    expect(memberships[1].id).toBe(memberMembership.id);
  });

  it("excludes non-active memberships from findActiveByProjectId", async () => {
    const active = createMembership(userProjectIds[0], ownerUserId);
    const removed = createRemovedMembership(userProjectIds[1], secondUserId);

    await repository.insert(active);
    await repository.insert(removed);

    const memberships = await repository.findActiveByProjectId(projectId);

    expect(memberships).toHaveLength(1);
    expect(memberships[0].id).toBe(active.id);
  });

  it("returns empty array when project has no active memberships", async () => {
    const memberships = await repository.findActiveByProjectId(projectId);

    expect(memberships).toHaveLength(0);
  });

  it("persists role change through the mapper", async () => {
    const membership = createMembership(userProjectIds[0]);

    await repository.insert(membership);

    membership.changeRole("editor", later);
    await repository.update(membership);

    const persisted = await repository.findActiveByProjectIdAndUserId(projectId, ownerUserId);

    expect(persisted?.role).toBe("editor");
    expect(persisted?.updatedAt).toEqual(expect.any(Date));
  });

  it("maps duplicate id insert to a neutral persistence error", async () => {
    const membership = createMembership(userProjectIds[0]);
    const duplicate = createMembership(userProjectIds[0]);

    await repository.insert(membership);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      UserProjectRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral repository error", async () => {
    const membership = createMembership(userProjectIds[0]);

    await expect(repository.update(membership)).rejects.toBeInstanceOf(
      UserProjectRepositoryNotFoundError,
    );
  });
});
