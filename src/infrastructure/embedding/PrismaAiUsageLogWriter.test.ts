import { describe, expect, it, vi } from "vitest";

import { PrismaAiUsageLogWriter } from "./PrismaAiUsageLogWriter.js";

import type { PrismaClient } from "../../generated/prisma/client.js";

// Thin, mechanical Prisma field-mapping wrapper — no interesting concurrency/wire-protocol
// behavior worth a real database (unlike RabbitMQ/Qdrant elsewhere in this project). A
// hand-written stub asserting exact call arguments is enough to prove the mapping is right.
function createPrismaStub(createdId: string) {
  const create = vi.fn().mockResolvedValue({ id: createdId });
  const update = vi.fn().mockResolvedValue(undefined);

  return {
    prisma: { aiUsageLog: { create, update } } as unknown as PrismaClient,
    create,
    update,
  };
}

describe("PrismaAiUsageLogWriter.begin", () => {
  it("inserts a row with status in_progress, purpose/operationType embedding, and returns the new id", async () => {
    const { prisma, create } = createPrismaStub("log-1");
    const writer = new PrismaAiUsageLogWriter(prisma);
    const startedAt = new Date("2026-08-03T00:00:00.000Z");

    const id = await writer.begin({
      projectId: "project-1",
      triggeredByUserId: "user-1",
      provider: "local",
      model: "paraphrase-multilingual-mpnet-base-v2",
      contentRevisionId: "revision-1",
      contextEntityType: "layer",
      contextEntityId: "entity-1",
      startedAt,
    });

    expect(id).toBe("log-1");
    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        triggeredByUserId: "user-1",
        purpose: "embedding",
        provider: "local",
        model: "paraphrase-multilingual-mpnet-base-v2",
        operationType: "embedding",
        status: "in_progress",
        contentRevisionId: "revision-1",
        contextEntityType: "layer",
        contextEntityId: "entity-1",
        startedAt,
      },
      select: { id: true },
    });
  });
});

describe("PrismaAiUsageLogWriter.complete", () => {
  it("updates the row to success, without an errorMessage", async () => {
    const { prisma, update } = createPrismaStub("unused");
    const writer = new PrismaAiUsageLogWriter(prisma);
    const completedAt = new Date("2026-08-03T00:00:05.000Z");

    await writer.complete("log-1", {
      status: "success",
      completedAt,
      latencyMs: 5000,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: {
        status: "success",
        completedAt,
        latencyMs: 5000,
        errorMessage: null,
      },
    });
  });

  it("updates the row to failed, with the errorMessage attached", async () => {
    const { prisma, update } = createPrismaStub("unused");
    const writer = new PrismaAiUsageLogWriter(prisma);
    const completedAt = new Date("2026-08-03T00:00:05.000Z");

    await writer.complete("log-1", {
      status: "failed",
      completedAt,
      latencyMs: 1200,
      errorMessage: "provider unreachable",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: {
        status: "failed",
        completedAt,
        latencyMs: 1200,
        errorMessage: "provider unreachable",
      },
    });
  });
});
