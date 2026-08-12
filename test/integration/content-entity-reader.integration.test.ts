import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ContentEntityReader } from "../../src/shared/application/ports/ContentEntityReader.js";

// Wiring test, not a behavior test — ContentEntityReader.test.ts (co-located
// with the implementation) already covers field mapping/classification via
// hand-written stubs. What this proves instead: `contentEntityReader`
// actually resolves from the real DI container (registerContentDomain's
// Dependencies parameter names genuinely match ContentDomainCradle's keys —
// nothing type-checks that correspondence today, only this resolving
// correctly at runtime does) and reaches a real Postgres for all 5 entity
// types without a wiring error. Same convention as every other port in this
// project (Qdrant, embedding provider, DLX) — a stub-based unit test proves
// logic, an integration test proves wiring; neither substitutes the other.
let prisma: PrismaClient;
let contentEntityReader: ContentEntityReader;

describe("ContentEntityReader wiring", () => {
  beforeAll(() => {
    const container = createAppContainer();
    prisma = container.resolve("prisma");
    contentEntityReader = container.resolve("contentEntityReader");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // All nine content entity types: the five from Phase 4 plus the four wired
  // in Phase 6.4, each resolved through the real container so a missing
  // repository registration fails here rather than at runtime in the worker.
  it.each([
    "layer",
    "map",
    "world_element",
    "faction",
    "character",
    "event",
    "plot",
    "chapter",
    "scene",
  ])(
    "resolves and reads entity type %s without a wiring error (random id -> null)",
    async (entityType) => {
      const result = await contentEntityReader.read({
        entityType,
        entityId: randomUUID(),
      });

      expect(result).toBeNull();
    },
  );

  it("throws for an entity type with no descriptor, resolved from the real container", async () => {
    // `event` served as the unknown type until 6.4 gave it a descriptor.
    await expect(
      contentEntityReader.read({
        entityType: "comment",
        entityId: randomUUID(),
      }),
    ).rejects.toThrow(
      /No ContentEntityReader descriptor for entity type "comment"/,
    );
  });
});
