import { describe, expect, it } from "vitest";

import { addEffectSchema } from "./addEffectSchema.js";
import { declareTransitionSchema } from "./declareTransitionSchema.js";
import { updateTransitionSchema } from "./updateTransitionSchema.js";

const SCENE_ID = "11111111-1111-4111-8111-111111111111";
const CHARACTER_ID = "22222222-2222-4222-8222-222222222222";
const FACTION_ID = "33333333-3333-4333-8333-333333333333";
const TRANSITION_ID = "44444444-4444-4444-8444-444444444444";

describe("declareTransitionSchema", () => {
  it("accepts a minimal declaration and leaves the optional pair absent", () => {
    const parsed = declareTransitionSchema.parse({
      sourceEntityType: "scene",
      sourceEntityId: SCENE_ID,
      title: "The duel at the bridge",
    });

    expect(parsed).toEqual({
      sourceEntityType: "scene",
      sourceEntityId: SCENE_ID,
      title: "The duel at the bridge",
    });
  });

  it("accepts the three source types and refuses a content type that is not one", () => {
    for (const sourceEntityType of ["scene", "event", "chapter"]) {
      expect(
        declareTransitionSchema.safeParse({
          sourceEntityType,
          sourceEntityId: SCENE_ID,
          title: "T",
        }).success,
      ).toBe(true);
    }

    // A character is a valid ContentEntityType and an invalid SOURCE: it is what
    // gets affected, never the cause. Reading CONTENT_ENTITY_TYPES here instead
    // of NARRATIVE_TRANSITION_SOURCE_TYPES would let this through.
    expect(
      declareTransitionSchema.safeParse({
        sourceEntityType: "character",
        sourceEntityId: CHARACTER_ID,
        title: "T",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown key rather than dropping it", () => {
    const result = declareTransitionSchema.safeParse({
      sourceEntityType: "scene",
      sourceEntityId: SCENE_ID,
      title: "T",
      status: "dead",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a body-borne id that is not a uuid", () => {
    expect(
      declareTransitionSchema.safeParse({
        sourceEntityType: "scene",
        sourceEntityId: "not-a-uuid",
        title: "T",
      }).success,
    ).toBe(false);

    expect(
      declareTransitionSchema.safeParse({
        sourceEntityType: "scene",
        sourceEntityId: SCENE_ID,
        title: "T",
        reversesTransitionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("trims the title and refuses one that is only whitespace", () => {
    expect(
      declareTransitionSchema.parse({
        sourceEntityType: "scene",
        sourceEntityId: SCENE_ID,
        title: "  Padded  ",
      }).title,
    ).toBe("Padded");

    expect(
      declareTransitionSchema.safeParse({
        sourceEntityType: "scene",
        sourceEntityId: SCENE_ID,
        title: "   ",
      }).success,
    ).toBe(false);
  });

  it("accepts a null description and a reversal pointer", () => {
    const parsed = declareTransitionSchema.parse({
      sourceEntityType: "event",
      sourceEntityId: SCENE_ID,
      title: "Undo the duel",
      description: null,
      reversesTransitionId: TRANSITION_ID,
    });

    expect(parsed.description).toBeNull();
    expect(parsed.reversesTransitionId).toBe(TRANSITION_ID);
  });
});

describe("updateTransitionSchema", () => {
  // The three readings of `description` — the reason the mapper may not use
  // `?? null`. If this schema ever defaulted the key, "leave it alone" would
  // become "clear it" for every request that omits it.
  it("keeps omitted and null distinguishable", () => {
    const omitted = updateTransitionSchema.parse({ title: "New title" });
    expect("description" in omitted).toBe(false);
    expect(omitted.description).toBeUndefined();

    const cleared = updateTransitionSchema.parse({ description: null });
    expect(cleared.description).toBeNull();
  });

  // Not a 400, unlike `updateRelationshipSchema`: the service distinguishes
  // "asked for nothing" from "asked for what is already there" and leaves
  // `updated_at` untouched in both cases.
  it("accepts an empty body", () => {
    expect(updateTransitionSchema.parse({})).toEqual({});
  });

  it("rejects an unknown key and a null title", () => {
    expect(updateTransitionSchema.safeParse({ titel: "typo" }).success).toBe(
      false,
    );
    expect(updateTransitionSchema.safeParse({ title: null }).success).toBe(
      false,
    );
  });
});

describe("addEffectSchema", () => {
  const attributeChange = {
    operation: "attribute_change",
    targetEntityType: "character",
    targetEntityId: CHARACTER_ID,
    fieldPath: "archetype",
    newValue: "fallen hero",
  };

  const relationshipAdd = {
    operation: "relationship_add",
    targetEntityType: "character",
    targetEntityId: CHARACTER_ID,
    relationshipType: "member_of",
    relatedEntityType: "faction",
    relatedEntityId: FACTION_ID,
  };

  it("accepts each of the three variants", () => {
    expect(addEffectSchema.safeParse(attributeChange).success).toBe(true);
    expect(addEffectSchema.safeParse(relationshipAdd).success).toBe(true);
    expect(
      addEffectSchema.safeParse({
        ...relationshipAdd,
        operation: "relationship_remove",
      }).success,
    ).toBe(true);
  });

  // The whole point of the discriminated union plus `.strict()`: a body that
  // mixes the two variants is refused, not silently half-read.
  it("refuses a variant carrying the other variant's fields", () => {
    expect(
      addEffectSchema.safeParse({
        ...attributeChange,
        relationshipType: "member_of",
      }).success,
    ).toBe(false);

    expect(
      addEffectSchema.safeParse({ ...relationshipAdd, fieldPath: "archetype" })
        .success,
    ).toBe(false);
  });

  it("refuses an unknown assertion type and an incomplete relationship variant", () => {
    expect(
      addEffectSchema.safeParse({ ...attributeChange, operation: "rename" })
        .success,
    ).toBe(false);

    expect(
      addEffectSchema.safeParse({
        operation: "relationship_add",
        targetEntityType: "character",
        targetEntityId: CHARACTER_ID,
        relationshipType: "member_of",
        relatedEntityType: "faction",
      }).success,
    ).toBe(false);
  });

  // Rule 1 stays in the domain (D1/D3): both of these parse, and both are
  // rejected later with a message that can name the writable fields or the
  // registry. A Zod enum here would answer first, differently, and only for
  // callers that arrive through HTTP.
  it("passes an unknown relation type and an unknown field path through to the domain", () => {
    expect(
      addEffectSchema.safeParse({
        ...relationshipAdd,
        relationshipType: "invented_by_the_client",
      }).success,
    ).toBe(true);

    expect(
      addEffectSchema.safeParse({ ...attributeChange, fieldPath: "status" })
        .success,
    ).toBe(true);
  });

  // `new_value` is stored verbatim by the domain, so trimming it here would
  // store an intent the writer did not type — while a blank one must still be a
  // 400, because clearing a field is not expressible through an assertion.
  it("preserves surrounding whitespace in newValue but refuses a blank one", () => {
    expect(
      addEffectSchema.parse({ ...attributeChange, newValue: "  spaced  " }),
    ).toMatchObject({ newValue: "  spaced  " });

    expect(
      addEffectSchema.safeParse({ ...attributeChange, newValue: "   " })
        .success,
    ).toBe(false);
    expect(
      addEffectSchema.safeParse({ ...attributeChange, newValue: "" }).success,
    ).toBe(false);
  });

  it("rejects a related entity type that is not a content entity type", () => {
    expect(
      addEffectSchema.safeParse({
        ...relationshipAdd,
        relatedEntityType: "narrative_transition",
      }).success,
    ).toBe(false);
  });
});
