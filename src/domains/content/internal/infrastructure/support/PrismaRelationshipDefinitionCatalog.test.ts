import { describe, expect, it } from "vitest";

import {
  PrismaRelationshipDefinitionCatalog,
  type RelationshipDefinitionCatalogDatabase,
} from "./PrismaRelationshipDefinitionCatalog.js";
import { RelationshipDefinitionCatalogError } from "../../domain/support/RelationshipDefinitionCatalogError.js";

import type { RelationshipDefinitionDraft } from "../../domain/support/relationshipDefinition.js";

// Hand-written fake client rather than Postgres, for the same reason
// `PrismaContentRelationshipRepository.test.ts` has one: these are branches an
// integration test cannot arrange on demand. Here it is the DECORATION FAILING —
// the conflict lookup that runs after `P2002` — which needs a database that
// answers one call and refuses the next, and no real Postgres can be asked for
// that at a chosen moment. `relationship-definition-catalog.integration.test.ts`
// still exercises the same method against a real database.
const projectId = "6e6e6e6e-0000-4000-8000-000000002520";

const draft: RelationshipDefinitionDraft = {
  predicate: "mentors",
  directionality: "directional",
  objectRequired: true,
  inverseLabel: "mentored_by",
  displayLabel: "mentors",
  inverseDisplayLabel: "mentored by",
  signatures: [{ subjectEntityType: "character", objectEntityType: "character" }],
};

function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function clientThatFailsCreateWith(
  createError: Error,
  lookup: () => Promise<unknown>,
): RelationshipDefinitionCatalogDatabase {
  return {
    relationshipDefinition: {
      create: () => Promise.reject(createError),
      findFirst: lookup,
      findMany: () => Promise.resolve([]),
    },
  } as unknown as RelationshipDefinitionCatalogDatabase;
}

describe("PrismaRelationshipDefinitionCatalog conflict path", () => {
  it("still answers a CONFLICT when the decorating lookup itself fails", async () => {
    const catalog = new PrismaRelationshipDefinitionCatalog(
      clientThatFailsCreateWith(uniqueViolation(), () =>
        Promise.reject(new Error("connection terminated")),
      ),
    );

    // The duplicate is the answer; naming the winning row only decorates it. A
    // dead pool on the decoration must not turn a 409 into a 500 and swallow the
    // P2002 that was the real outcome (gate B8P-1).
    await expect(catalog.create(projectId, draft)).rejects.toThrow(
      RelationshipDefinitionCatalogError,
    );
  });

  it("degrades to a nameless conflict rather than inventing a row", async () => {
    const catalog = new PrismaRelationshipDefinitionCatalog(
      clientThatFailsCreateWith(uniqueViolation(), () =>
        Promise.reject(new Error("statement timeout")),
      ),
    );

    await expect(catalog.create(projectId, draft)).rejects.toMatchObject({
      predicate: "mentors",
      existing: null,
    });
  });

  it("does NOT dress up a non-unique failure as a duplicate", async () => {
    const catalog = new PrismaRelationshipDefinitionCatalog(
      clientThatFailsCreateWith(new Error("connection refused"), () =>
        Promise.resolve(null),
      ),
    );

    // The catch around the lookup must not widen into a catch around the write:
    // anything that is not P2002 still surfaces raw, the way every other adapter
    // in this codebase leaves an untranslated failure alone.
    await expect(catalog.create(projectId, draft)).rejects.toThrow(
      /connection refused/,
    );
  });
});
