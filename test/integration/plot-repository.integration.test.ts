import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Plot } from "../../src/domains/content/internal/domain/story/Plot.js";
import {
  PlotRepositoryConflictError,
  PlotRepositoryNotFoundError,
} from "../../src/domains/content/internal/domain/story/PlotRepositoryError.js";
import { PrismaPlotRepository } from "../../src/domains/content/internal/infrastructure/story/PrismaPlotRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-08-12T00:00:00.000Z");
const later = new Date("2026-08-12T01:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001201";
const projectId = "00000000-0000-4000-8000-000000001202";
const revisionId = "00000000-0000-4000-8000-000000001203";

const plotIds = [
  "62626262-0000-4000-8000-000000000001",
  "62626262-0000-4000-8000-000000000002",
];

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const repository = new PrismaPlotRepository(prisma);

async function cleanDatabase(client: PrismaClient): Promise<void> {
  await client.plot.deleteMany({ where: { id: { in: plotIds } } });
  await client.contentRevision.deleteMany({ where: { id: revisionId } });
  await client.project.deleteMany({ where: { id: projectId } });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerProjectAndRevision(): Promise<void> {
  const owner = User.create({
    id: ownerUserId,
    email: "plot-owner@example.com",
    username: null,
    passwordHash: "hashed-password",
    now,
  });
  await users.insert(owner);

  const project = Project.create({
    id: projectId,
    ownerUserId,
    createdByUserId: ownerUserId,
    name: "Nine Heavens Qi Chronicle",
    now,
  });
  await projects.insert(project);

  await prisma.contentRevision.create({
    data: {
      id: revisionId,
      projectId,
      entityType: "plot",
      entityId: plotIds[0],
      revisionNumber: 1,
      changedByUserId: ownerUserId,
      changeType: "create",
      afterSnapshot: {},
    },
  });
}

function createPlot(
  id: string,
  name: string,
  overrides: { content?: string | null; resolution?: string | null } = {},
): Plot {
  return Plot.create({
    id,
    projectId,
    createdByUserId: ownerUserId,
    name,
    theme: "the price of ascension",
    conflict: "the sect elders hoard the spirit vein",
    resolution: overrides.resolution ?? null,
    content: overrides.content ?? null,
    currentRevisionId: revisionId,
    now,
  });
}

async function insertPlot(plot: Plot): Promise<void> {
  await repository.insert(plot);
  await prisma.plot.update({
    where: { id: plot.id },
    data: { currentRevisionId: revisionId },
  });
}

describe("PrismaPlotRepository", () => {
  beforeEach(async () => {
    await cleanDatabase(prisma);
    await seedOwnerProjectAndRevision();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts and finds a plot by id", async () => {
    const plot = createPlot(plotIds[0], "The Severed Meridian Path");

    await insertPlot(plot);

    const found = await repository.findById(plot.id);

    expect(found?.id).toBe(plot.id);
    expect(found?.name).toBe("The Severed Meridian Path");
    expect(found?.theme).toBe("the price of ascension");
    expect(found?.conflict).toBe("the sect elders hoard the spirit vein");
    expect(found?.resolution).toBeNull();
    expect(found?.status).toBe("draft");
    expect(found?.currentRevisionId).toBe(revisionId);
  });

  it("returns null when plot is not found by id", async () => {
    expect(await repository.findById(plotIds[0])).toBeNull();
  });

  it("finds all plots by project id ordered by updatedAt descending", async () => {
    const first = createPlot(plotIds[0], "Rise of the Outer Disciple");
    const second = createPlot(plotIds[1], "War of the Two Pill Halls");

    await insertPlot(first);
    await insertPlot(second);

    const found = await repository.findByProjectId(projectId);

    expect(found).toHaveLength(2);
    expect(found[0].id).toBe(second.id);
    expect(found[1].id).toBe(first.id);
  });

  it("returns empty array when project has no plots", async () => {
    expect(await repository.findByProjectId(projectId)).toHaveLength(0);
  });

  it("persists detail updates through the mapper", async () => {
    const plot = createPlot(plotIds[0], "Untitled Arc");
    await insertPlot(plot);

    plot.updateDetails({
      name: "The Hollow Core Rebellion",
      description: "Disciples with ruptured cores seize the lower peaks.",
      theme: "scarcity as doctrine",
      conflict: "the qi tithe cannot be paid",
      resolution: "the tithe ledger is burned",
      content: "Full arc outline.",
      now: later,
    });
    await repository.update(plot);

    const persisted = await repository.findById(plot.id);

    expect(persisted?.name).toBe("The Hollow Core Rebellion");
    expect(persisted?.description).toBe(
      "Disciples with ruptured cores seize the lower peaks.",
    );
    expect(persisted?.theme).toBe("scarcity as doctrine");
    expect(persisted?.resolution).toBe("the tithe ledger is burned");
    expect(persisted?.content).toBe("Full arc outline.");
  });

  // The three-status entity: `active` needs content, `completed` needs content
  // AND resolution (Plot.ts validate()). Persisting both proves the mapper
  // carries every field those invariants depend on.
  it("persists the full draft -> active -> completed status path", async () => {
    const plot = createPlot(plotIds[0], "Ascension of the Ash Sect", {
      content: "Arc body.",
      resolution: "The sect burns its own records.",
    });
    await insertPlot(plot);

    plot.changeStatus("active", later);
    await repository.update(plot);
    expect((await repository.findById(plot.id))?.status).toBe("active");

    const loaded = await repository.findById(plot.id);
    if (!loaded) throw new Error("test fixture: plot missing");
    loaded.changeStatus("completed", later);
    await repository.update(loaded);

    const persisted = await repository.findById(plot.id);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.resolution).toBe("The sect burns its own records.");
  });

  it("starts a fresh plot at version 0 and increments on each update", async () => {
    const plot = createPlot(plotIds[0], "Fresh Arc");
    await insertPlot(plot);

    expect((await repository.findById(plot.id))?.version).toBe(0);

    const loaded = await repository.findById(plot.id);
    if (!loaded) throw new Error("test fixture: plot missing");
    loaded.updateDetails({ name: "Revised Arc", now: later });
    await repository.update(loaded);

    expect((await repository.findById(plot.id))?.version).toBe(1);
  });

  it("insert() alone persists a null current_revision_id, pending linkRevision", async () => {
    const plot = createPlot(plotIds[0], "Pending Arc");

    await repository.insert(plot);

    const row = await prisma.plot.findUniqueOrThrow({
      where: { id: plot.id },
      select: { currentRevisionId: true, version: true },
    });

    expect(row.currentRevisionId).toBeNull();
    expect(row.version).toBe(0);
  });

  it("linkRevision sets currentRevisionId without bumping version", async () => {
    const plot = createPlot(plotIds[0], "Newborn Arc");
    await repository.insert(plot);

    await repository.linkRevision(plot.id, revisionId, 0);

    const persisted = await repository.findById(plot.id);

    expect(persisted?.currentRevisionId).toBe(revisionId);
    expect(persisted?.version).toBe(0);
  });

  it("rejects linkRevision with a stale expectedVersion as a conflict", async () => {
    const plot = createPlot(plotIds[0], "Contested Arc");
    await repository.insert(plot);

    await expect(
      repository.linkRevision(plot.id, revisionId, 1),
    ).rejects.toBeInstanceOf(PlotRepositoryConflictError);
  });

  it("rejects linkRevision called again on an already-linked entity", async () => {
    const plot = createPlot(plotIds[0], "Already Linked Arc");
    await repository.insert(plot);
    await repository.linkRevision(plot.id, revisionId, 0);

    await expect(
      repository.linkRevision(plot.id, revisionId, 0),
    ).rejects.toBeInstanceOf(PlotRepositoryConflictError);
  });

  it("maps linkRevision on a missing target to a neutral not-found error", async () => {
    await expect(
      repository.linkRevision(plotIds[0], revisionId, 0),
    ).rejects.toBeInstanceOf(PlotRepositoryNotFoundError);
  });

  it("rejects update with a stale version as a conflict", async () => {
    const plot = createPlot(plotIds[0], "Contested Arc");
    await insertPlot(plot);

    const loaded = await repository.findById(plot.id);
    if (!loaded) throw new Error("test fixture: plot missing");
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    const current = await repository.findById(plot.id);
    if (!current) throw new Error("test fixture: plot missing");
    const staleAtOldVersion = Plot.reconstitute({
      ...current.toSnapshot(),
      version: 0,
    });
    staleAtOldVersion.updateDetails({ name: "Lost The Race", now: later });

    await expect(repository.update(staleAtOldVersion)).rejects.toBeInstanceOf(
      PlotRepositoryConflictError,
    );
  });

  it("deletes a plot", async () => {
    const plot = createPlot(plotIds[0], "Disposable Arc");
    await insertPlot(plot);

    await repository.delete(plot.id, plot.version);

    expect(await repository.findById(plot.id)).toBeNull();
  });

  it("rejects delete with a stale version as a conflict and leaves the row intact", async () => {
    const plot = createPlot(plotIds[0], "Guarded Arc");
    await insertPlot(plot);

    const loaded = await repository.findById(plot.id);
    if (!loaded) throw new Error("test fixture: plot missing");
    loaded.updateDetails({ name: "Won The Race", now: later });
    await repository.update(loaded);

    await expect(repository.delete(plot.id, 0)).rejects.toBeInstanceOf(
      PlotRepositoryConflictError,
    );

    expect(await repository.findById(plot.id)).not.toBeNull();
  });

  it("maps duplicate id insert to a neutral conflict error", async () => {
    const plot = createPlot(plotIds[0], "Original Arc");
    const duplicate = createPlot(plotIds[0], "Duplicate Arc");

    await insertPlot(plot);

    await expect(insertPlot(duplicate)).rejects.toBeInstanceOf(
      PlotRepositoryConflictError,
    );
  });

  it("maps missing update target to a neutral not-found error", async () => {
    const plot = createPlot(plotIds[0], "Ghost Arc");

    await expect(repository.update(plot)).rejects.toBeInstanceOf(
      PlotRepositoryNotFoundError,
    );
  });

  it("maps missing delete target to a neutral not-found error", async () => {
    await expect(repository.delete(plotIds[0], 0)).rejects.toBeInstanceOf(
      PlotRepositoryNotFoundError,
    );
  });
});
