import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ContentRevision,
  type CreateContentRevisionProperties,
} from "../../src/domains/content/internal/domain/support/ContentRevision.js";
import { ContentRevisionRepositoryConflictError } from "../../src/domains/content/internal/domain/support/ContentRevisionRepositoryError.js";
import { PrismaContentRevisionRepository } from "../../src/domains/content/internal/infrastructure/support/PrismaContentRevisionRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-07-18T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000000901";
const projectId = "00000000-0000-4000-8000-000000000902";
const otherProjectId = "00000000-0000-4000-8000-000000000903";

const entityIdA = "99999999-0000-4000-8000-000000000001";
const entityIdB = "99999999-0000-4000-8000-000000000002";

const revisionIds = [
  "88888888-0000-4000-8000-000000000001",
  "88888888-0000-4000-8000-000000000002",
  "88888888-0000-4000-8000-000000000003",
  "88888888-0000-4000-8000-000000000004",
  "88888888-0000-4000-8000-000000000005",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaContentRevisionRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.contentRevision.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerAndProjects(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "content-revision-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Content revision test project",
    now,
  });
  await projects.insert(project);

  const other = Project.create({
    id: otherProjectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Content revision other project",
    now,
  });
  await projects.insert(other);
}

type CreateVariant = Extract<CreateContentRevisionProperties, { changeType: "create" }>;
type UpdateVariant = Extract<CreateContentRevisionProperties, { changeType: "update" }>;
type DeleteVariant = Extract<CreateContentRevisionProperties, { changeType: "delete" }>;

function createCreateRevision(
  overrides: Partial<Omit<CreateVariant, "changeType">> = {},
): ContentRevision {
  return ContentRevision.create({
    id: revisionIds[0],
    projectId,
    entityType: "world_element",
    entityId: entityIdA,
    revisionNumber: 0,
    changedByUserId: ownerUserId,
    changeType: "create",
    afterSnapshot: { name: "Dragon Range" },
    now,
    ...overrides,
  });
}

function createUpdateRevision(
  overrides: Partial<Omit<UpdateVariant, "changeType">> = {},
): ContentRevision {
  return ContentRevision.create({
    id: revisionIds[1],
    projectId,
    entityType: "world_element",
    entityId: entityIdA,
    revisionNumber: 1,
    changedByUserId: ownerUserId,
    changeType: "update",
    beforeSnapshot: { name: "Dragon Range" },
    afterSnapshot: { name: "Dragon Range (renamed)" },
    now,
    ...overrides,
  });
}

function createDeleteRevision(
  overrides: Partial<Omit<DeleteVariant, "changeType">> = {},
): ContentRevision {
  return ContentRevision.create({
    id: revisionIds[2],
    projectId,
    entityType: "world_element",
    entityId: entityIdA,
    revisionNumber: 2,
    changedByUserId: ownerUserId,
    changeType: "delete",
    beforeSnapshot: { name: "Dragon Range (renamed)" },
    now,
    ...overrides,
  });
}

describe("PrismaContentRevisionRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerAndProjects();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a 'create' revision by id, snapshot round-tripping through the mapper", async () => {
    const revision = createCreateRevision();

    await repository.insert(revision);

    const found = await repository.findById(revision.id);

    expect(found?.id).toBe(revision.id);
    expect(found?.changeType).toBe("create");
    expect(found?.beforeSnapshot).toBeNull();
    expect(found?.afterSnapshot).toEqual({ name: "Dragon Range" });
  });

  it("inserts and finds an 'update' revision with both snapshots intact", async () => {
    const revision = createUpdateRevision();

    await repository.insert(revision);

    const found = await repository.findById(revision.id);

    expect(found?.changeType).toBe("update");
    expect(found?.beforeSnapshot).toEqual({ name: "Dragon Range" });
    expect(found?.afterSnapshot).toEqual({ name: "Dragon Range (renamed)" });
  });

  it("inserts and finds a 'delete' revision with a null after snapshot", async () => {
    const revision = createDeleteRevision();

    await repository.insert(revision);

    const found = await repository.findById(revision.id);

    expect(found?.changeType).toBe("delete");
    expect(found?.beforeSnapshot).toEqual({ name: "Dragon Range (renamed)" });
    expect(found?.afterSnapshot).toBeNull();
  });

  it("persists summary and reason, and null when not provided", async () => {
    const withText = createCreateRevision({
      summary: "Initial creation",
      reason: "Seeding world content",
    });
    const withoutText = createUpdateRevision();

    await repository.insert(withText);
    await repository.insert(withoutText);

    const foundWithText = await repository.findById(withText.id);
    const foundWithoutText = await repository.findById(withoutText.id);

    expect(foundWithText?.summary).toBe("Initial creation");
    expect(foundWithText?.reason).toBe("Seeding world content");
    expect(foundWithoutText?.summary).toBeNull();
    expect(foundWithoutText?.reason).toBeNull();
  });

  it("returns null when a revision is not found by id", async () => {
    const found = await repository.findById(revisionIds[0]);

    expect(found).toBeNull();
  });

  it("finds all revisions for an entity ordered by revisionNumber ascending", async () => {
    const createRevision = createCreateRevision();
    const updateRevision = createUpdateRevision();
    const deleteRevision = createDeleteRevision();

    // Inserted out of order to prove the repository orders by revisionNumber,
    // not by insertion/creation time.
    await repository.insert(deleteRevision);
    await repository.insert(createRevision);
    await repository.insert(updateRevision);

    const found = await repository.findByEntity(projectId, "world_element", entityIdA);

    expect(found.map((revision) => revision.revisionNumber)).toEqual([0, 1, 2]);
    expect(found.map((revision) => revision.changeType)).toEqual([
      "create",
      "update",
      "delete",
    ]);
  });

  it("returns an empty array when the entity has no revisions", async () => {
    const found = await repository.findByEntity(projectId, "world_element", entityIdA);

    expect(found).toHaveLength(0);
  });

  it("scopes findByEntity to the given entityId, excluding other entities in the same project", async () => {
    const forEntityA = createCreateRevision({ entityId: entityIdA });
    const forEntityB = createCreateRevision({
      id: revisionIds[3],
      entityId: entityIdB,
    });

    await repository.insert(forEntityA);
    await repository.insert(forEntityB);

    const found = await repository.findByEntity(projectId, "world_element", entityIdA);

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(forEntityA.id);
  });

  it("scopes findByEntity to the given projectId, excluding a same-entityId revision in a different project", async () => {
    const inProject = createCreateRevision();
    const inOtherProject = createCreateRevision({
      id: revisionIds[4],
      projectId: otherProjectId,
    });

    await repository.insert(inProject);
    await repository.insert(inOtherProject);

    const found = await repository.findByEntity(projectId, "world_element", entityIdA);

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(inProject.id);
  });

  it("maps a duplicate (projectId, entityType, entityId, revisionNumber) insert to a neutral conflict error", async () => {
    const first = createCreateRevision();
    // Same (projectId, entityType, entityId, revisionNumber) as `first`, only
    // the row id differs — this is the exact unique constraint from
    // `04-prisma-design/05_content-support.md`.
    const duplicate = createCreateRevision({ id: revisionIds[3] });

    await repository.insert(first);

    await expect(repository.insert(duplicate)).rejects.toBeInstanceOf(
      ContentRevisionRepositoryConflictError,
    );
  });
});
