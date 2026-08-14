import { describe, expect, it } from "vitest";

import {
  ContentRelationship,
  type ContentRelationshipProperties,
  type CreateContentRelationshipProperties,
} from "./ContentRelationship.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

import type { ContentEntityType } from "./ContentRevision.js";
import type {
  RelationEndpoint,
  RelationType,
} from "./relationTypeRegistry.js";

const now = new Date("2026-08-14T00:00:00.000Z");
const later = new Date("2026-08-15T00:00:00.000Z");

const projectId = "project-1";
const createdByUserId = "user-1";

const character: RelationEndpoint = {
  entityType: "character",
  entityId: "character-1",
};
const otherCharacter: RelationEndpoint = {
  entityType: "character",
  entityId: "character-2",
};
const faction: RelationEndpoint = {
  entityType: "faction",
  entityId: "faction-1",
};

// Directional, and `character -> faction` is the pair the registry allows for it
// — a base row that never has to be swapped, so tests that care about
// canonicalization can opt in via overrides instead of fighting the default.
const baseSnapshot: ContentRelationshipProperties = {
  id: "relationship-1",
  version: 0,
  projectId,
  sourceEntityType: "character",
  sourceEntityId: "character-1",
  targetEntityType: "faction",
  targetEntityId: "faction-1",
  relationType: "member_of",
  note: null,
  createdByUserId,
  createdAt: now,
  updatedAt: now,
};

function createRelationship(
  overrides: Partial<CreateContentRelationshipProperties> = {},
) {
  return ContentRelationship.create({
    id: "relationship-1",
    projectId,
    relationType: "member_of",
    source: character,
    target: faction,
    createdByUserId,
    now,
    ...overrides,
  });
}

function reconstituteRelationship(
  overrides: Partial<ContentRelationshipProperties> = {},
) {
  return ContentRelationship.reconstitute({ ...baseSnapshot, ...overrides });
}

function endpointOverrides(
  source: RelationEndpoint,
  target: RelationEndpoint,
): Partial<ContentRelationshipProperties> {
  return {
    sourceEntityType: source.entityType,
    sourceEntityId: source.entityId,
    targetEntityType: target.entityType,
    targetEntityId: target.entityId,
  };
}

function expectDomainError(act: () => unknown): DomainError {
  try {
    act();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);

    return error as DomainError;
  }

  throw new Error("Expected a DomainError, but nothing was thrown");
}

// One table, asserted against BOTH entry paths below. create() is the path
// RelationshipService uses and reconstitute() is the path a persisted row comes
// back through (and, from 7.7 onwards, the path a NarrativeTransition effect can
// reach); a rule that held on only one of them would be a rule with a hole.
//
// The message matcher is what makes these cases distinguishable at all: every
// rule here fails with the same DomainErrorCode, so asserting only the code
// would let rule 3 stand in for rule 4 or 11 without the suite noticing.
const RULE_VIOLATIONS: ReadonlyArray<{
  rule: string;
  relationType: string;
  source: RelationEndpoint;
  target: RelationEndpoint;
  message: RegExp;
}> = [
  {
    rule: "rule 1 — relation type outside the registry",
    relationType: "besties_with",
    source: character,
    target: faction,
    message: /unknown relation type/i,
  },
  {
    rule: "rule 4 — same entity type and id on both sides",
    relationType: "ally_of",
    source: character,
    target: character,
    message: /self-relationship/i,
  },
  {
    rule: "rule 11 — layer hierarchy",
    relationType: "related_to",
    source: { entityType: "layer", entityId: "layer-1" },
    target: { entityType: "layer", entityId: "layer-2" },
    message: /structural hierarchy/i,
  },
  {
    rule: "rule 11 — map hierarchy",
    relationType: "related_to",
    source: { entityType: "map", entityId: "map-1" },
    target: { entityType: "map", entityId: "map-2" },
    message: /structural hierarchy/i,
  },
  {
    rule: "rule 11 — chapter-scene hierarchy",
    relationType: "related_to",
    source: { entityType: "chapter", entityId: "chapter-1" },
    target: { entityType: "scene", entityId: "scene-1" },
    message: /structural hierarchy/i,
  },
  {
    rule: "rule 11 — chapter-scene hierarchy, other way round",
    relationType: "related_to",
    source: { entityType: "scene", entityId: "scene-1" },
    target: { entityType: "chapter", entityId: "chapter-1" },
    message: /structural hierarchy/i,
  },
  {
    rule: "rule 3 — pair not allowed for this relation type",
    relationType: "member_of",
    source: faction,
    target: character,
    message: /does not allow the pair/i,
  },
  {
    rule: "rule 3 — event -> scene, which `depicts` already covers one way",
    relationType: "depicts",
    source: { entityType: "event", entityId: "event-1" },
    target: { entityType: "scene", entityId: "scene-1" },
    message: /does not allow the pair/i,
  },
  {
    rule: "rule 3 — entity type outside the closed set",
    relationType: "related_to",
    source: character,
    target: {
      entityType: "not_a_real_entity" as ContentEntityType,
      entityId: "whatever-1",
    },
    message: /does not allow the pair/i,
  },
];

describe("ContentRelationship", () => {
  describe("create", () => {
    it("starts at version 0 and stamps both timestamps from `now`", () => {
      const relationship = createRelationship();

      expect(relationship.version).toBe(0);
      expect(relationship.createdAt).toEqual(now);
      expect(relationship.updatedAt).toEqual(now);
    });

    it("keeps a directional relation exactly as submitted (rule 10)", () => {
      const relationship = createRelationship();

      expect(relationship.relationType).toBe("member_of");
      expect(relationship.sourceEntityType).toBe("character");
      expect(relationship.sourceEntityId).toBe("character-1");
      expect(relationship.targetEntityType).toBe("faction");
      expect(relationship.targetEntityId).toBe("faction-1");
    });

    it("treats A -> B and B -> A as two different directional relations (rule 10)", () => {
      const forward = createRelationship({
        relationType: "influences",
        source: character,
        target: faction,
      });
      const backward = createRelationship({
        relationType: "influences",
        source: faction,
        target: character,
      });

      expect(forward.sourceEntityType).toBe("character");
      expect(backward.sourceEntityType).toBe("faction");
    });

    // The point of rule 9: whichever way the client submits a non-directional
    // relation, the STORED row is the same one, which is what makes the
    // 6-column unique index the entire duplicate check — no read-before-write.
    it("canonicalizes a non-directional relation to the same row from either direction (rule 9)", () => {
      const submitted = createRelationship({
        relationType: "related_to",
        source: faction,
        target: character,
      });
      const submittedReversed = createRelationship({
        relationType: "related_to",
        source: character,
        target: faction,
      });

      expect(submitted.sourceEntityType).toBe("character");
      expect(submitted.sourceEntityId).toBe("character-1");
      expect(submitted.targetEntityType).toBe("faction");
      expect(submitted.targetEntityId).toBe("faction-1");

      expect([
        submitted.sourceEntityType,
        submitted.sourceEntityId,
        submitted.targetEntityType,
        submitted.targetEntityId,
      ]).toEqual([
        submittedReversed.sourceEntityType,
        submittedReversed.sourceEntityId,
        submittedReversed.targetEntityType,
        submittedReversed.targetEntityId,
      ]);
    });

    it("canonicalizes by entity id when both sides share an entity type", () => {
      const relationship = createRelationship({
        relationType: "ally_of",
        source: otherCharacter,
        target: character,
      });

      expect(relationship.sourceEntityId).toBe("character-1");
      expect(relationship.targetEntityId).toBe("character-2");
    });

    it("normalizes the note, collapsing whitespace-only text to null", () => {
      expect(createRelationship({ note: "  sworn siblings  " }).note).toBe(
        "sworn siblings",
      );
      expect(createRelationship({ note: "   " }).note).toBeNull();
    });

    it("treats an omitted note as null", () => {
      expect(createRelationship().note).toBeNull();
    });

    it("rejects an empty id, project id, or endpoint id", () => {
      expect(() => createRelationship({ id: "  " })).toThrow(DomainError);
      expect(() => createRelationship({ projectId: "  " })).toThrow(DomainError);
      expect(() =>
        createRelationship({ source: { entityType: "character", entityId: " " } }),
      ).toThrow(DomainError);
      expect(() =>
        createRelationship({ target: { entityType: "faction", entityId: " " } }),
      ).toThrow(DomainError);
    });

    it("rejects a blank created-by user id", () => {
      expect(() => createRelationship({ createdByUserId: "  " })).toThrow(
        DomainError,
      );
    });

    for (const violation of RULE_VIOLATIONS) {
      it(`rejects ${violation.rule}`, () => {
        const error = expectDomainError(() =>
          createRelationship({
            relationType: violation.relationType,
            source: violation.source,
            target: violation.target,
          }),
        );

        expect(error.message).toMatch(violation.message);
      });
    }
  });

  describe("reconstitute", () => {
    it("accepts a persisted row untouched, including a raw note", () => {
      const relationship = reconstituteRelationship({
        version: 7,
        note: "  raw note  ",
      });

      expect(relationship.version).toBe(7);
      expect(relationship.note).toBe("  raw note  ");
    });

    // `created_by_user_id` is nullable with `onDelete: SetNull`, so this state
    // is reachable in production the moment an author deletes their account —
    // the row must stay readable and deletable.
    it("accepts a null created-by user id but rejects a blank one", () => {
      expect(reconstituteRelationship({ createdByUserId: null }).createdByUserId).toBeNull();
      expect(() => reconstituteRelationship({ createdByUserId: "  " })).toThrow(
        DomainError,
      );
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteRelationship({ version: -1 })).toThrow(
        DomainError,
      );
      expect(() => reconstituteRelationship({ version: 1.5 })).toThrow(
        DomainError,
      );
    });

    for (const violation of RULE_VIOLATIONS) {
      it(`rejects ${violation.rule}`, () => {
        const error = expectDomainError(() =>
          reconstituteRelationship({
            relationType: violation.relationType as RelationType,
            ...endpointOverrides(violation.source, violation.target),
          }),
        );

        expect(error.message).toMatch(violation.message);
      });
    }

    it("accepts a non-directional row", () => {
      const relationship = reconstituteRelationship({
        relationType: "ally_of",
        ...endpointOverrides(character, faction),
      });

      expect(relationship.sourceEntityType).toBe("character");
    });

    // Canonical order is a write-path rule (registry §9/§10), enforced by
    // create(), and this tolerance is deliberate rather than an oversight — it is
    // what keeps a row that somehow drifted out of canonical order readable and
    // therefore DELETABLE. Flow 4 §Delete step 4 reads the aggregate to obtain
    // `version`, so a constructor that refused such a row would strand it in a
    // table that has no `content_revisions` history to recover from. Detecting
    // drifted rows is a data-audit job; 7.2 covers the write side by proving the
    // mapper round-trips endpoints without swapping them.
    it("tolerates a non-directional row stored in non-canonical order so it stays deletable", () => {
      const relationship = reconstituteRelationship({
        relationType: "ally_of",
        ...endpointOverrides(faction, character),
      });

      expect(relationship.sourceEntityType).toBe("faction");
      expect(relationship.targetEntityType).toBe("character");
    });
  });

  describe("updateNote", () => {
    it("sets the note, moves updatedAt, and reports the change", () => {
      const relationship = createRelationship();

      expect(relationship.updateNote({ note: "  betrayed later  ", now: later })).toBe(
        true,
      );
      expect(relationship.note).toBe("betrayed later");
      expect(relationship.updatedAt).toEqual(later);
    });

    it("clears the note when given null", () => {
      const relationship = createRelationship({ note: "temporary" });

      expect(relationship.updateNote({ note: null, now: later })).toBe(true);
      expect(relationship.note).toBeNull();
    });

    // Returning false is what lets the service skip the repository call, so a
    // no-op PATCH neither writes nor burns a version increment.
    it("reports no change for an identical note and leaves updatedAt alone", () => {
      const relationship = createRelationship({ note: "sworn siblings" });

      expect(relationship.updateNote({ note: "  sworn siblings  ", now: later })).toBe(
        false,
      );
      expect(relationship.updatedAt).toEqual(now);
    });

    it("reports no change when clearing a note that is already null", () => {
      const relationship = createRelationship();

      expect(relationship.updateNote({ note: "   ", now: later })).toBe(false);
      expect(relationship.updatedAt).toEqual(now);
    });

    // The aggregate must keep the version it was READ at: the adapter needs it
    // as the optimistic-concurrency guard, and the increment happens in the
    // persistence mapper. An entity that bumped its own version would send the
    // guard looking for a row that never existed.
    it("does not touch the version", () => {
      const relationship = reconstituteRelationship({ version: 4 });

      expect(relationship.updateNote({ note: "changed", now: later })).toBe(true);
      expect(relationship.version).toBe(4);
    });

    it("cannot change the relation type or either endpoint", () => {
      const relationship = createRelationship();
      const before = relationship.toSnapshot();

      relationship.updateNote({ note: "changed", now: later });

      const after = relationship.toSnapshot();

      expect({
        relationType: after.relationType,
        sourceEntityType: after.sourceEntityType,
        sourceEntityId: after.sourceEntityId,
        targetEntityType: after.targetEntityType,
        targetEntityId: after.targetEntityId,
      }).toEqual({
        relationType: before.relationType,
        sourceEntityType: before.sourceEntityType,
        sourceEntityId: before.sourceEntityId,
        targetEntityType: before.targetEntityType,
        targetEntityId: before.targetEntityId,
      });
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const relationship = createRelationship({ note: "original" });
      const snapshot = relationship.toSnapshot();

      snapshot.note = "mutated";

      expect(relationship.note).toBe("original");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const relationship = createRelationship({ note: "sworn siblings" });
      const restored = ContentRelationship.reconstitute(
        relationship.toSnapshot(),
      );

      expect(restored.toSnapshot()).toEqual(relationship.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The pair matrix itself — 17 types × 9 × 9 — is locked against the frozen
    // document by relationTypeRegistry.test.ts. Re-transcribing it here would
    // duplicate that sweep and rot beside it; these tests only prove that the
    // entity DELEGATES to the registry instead of carrying its own opinion.
    it("accepts endpoints it cannot verify: existence, ownership, and project match are the service's job (rules 5-7)", () => {
      const relationship = createRelationship({
        projectId: "some-other-project",
        source: { entityType: "character", entityId: "not-even-a-uuid" },
      });

      expect(relationship.projectId).toBe("some-other-project");
      expect(relationship.sourceEntityId).toBe("not-even-a-uuid");
    });

    it("allows the same id on both sides when the entity types differ (rule 4)", () => {
      const relationship = createRelationship({
        relationType: "related_to",
        source: { entityType: "character", entityId: "shared-id" },
        target: { entityType: "faction", entityId: "shared-id" },
      });

      expect(relationship.sourceEntityId).toBe("shared-id");
      expect(relationship.targetEntityId).toBe("shared-id");
    });

    // Rule 12 is structural, not a check: one call produces one aggregate, and
    // nothing in the entity can emit the mirrored row. What a caller does with
    // it afterwards is the repository's contract, not this one's.
    it("produces exactly one relationship, never a mirrored second one (rule 12)", () => {
      const relationship = createRelationship({
        relationType: "ally_of",
        source: character,
        target: otherCharacter,
      });

      expect(relationship.sourceEntityId).toBe("character-1");
      expect(relationship.targetEntityId).toBe("character-2");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = expectDomainError(() =>
        createRelationship({ relationType: "besties_with" }),
      );

      expect(error.code).toBe(DomainErrorCode.DOMAIN_VALIDATION_FAILED);
    });
  });
});
