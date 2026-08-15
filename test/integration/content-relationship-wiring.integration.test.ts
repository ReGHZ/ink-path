import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";

import type { ContentEntityLocator } from "../../src/domains/content/internal/application/ports/ContentEntityLocator.js";
import type { RelationshipService } from "../../src/domains/content/internal/application/support/RelationshipService.js";
import type { RelationshipController } from "../../src/domains/content/internal/interface/support/RelationshipController.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Wiring test, not a behavior test — the co-located unit tests
// (`ContentEntityLocator.test.ts`, `RelationshipService.test.ts`,
// `PrismaContentRelationshipRepository.test.ts`) already cover the logic against
// hand-written stubs. What only this file can prove: the Awilix parameter names
// in `registerContentDomain` genuinely match the cradle keys, so the objects
// actually assemble and reach a real Postgres. Nothing type-checks that
// correspondence; the container resolving at runtime does.
//
// Required explicitly by the 7.2 quality gate ("wiring DI locator belum
// terbukti", `notes/phase-7-content-relationship.md:596-599`): the locator half
// of the descriptor table had NO container-level coverage while the reader half
// had `content-entity-reader.integration.test.ts`. Same convention as every
// other port here (Qdrant, embedding provider, DLX) — a stub-based unit test
// proves logic, an integration test proves wiring; neither substitutes for the
// other.
let prisma: PrismaClient;
let contentEntityLocator: ContentEntityLocator;
let relationshipService: RelationshipService;
let relationshipController: RelationshipController;

describe("Content relationship wiring", () => {
  beforeAll(() => {
    const container = createAppContainer();
    prisma = container.resolve("prisma");
    contentEntityLocator = container.resolve("contentEntityLocator");
    relationshipService = container.resolve("relationshipService");
    relationshipController = container.resolve("relationshipController");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // All nine content entity types through the real container: a repository that
  // was never registered, or a descriptor wired to the wrong repository, fails
  // here instead of at runtime on the first POST /relationships.
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
  ] as const)(
    "resolves and locates entity type %s without a wiring error (random id -> null)",
    async (entityType) => {
      const result = await contentEntityLocator.locate({
        entityType,
        entityId: randomUUID(),
      });

      expect(result).toBeNull();
    },
  );

  it("resolves RelationshipService with a repository bound to the real database", async () => {
    // Reaches `contentRelationshipRepository.findById` against real Postgres —
    // a missing or mis-wired repository registration surfaces as a resolution
    // or query error, not as this 404.
    await expect(
      relationshipService.getRelationshipById(randomUUID(), randomUUID()),
    ).rejects.toThrow(/Relationship not found/);
  });

  it("resolves RelationshipService with the locator injected, not a stub", async () => {
    // Different message on purpose: this one can only come from the locator
    // path (`assertEntityInProject`), so it proves the service reached the
    // locator rather than short-circuiting somewhere else.
    await expect(
      relationshipService.listRelationshipsByEntity(
        randomUUID(),
        "character",
        randomUUID(),
      ),
    ).rejects.toThrow(/Content entity not found/);
  });

  // `mountContentModule` resolves this key by name; if the registration were
  // missing, every relationship route would 500 at request time and only an
  // e2e test would notice.
  it("resolves RelationshipController for the route table to mount", () => {
    expect(relationshipController).toBeDefined();
  });
});
