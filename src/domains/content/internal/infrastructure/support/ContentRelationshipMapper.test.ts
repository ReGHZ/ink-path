import { describe, expect, it } from "vitest";

import { ContentRelationshipMapper } from "./ContentRelationshipMapper.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";

import type { ContentRelationship as PrismaContentRelationship } from "../../../../../generated/prisma/client.js";

// Obligation 2 of the 7.1 gate (notes §9): the canonical-order invariant was
// deliberately REMOVED from ContentRelationship.validate(), because a row stored
// out of canonical order would otherwise have become impossible to delete
// through the API forever. The one detection that removal cost is a mapper that
// swaps endpoints — and the 7.4 dedup test does NOT cover it, since a swap
// applied consistently in both directions still dedups correctly. This file is
// the replacement, so it has to defeat exactly that: a CONSISTENT double swap.
//
// A round-trip alone cannot. toPersistence and toDomain swapping in the same
// way is an identity function end to end. Hence both halves are asserted:
// concrete column values on the way out (pins the wiring to real column names),
// and the round trip on the way back (pins the two directions to each other).
const NOW = new Date("2026-08-15T00:00:00.000Z");

// `influences` allows character -> faction AND faction -> character
// (`relationTypeRegistry.ts:304-332`), chosen on purpose: with a directional
// type whose reverse pair is illegal, a swap would blow up inside
// reconstitute() as a rule-3 DomainError, and the test would pass for a reason
// unrelated to what it claims to check. Here a swapped mapper produces a
// perfectly valid aggregate, so only the assertions below can catch it.
function buildRelationship(): ContentRelationship {
  return ContentRelationship.create({
    id: "relationship-1",
    projectId: "project-1",
    relationType: "influences",
    source: { entityType: "character", entityId: "character-1" },
    target: { entityType: "faction", entityId: "faction-1" },
    note: "the sect elder leans on him",
    createdByUserId: "user-1",
    now: NOW,
  });
}

// Mirrors what Postgres hands back: the columns the mapper wrote, plus the ones
// the database fills in itself (`id` supplied by the repository's create call,
// `version`/`createdAt`/`updatedAt` by column defaults).
function asStoredRow(
  relationship: ContentRelationship,
): PrismaContentRelationship {
  const persisted = ContentRelationshipMapper.toPersistence(relationship);

  return {
    id: relationship.id,
    version: 0,
    projectId: persisted.projectId,
    sourceEntityType: persisted.sourceEntityType,
    sourceEntityId: persisted.sourceEntityId,
    targetEntityType: persisted.targetEntityType,
    targetEntityId: persisted.targetEntityId,
    relationType: persisted.relationType,
    note: persisted.note ?? null,
    createdByUserId: persisted.createdByUserId ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("ContentRelationshipMapper", () => {
  describe("toPersistence", () => {
    it("writes each endpoint to its own column", () => {
      const persisted = ContentRelationshipMapper.toPersistence(
        buildRelationship(),
      );

      expect(persisted.sourceEntityType).toBe("character");
      expect(persisted.sourceEntityId).toBe("character-1");
      expect(persisted.targetEntityType).toBe("faction");
      expect(persisted.targetEntityId).toBe("faction-1");
      expect(persisted.relationType).toBe("influences");
      expect(persisted.projectId).toBe("project-1");
      expect(persisted.createdByUserId).toBe("user-1");
      expect(persisted.note).toBe("the sect elder leans on him");
    });

    // The aggregate owns its id; the repository passes it explicitly on create
    // (`PrismaContentRelationshipRepository.insert`). If it leaked in here as
    // well the two would silently compete for the same column.
    it("leaves id and version to the repository and the column default", () => {
      const persisted = ContentRelationshipMapper.toPersistence(
        buildRelationship(),
      );

      expect(persisted).not.toHaveProperty("id");
      expect(persisted).not.toHaveProperty("version");
    });

    // Unlike every Phase 4-6 create mapper, both timestamps are written rather
    // than left to `DEFAULT CURRENT_TIMESTAMP` / `@updatedAt`. Create is the
    // only flow in this codebase that RETURNS the row it just wrote (Flow 4
    // step 10), so the stored values and the response body have to come from
    // one clock — otherwise POST-then-GET shows two different `createdAt`s for
    // the same relationship.
    it("stores the same timestamps the create response will report", () => {
      const relationship = buildRelationship();

      const persisted = ContentRelationshipMapper.toPersistence(relationship);

      expect(persisted.createdAt).toBe(relationship.createdAt);
      expect(persisted.updatedAt).toBe(relationship.updatedAt);
      expect(persisted.createdAt).toBe(NOW);
    });
  });

  describe("toDomain", () => {
    it("round-trips both endpoints without swapping them", () => {
      const original = buildRelationship();

      const restored = ContentRelationshipMapper.toDomain(
        asStoredRow(original),
      );

      expect(restored.sourceEntityType).toBe(original.sourceEntityType);
      expect(restored.sourceEntityId).toBe(original.sourceEntityId);
      expect(restored.targetEntityType).toBe(original.targetEntityType);
      expect(restored.targetEntityId).toBe(original.targetEntityId);
      expect(restored.relationType).toBe(original.relationType);
      expect(restored.note).toBe(original.note);
      expect(restored.createdByUserId).toBe(original.createdByUserId);
      expect(restored.projectId).toBe(original.projectId);
    });

    it("carries the stored version through, since the guard depends on it", () => {
      const row = { ...asStoredRow(buildRelationship()), version: 7 };

      expect(ContentRelationshipMapper.toDomain(row).version).toBe(7);
    });

    // `relation_type` is TEXT with no CHECK, so the cast in toDomain asserts
    // nothing — the entity is what refuses a value outside the registry. This
    // proves the refusal actually happens on the read path rather than the cast
    // quietly admitting free text.
    it("refuses a row whose relation_type is not in the registry", () => {
      const row = {
        ...asStoredRow(buildRelationship()),
        relationType: "cultivates_with",
      };

      expect(() => ContentRelationshipMapper.toDomain(row)).toThrow(
        /Unknown relation type/,
      );
    });

    // A row saved in non-canonical order must still load: the 7.1 gate rejected
    // re-checking canonical order on the read path precisely because such a row
    // could then never be deleted through the API (notes §9).
    it("loads a non-canonical non-directional row rather than rejecting it", () => {
      const row: PrismaContentRelationship = {
        ...asStoredRow(buildRelationship()),
        relationType: "ally_of",
        sourceEntityType: "faction",
        sourceEntityId: "faction-1",
        targetEntityType: "character",
        targetEntityId: "character-1",
      };

      const restored = ContentRelationshipMapper.toDomain(row);

      expect(restored.sourceEntityType).toBe("faction");
      expect(restored.targetEntityType).toBe("character");
    });
  });

  describe("toUpdatePersistence", () => {
    it("writes note plus the bookkeeping columns and nothing else", () => {
      const relationship = buildRelationship();
      relationship.updateNote({ note: "revised", now: NOW });

      const update =
        ContentRelationshipMapper.toUpdatePersistence(relationship);

      expect(update).toEqual({
        note: "revised",
        updatedAt: NOW,
        version: { increment: 1 },
      });
    });

    // The four endpoint columns plus relation_type are the row's natural
    // identity (the 6-column unique index); Flow 4 §Update Relation rules that
    // changing them is delete + create. toEqual above already pins the shape,
    // but naming them makes the intent survive a future field being added.
    it("never writes the natural identity columns", () => {
      const update = ContentRelationshipMapper.toUpdatePersistence(
        buildRelationship(),
      );

      expect(update).not.toHaveProperty("sourceEntityType");
      expect(update).not.toHaveProperty("sourceEntityId");
      expect(update).not.toHaveProperty("targetEntityType");
      expect(update).not.toHaveProperty("targetEntityId");
      expect(update).not.toHaveProperty("relationType");
      expect(update).not.toHaveProperty("projectId");
    });
  });
});
