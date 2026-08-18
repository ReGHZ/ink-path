import { describe, expect, it } from "vitest";

import {
  TransitionEffect,
  type CreateTransitionEffectProperties,
  type TransitionEffectProperties,
} from "./TransitionEffect.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { CONTENT_ENTITY_TYPES } from "../support/ContentRevision.js";
import { seededDefinition } from "../support/relationshipDefinitionSeed.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const projectId = "project-1";
const narrativeTransitionId = "transition-1";

type CreateAttributeChangeProperties = Extract<
  CreateTransitionEffectProperties,
  { effectType: "attribute_change" }
>;

type CreateRelationshipChangeProperties = Extract<
  CreateTransitionEffectProperties,
  { effectType: "relationship_add" | "relationship_remove" }
>;

function createAttributeChange(
  overrides: Partial<CreateAttributeChangeProperties> = {},
) {
  return TransitionEffect.create({
    id: "effect-1",
    narrativeTransitionId,
    projectId,
    effectType: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "description",
    newValue: "Tewas di tangga istana",
    now,
    ...overrides,
  });
}

// `member_of` is directional and the registry allows `character -> faction`, so
// this base row is never swapped by canonicalisation — tests that care about
// orientation opt in through overrides instead of fighting the default.
function createRelationshipChange(
  overrides: Partial<CreateRelationshipChangeProperties> = {},
) {
  const relationshipType =
    "relationshipType" in overrides && overrides.relationshipType !== undefined
      ? overrides.relationshipType
      : "member_of";

  return TransitionEffect.create({
    id: "effect-1",
    narrativeTransitionId,
    projectId,
    effectType: "relationship_add",
    targetEntityType: "character",
    targetEntityId: "character-1",
    relationshipType,
    // Follows the predicate unless the case overrides it — a fixed default would
    // hand one predicate's row to another and test the wrong matrix.
    definition:
      "definition" in overrides && overrides.definition !== undefined
        ? overrides.definition
        : seededDefinition(relationshipType),
    relatedEntityType: "faction",
    relatedEntityId: "faction-1",
    now,
    ...overrides,
  });
}

const attributeSnapshot: TransitionEffectProperties = {
  id: "effect-1",
  narrativeTransitionId,
  projectId,
  effectType: "attribute_change",
  targetEntityType: "character",
  targetEntityId: "character-1",
  fieldPath: "description",
  newValue: "Tewas di tangga istana",
  relationshipType: null,
  relatedEntityType: null,
  relatedEntityId: null,
  appliedAt: null,
  contentRevisionId: null,
  createdAt: now,
};

const relationshipSnapshot: TransitionEffectProperties = {
  ...attributeSnapshot,
  effectType: "relationship_add",
  fieldPath: null,
  newValue: null,
  relationshipType: "member_of",
  relatedEntityType: "faction",
  relatedEntityId: "faction-1",
};

function reconstitute(overrides: Partial<TransitionEffectProperties> = {}) {
  return TransitionEffect.reconstitute({ ...attributeSnapshot, ...overrides });
}

describe("TransitionEffect.create — attribute_change", () => {
  it("is born pending, with no relationship fields and no revision pointer", () => {
    const effect = createAttributeChange();

    expect(effect.effectType).toBe("attribute_change");
    expect(effect.fieldPath).toBe("description");
    expect(effect.relationshipType).toBeNull();
    expect(effect.relatedEntityType).toBeNull();
    expect(effect.relatedEntityId).toBeNull();
    expect(effect.appliedAt).toBeNull();
    expect(effect.contentRevisionId).toBeNull();
    expect(effect.isApplied).toBe(false);
    expect(effect.createdAt).toBe(now);
  });

  // The intended value is stored exactly as declared: normalising it here would
  // make the stored intent differ from what the target aggregate eventually
  // writes, and the target aggregate is the one that owns the rule.
  it("stores the new value verbatim", () => {
    const effect = createAttributeChange({ newValue: "  Raja Baru  " });

    expect(effect.newValue).toBe("  Raja Baru  ");
  });

  it("rejects status for every entity type", () => {
    for (const targetEntityType of CONTENT_ENTITY_TYPES) {
      expect(() =>
        createAttributeChange({
          targetEntityType,
          targetEntityId: `${targetEntityType}-1`,
          fieldPath: "status",
        }),
      ).toThrow(DomainError);
    }
  });

  it("rejects the manuscript body", () => {
    expect(() => createAttributeChange({ fieldPath: "content" })).toThrow(
      DomainError,
    );
  });

  it("rejects a field that belongs to another entity type", () => {
    expect(() => createAttributeChange({ fieldPath: "summary" })).toThrow(
      DomainError,
    );
  });

  it("names the writable fields when refusing a field path", () => {
    expect(() => createAttributeChange({ fieldPath: "status" })).toThrow(
      /Writable fields: archetype, background, description, goal, name, personality/,
    );
  });

  it("accepts the wire field name and refuses the aggregate property name", () => {
    expect(() =>
      createAttributeChange({
        targetEntityType: "event",
        targetEntityId: "event-1",
        fieldPath: "event_type",
      }),
    ).not.toThrow();

    expect(() =>
      createAttributeChange({
        targetEntityType: "event",
        targetEntityId: "event-1",
        fieldPath: "eventType",
      }),
    ).toThrow(DomainError);
  });

  it("requires a non-blank new value", () => {
    expect(() => createAttributeChange({ newValue: "   " })).toThrow(
      DomainError,
    );
  });
});

describe("TransitionEffect.create — relationship effects", () => {
  it("keeps the declared endpoints instead of canonicalising them", () => {
    // `ally_of` is non-directional, so the row this effect will write is
    // canonicalised to character -> faction. The effect must NOT be: its
    // `target_entity_*` columns answer "which entity does this touch", and the
    // pending-effect index is built on them.
    const effect = createRelationshipChange({
      relationshipType: "ally_of",
      targetEntityType: "faction",
      targetEntityId: "faction-1",
      relatedEntityType: "character",
      relatedEntityId: "character-1",
    });

    expect(effect.targetEntityType).toBe("faction");
    expect(effect.targetEntityId).toBe("faction-1");
    expect(effect.relatedEntityType).toBe("character");
    expect(effect.relatedEntityId).toBe("character-1");
  });

  it("accepts a non-directional pair declared in either orientation", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "ally_of",
        targetEntityType: "character",
        targetEntityId: "character-1",
        relatedEntityType: "faction",
        relatedEntityId: "faction-1",
      }),
    ).not.toThrow();

    expect(() =>
      createRelationshipChange({
        relationshipType: "ally_of",
        targetEntityType: "faction",
        targetEntityId: "faction-1",
        relatedEntityType: "character",
        relatedEntityId: "character-1",
      }),
    ).not.toThrow();
  });

  // The mirror of the test above, and the reason canonicalisation cannot simply
  // be applied to every type: for a directional type the orientation IS the
  // meaning, so `target_entity_*` is the relationship's source side.
  it("rejects a directional pair declared backwards", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "member_of",
        targetEntityType: "faction",
        targetEntityId: "faction-1",
        relatedEntityType: "character",
        relatedEntityId: "character-1",
      }),
    ).toThrow(/does not allow the pair faction -> character/);
  });

  // "Unknown predicate" is no longer answerable here: since step 4 the
  // vocabulary is per-project rows, and a name nobody defined has no definition
  // to hand in — NarrativeTransitionService answers that one, with a 400, before
  // create() is reached. What the entity can still catch is a caller that
  // resolved one predicate and declared another.
  it("rejects a definition that describes a different predicate", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "owns",
        definition: seededDefinition("member_of"),
      }),
    ).toThrow(/does not describe relation type owns/);
  });

  it("rejects a pair the relation type does not allow", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "member_of",
        relatedEntityType: "map",
        relatedEntityId: "map-1",
      }),
    ).toThrow(DomainError);
  });

  it("rejects a self-relationship", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "related_to",
        targetEntityType: "character",
        targetEntityId: "character-1",
        relatedEntityType: "character",
        relatedEntityId: "character-1",
      }),
    ).toThrow(/Self-relationship is not allowed/);
  });

  it("allows two distinct entities of the same type", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "related_to",
        targetEntityType: "character",
        targetEntityId: "character-1",
        relatedEntityType: "character",
        relatedEntityId: "character-2",
      }),
    ).not.toThrow();
  });

  it("rejects structural hierarchy in both orientations", () => {
    expect(() =>
      createRelationshipChange({
        relationshipType: "related_to",
        targetEntityType: "chapter",
        targetEntityId: "chapter-1",
        relatedEntityType: "scene",
        relatedEntityId: "scene-1",
      }),
    ).toThrow(/structural hierarchy/);

    expect(() =>
      createRelationshipChange({
        relationshipType: "related_to",
        targetEntityType: "scene",
        targetEntityId: "scene-1",
        relatedEntityType: "chapter",
        relatedEntityId: "chapter-1",
      }),
    ).toThrow(/structural hierarchy/);
  });

  it("carries no attribute change fields", () => {
    const effect = createRelationshipChange({
      effectType: "relationship_remove",
    });

    expect(effect.effectType).toBe("relationship_remove");
    expect(effect.fieldPath).toBeNull();
    expect(effect.newValue).toBeNull();
    expect(effect.isApplied).toBe(false);
  });
});

describe("TransitionEffect.reconstitute", () => {
  it.each([
    ["id", { id: "  " }],
    ["narrative transition id", { narrativeTransitionId: "" }],
    ["project id", { projectId: "" }],
    ["target entity id", { targetEntityId: " " }],
  ] as const)("rejects a blank %s", (_label, overrides) => {
    expect(() => reconstitute(overrides)).toThrow(DomainError);
  });

  it("rejects an entity type outside the closed set", () => {
    expect(() =>
      reconstitute({
        targetEntityType: "narrative_transition" as never,
      }),
    ).toThrow(/Invalid target entity type/);

    expect(() =>
      TransitionEffect.reconstitute({
        ...relationshipSnapshot,
        relatedEntityType: "narrative_transition" as never,
      }),
    ).toThrow(/Invalid related entity type/);
  });

  // The three-variant union is the whole point of this entity: the database has
  // one CHECK, on `effect_type`, and nothing else stops a row from carrying both
  // halves at once.
  it("rejects an attribute change carrying relationship fields", () => {
    expect(() =>
      reconstitute({
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: "faction-1",
      }),
    ).toThrow(/must not carry relationship fields/);
  });

  it("rejects a relationship effect carrying attribute change fields", () => {
    expect(() =>
      TransitionEffect.reconstitute({
        ...relationshipSnapshot,
        fieldPath: "description",
        newValue: "Tewas",
      }),
    ).toThrow(/must not carry attribute change fields/);
  });

  it("rejects an attribute change with no field path or no new value", () => {
    expect(() => reconstitute({ fieldPath: null })).toThrow(
      /requires a field path/,
    );
    expect(() => reconstitute({ newValue: null })).toThrow(
      /requires a new value/,
    );
  });

  it("rejects a relationship effect with no relation type or no related entity", () => {
    expect(() =>
      TransitionEffect.reconstitute({
        ...relationshipSnapshot,
        relationshipType: null,
      }),
    ).toThrow(/requires a relationship type/);

    expect(() =>
      TransitionEffect.reconstitute({
        ...relationshipSnapshot,
        relatedEntityId: null,
      }),
    ).toThrow(/requires a related entity/);
  });

  // A field path that has since been removed from the allowlist must stay
  // READABLE: the delete guard has to read `applied_at` before it can delete a
  // pending effect, so a row this constructor refused would be a row nobody
  // could ever get rid of.
  it("accepts a stored field path the allowlist no longer covers", () => {
    expect(() => reconstitute({ fieldPath: "status" })).not.toThrow();
  });

  it("rejects a pending effect that points at a content revision", () => {
    expect(() =>
      reconstitute({ contentRevisionId: "revision-1" }),
    ).toThrow(/Pending transition effect must not reference a content revision/);
  });

  it("rejects a blank content revision id", () => {
    expect(() =>
      reconstitute({ appliedAt: later, contentRevisionId: "  " }),
    ).toThrow(/must not be blank/);
  });

  it("rejects an applied attribute change with no content revision", () => {
    expect(() => reconstitute({ appliedAt: later })).toThrow(
      /Applied attribute change effect requires a content revision id/,
    );
  });

  it("rejects a relationship effect that points at a content revision", () => {
    expect(() =>
      TransitionEffect.reconstitute({
        ...relationshipSnapshot,
        appliedAt: later,
        contentRevisionId: "revision-1",
      }),
    ).toThrow(/Relationship effect must not reference a content revision/);
  });

  it("accepts an applied attribute change with its revision pointer", () => {
    const effect = reconstitute({
      appliedAt: later,
      contentRevisionId: "revision-1",
    });

    expect(effect.isApplied).toBe(true);
    expect(effect.appliedAt).toBe(later);
    expect(effect.contentRevisionId).toBe("revision-1");
  });

  it("accepts an applied relationship effect with no revision pointer", () => {
    const effect = TransitionEffect.reconstitute({
      ...relationshipSnapshot,
      appliedAt: later,
    });

    expect(effect.isApplied).toBe(true);
    expect(effect.contentRevisionId).toBeNull();
  });
});

describe("TransitionEffect.markApplied", () => {
  it("records the revision produced by an attribute change", () => {
    const effect = createAttributeChange();

    effect.markApplied({ contentRevisionId: "revision-1", now: later });

    expect(effect.isApplied).toBe(true);
    expect(effect.appliedAt).toBe(later);
    expect(effect.contentRevisionId).toBe("revision-1");
  });

  it("applies a relationship effect without a revision", () => {
    const effect = createRelationshipChange();

    effect.markApplied({ now: later });

    expect(effect.isApplied).toBe(true);
    expect(effect.appliedAt).toBe(later);
    expect(effect.contentRevisionId).toBeNull();
  });

  it("refuses an attribute change with no revision, leaving the effect pending", () => {
    const effect = createAttributeChange();

    expect(() => {
      effect.markApplied({ now: later });
    }).toThrow(DomainError);

    // The rejection must not half-apply: validate() runs before the assignment,
    // so a caller that catches this error still holds a pending effect.
    expect(effect.isApplied).toBe(false);
    expect(effect.appliedAt).toBeNull();
  });

  it("refuses a relationship effect that is handed a revision", () => {
    const effect = createRelationshipChange();

    expect(() => {
      effect.markApplied({ contentRevisionId: "revision-1", now: later });
    }).toThrow(/must not reference a content revision/);

    expect(effect.isApplied).toBe(false);
  });

  // Append-only. The service is expected to see this under the row lock and
  // answer with an idempotent no-op; reaching the throw means that check was
  // skipped, and the second ContentRevision it would have produced is exactly
  // what the lock exists to prevent.
  it("refuses a second apply and keeps the first one intact", () => {
    const effect = createAttributeChange();

    effect.markApplied({ contentRevisionId: "revision-1", now: later });

    expect(() => {
      effect.markApplied({
        contentRevisionId: "revision-2",
        now: new Date("2026-08-18T00:00:00.000Z"),
      });
    }).toThrow(/already applied/);

    expect(effect.appliedAt).toBe(later);
    expect(effect.contentRevisionId).toBe("revision-1");
  });
});

describe("TransitionEffect.toSnapshot", () => {
  it("returns a copy that cannot mutate the aggregate", () => {
    const effect = createAttributeChange();
    const snapshot = effect.toSnapshot();

    snapshot.appliedAt = later;

    expect(effect.appliedAt).toBeNull();
    expect(effect.isApplied).toBe(false);
  });
});
