import { describe, expect, it } from "vitest";

import { RelationshipDtoMapper } from "./RelationshipDtoMapper.js";
import { seededDefinition } from "../../../domain/support/relationshipDefinitionSeed.js";
import {
  relationshipListItemSchema,
  relationshipResponseSchema,
} from "../../dto/support/relationshipResponseSchema.js";

import type { RelationshipDetail } from "../../../application/support/RelationshipService.js";

// Unit-tested rather than left to E2E (`notes/02-struktur-domain-dan-test.md:151`
// — "unit kalau ada logika"): this is the only DTO mapper in the project that
// computes something instead of renaming fields. Direction and effective label
// depend on WHICH side was queried, and the wrong answer is not a crash — it is
// a plausible-looking label on the wrong endpoint, which no HTTP status would
// reveal.
const CREATED_AT = new Date("2026-08-15T10:00:00.000Z");
const UPDATED_AT = new Date("2026-08-15T11:00:00.000Z");

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const FACTION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CHARACTER_ID = "33333333-3333-4333-8333-333333333333";

// Directionality and the inverse symbol reach the mapper ON THE DETAIL since
// step 4 — the application layer reads them from `relationship_definitions`.
// Derived from the seed here rather than hardcoded so a fixture that changes
// only `relationType` cannot silently keep another predicate's directionality.
function detail(overrides: Partial<RelationshipDetail> = {}): RelationshipDetail {
  const relationType = overrides.relationType ?? "member_of";
  const definition = seededDefinition(relationType);

  return {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: "55555555-5555-4555-8555-555555555555",
    sourceEntityType: "character",
    sourceEntityId: CHARACTER_ID,
    targetEntityType: "faction",
    targetEntityId: FACTION_ID,
    relationType,
    directionality: definition.directionality,
    inverseLabel: definition.inverseLabel,
    note: null,
    createdByUserId: "66666666-6666-4666-8666-666666666666",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

const MEMBERSHIP = { role: "editor", canDelete: false } as const;

describe("RelationshipDtoMapper — perspective", () => {
  it("reads a directional relationship from the source as outgoing, keeping the stored type as the label", () => {
    const [item] = RelationshipDtoMapper.toRelationshipListResponse([detail()], {
      entityType: "character",
      entityId: CHARACTER_ID,
    }).relationships;

    expect(item).toMatchObject({
      direction: "outgoing",
      label: "member_of",
    });
  });

  it("reads the SAME directional relationship from the target as incoming, with the registry's inverse label", () => {
    const [item] = RelationshipDtoMapper.toRelationshipListResponse([detail()], {
      entityType: "faction",
      entityId: FACTION_ID,
    }).relationships;

    // The whole reason the addendum puts this in the DTO mapper: without the
    // flip, the faction's own page would claim it is `member_of` the character.
    expect(item).toMatchObject({
      direction: "incoming",
      label: "has_member",
    });
  });

  it("never reports outgoing/incoming for a non-directional type, from either side", () => {
    // `ally_of` between two characters: after canonicalisation which one sits in
    // `source` is decided by lexicographic order of the ids, so a structural
    // "outgoing" here would be reporting a sorting artefact as a narrative fact.
    const row = detail({
      relationType: "ally_of",
      targetEntityType: "character",
      targetEntityId: OTHER_CHARACTER_ID,
    });

    const fromSource = RelationshipDtoMapper.toRelationshipListResponse([row], {
      entityType: "character",
      entityId: CHARACTER_ID,
    }).relationships[0];
    const fromTarget = RelationshipDtoMapper.toRelationshipListResponse([row], {
      entityType: "character",
      entityId: OTHER_CHARACTER_ID,
    }).relationships[0];

    expect(fromSource).toMatchObject({
      direction: "non_directional",
      label: "ally_of",
    });
    expect(fromTarget).toMatchObject({
      direction: "non_directional",
      label: "ally_of",
    });
  });

  it("distinguishes the two endpoints by id, not only by entity type", () => {
    // Same entity type on both sides — if the mapper compared types alone it
    // would answer `outgoing` for the target too.
    const row = detail({
      relationType: "betrays",
      targetEntityType: "character",
      targetEntityId: OTHER_CHARACTER_ID,
    });

    const fromTarget = RelationshipDtoMapper.toRelationshipListResponse([row], {
      entityType: "character",
      entityId: OTHER_CHARACTER_ID,
    }).relationships[0];

    expect(fromTarget).toMatchObject({
      direction: "incoming",
      label: "betrayed_by",
    });
  });

  it("renders a predicate with no definition attached instead of throwing", () => {
    // The composite foreign key makes this unreachable through the database, so
    // the case is constructed by hand: a detail whose definition the application
    // layer could not resolve. Kept because the alternative to a verbatim label
    // is a 500 on GET, and the row is perfectly meaningful unflipped.
    const row: RelationshipDetail = {
      ...detail(),
      relationType: "retired_type",
      directionality: undefined,
      inverseLabel: undefined,
    };

    const fromTarget = RelationshipDtoMapper.toRelationshipListResponse([row], {
      entityType: "faction",
      entityId: FACTION_ID,
    }).relationships[0];

    expect(fromTarget).toMatchObject({
      direction: "incoming",
      label: "retired_type",
    });
  });

  it("computes each row against the queried entity, not against the first row", () => {
    const outgoing = detail({ id: "aaaa1111-1111-4111-8111-111111111111" });
    const incoming = detail({
      id: "bbbb2222-2222-4222-8222-222222222222",
      relationType: "influences",
      sourceEntityType: "faction",
      sourceEntityId: FACTION_ID,
      targetEntityType: "character",
      targetEntityId: CHARACTER_ID,
    });

    const { relationships } = RelationshipDtoMapper.toRelationshipListResponse(
      [outgoing, incoming],
      { entityType: "character", entityId: CHARACTER_ID },
    );

    expect(relationships.map((r) => [r.direction, r.label])).toEqual([
      ["outgoing", "member_of"],
      ["incoming", "influenced_by"],
    ]);
  });
});

describe("RelationshipDtoMapper — response shapes", () => {
  it("emits exactly the item schema's fields, with no version and no perspective fields", () => {
    const response = RelationshipDtoMapper.toRelationshipResponse(detail());

    // `.strict()` rejects an extra key and the parse rejects a missing one, so
    // this pins the wire contract in both directions — in particular that
    // `version` never appears (K4: `expectedVersion` does not cross the wire).
    expect(relationshipResponseSchema.parse(response)).toEqual(response);
    expect(Object.keys(response).sort()).toEqual([
      "createdAt",
      "createdByUserId",
      "id",
      "note",
      "projectId",
      "relationType",
      "sourceEntityId",
      "sourceEntityType",
      "targetEntityId",
      "targetEntityType",
      "updatedAt",
    ]);
  });

  it("emits a list item that satisfies the strict list schema", () => {
    const item = RelationshipDtoMapper.toRelationshipListItem(detail(), {
      entityType: "character",
      entityId: CHARACTER_ID,
    });

    expect(relationshipListItemSchema.parse(item)).toEqual(item);
  });

  it("returns an empty collection rather than omitting the key", () => {
    expect(
      RelationshipDtoMapper.toRelationshipListResponse([], {
        entityType: "character",
        entityId: CHARACTER_ID,
      }),
    ).toEqual({ relationships: [] });
  });
});

describe("RelationshipDtoMapper — inputs", () => {
  it("carries both endpoints, the raw relation type and the note into the create input", () => {
    const input = RelationshipDtoMapper.toCreateRelationshipInput(
      {
        sourceEntityType: "character",
        sourceEntityId: CHARACTER_ID,
        targetEntityType: "faction",
        targetEntityId: FACTION_ID,
        // Unnarrowed on purpose: rule 1 is the domain's, so the mapper must not
        // filter, default or normalise it on the way in.
        relationType: "not_a_relation_type",
        note: "  ",
      },
      "user-1",
      "project-1",
      MEMBERSHIP,
    );

    expect(input).toEqual({
      requestingUserId: "user-1",
      requestingMembership: MEMBERSHIP,
      projectId: "project-1",
      sourceEntityType: "character",
      sourceEntityId: CHARACTER_ID,
      targetEntityType: "faction",
      targetEntityId: FACTION_ID,
      relationType: "not_a_relation_type",
      note: "  ",
    });
  });

  it("passes a null note through as a clear instead of dropping the key", () => {
    const input = RelationshipDtoMapper.toUpdateRelationshipNoteInput(
      { note: null },
      "user-1",
      MEMBERSHIP,
    );

    expect(input).toEqual({
      requestingUserId: "user-1",
      requestingMembership: MEMBERSHIP,
      note: null,
    });
  });

  it("builds the delete input from identity alone — no version, no body", () => {
    expect(
      RelationshipDtoMapper.toDeleteRelationshipInput("user-1", MEMBERSHIP),
    ).toEqual({
      requestingUserId: "user-1",
      requestingMembership: MEMBERSHIP,
    });
  });
});
