import { describe, expect, it } from "vitest";

import { NarrativeTransitionDtoMapper } from "./NarrativeTransitionDtoMapper.js";
import {
  narrativeTransitionResponseSchema,
  assertionResponseSchema,
} from "../../dto/transition/transitionResponseSchema.js";

import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  NarrativeTransitionDetail,
  AssertionDetail,
} from "../../../application/transition/NarrativeTransitionService.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";
const CHARACTER_ID = "33333333-3333-4333-8333-333333333333";
const FACTION_ID = "44444444-4444-4444-8444-444444444444";
const REVISION_ID = "55555555-5555-4555-8555-555555555555";

const writer: ProjectMembership = { role: "writer", canDelete: true };

const appliedAttributeAssertion: AssertionDetail = {
  id: "66666666-6666-4666-8666-666666666666",
  narrativeTransitionId: TRANSITION_ID,
  projectId: PROJECT_ID,
  operation: "attribute_change",
  targetEntityType: "character",
  targetEntityId: CHARACTER_ID,
  fieldPath: "archetype",
  newValue: "fallen hero",
  relationshipType: null,
  relatedEntityType: null,
  relatedEntityId: null,
  appliedAt: new Date("2026-08-17T10:00:00.000Z"),
  contentRevisionId: REVISION_ID,
  createdAt: new Date("2026-08-17T09:00:00.000Z"),
};

const pendingRelationshipAssertion: AssertionDetail = {
  id: "77777777-7777-4777-8777-777777777777",
  narrativeTransitionId: TRANSITION_ID,
  projectId: PROJECT_ID,
  operation: "relationship_remove",
  targetEntityType: "character",
  targetEntityId: CHARACTER_ID,
  fieldPath: null,
  newValue: null,
  relationshipType: "member_of",
  relatedEntityType: "faction",
  relatedEntityId: FACTION_ID,
  appliedAt: null,
  contentRevisionId: null,
  createdAt: new Date("2026-08-17T09:30:00.000Z"),
};

const transitionDetail: NarrativeTransitionDetail = {
  id: TRANSITION_ID,
  projectId: PROJECT_ID,
  sourceEntityType: "scene",
  sourceEntityId: "88888888-8888-4888-8888-888888888888",
  title: "The duel at the bridge",
  description: "Aldric loses his standing",
  declaredByUserId: USER_ID,
  reversesTransitionId: null,
  status: "partially_applied",
  assertions: [appliedAttributeAssertion, pendingRelationshipAssertion],
  createdAt: new Date("2026-08-17T09:00:00.000Z"),
  updatedAt: new Date("2026-08-17T10:00:00.000Z"),
};

describe("NarrativeTransitionDtoMapper.toDeclareTransitionInput", () => {
  it("carries the identity from the route and the payload from the body", () => {
    const input = NarrativeTransitionDtoMapper.toDeclareTransitionInput(
      {
        sourceEntityType: "scene",
        sourceEntityId: "88888888-8888-4888-8888-888888888888",
        title: "The duel at the bridge",
        description: null,
      },
      USER_ID,
      PROJECT_ID,
      writer,
    );

    // No `reversesTransitionId: undefined` in this expectation, deliberately:
    // Vitest `toEqual` treats an undefined-valued key and an absent key as
    // equal, so writing it here would READ like coverage while asserting
    // nothing — the mapper line could be deleted and this stays green. The
    // control for that field is the test below, which passes a real value.
    expect(input).toEqual({
      requestingUserId: USER_ID,
      requestingMembership: writer,
      projectId: PROJECT_ID,
      sourceEntityType: "scene",
      sourceEntityId: "88888888-8888-4888-8888-888888888888",
      title: "The duel at the bridge",
      description: null,
    });
  });

  // The field this test exists for is not an ordinary optional: a reversal is
  // the ONLY sanctioned way to undo an applied transition
  // (`05-implementation-policy/05_append_only_invariants.md:52-64`), so a
  // mapper that dropped the pointer would store the undo as an ordinary
  // transition — causality severed, nothing raised, and the GraphProjector of
  // Phase 11 never told. Found by the 7.8 gate: the line could be deleted with
  // the whole interface suite still green.
  it("carries the reversal pointer, the one field whose loss would be silent", () => {
    const input = NarrativeTransitionDtoMapper.toDeclareTransitionInput(
      {
        sourceEntityType: "event",
        sourceEntityId: "88888888-8888-4888-8888-888888888888",
        title: "Undo the duel",
        reversesTransitionId: TRANSITION_ID,
      },
      USER_ID,
      PROJECT_ID,
      writer,
    );

    expect(input.reversesTransitionId).toBe(TRANSITION_ID);
  });
});

describe("NarrativeTransitionDtoMapper.toUpdateTransitionDetailsInput", () => {
  // The bug this file exists to prevent: `?? null` in the mapper would make
  // every partial PATCH clear the description. Types cannot catch it — the
  // service accepts `string | null | undefined` and would happily obey.
  it("keeps an omitted field undefined instead of turning it into a clear", () => {
    const input = NarrativeTransitionDtoMapper.toUpdateTransitionDetailsInput(
      { title: "Renamed" },
      USER_ID,
      writer,
    );

    expect(input.title).toBe("Renamed");
    expect(input.description).toBeUndefined();
    expect(input.description).not.toBeNull();
  });

  it("passes an explicit null through as a clear", () => {
    const input = NarrativeTransitionDtoMapper.toUpdateTransitionDetailsInput(
      { description: null },
      USER_ID,
      writer,
    );

    expect(input.description).toBeNull();
    expect(input.title).toBeUndefined();
  });
});

describe("NarrativeTransitionDtoMapper.toAddEffectInput", () => {
  it("maps the attribute variant without any relationship field", () => {
    const input = NarrativeTransitionDtoMapper.toAddEffectInput(
      {
        operation: "attribute_change",
        targetEntityType: "character",
        targetEntityId: CHARACTER_ID,
        fieldPath: "archetype",
        newValue: "  fallen hero  ",
      },
      USER_ID,
      writer,
    );

    expect(input).toEqual({
      requestingUserId: USER_ID,
      requestingMembership: writer,
      operation: "attribute_change",
      targetEntityType: "character",
      targetEntityId: CHARACTER_ID,
      fieldPath: "archetype",
      // Still verbatim at this layer — the mapper is not allowed to be the
      // place that quietly normalises a stored intent either.
      newValue: "  fallen hero  ",
    });
    expect("relationshipType" in input).toBe(false);
  });

  it("maps both relationship variants without any attribute field", () => {
    for (const operation of ["relationship_add", "relationship_remove"] as const) {
      const input = NarrativeTransitionDtoMapper.toAddEffectInput(
        {
          operation,
          targetEntityType: "character",
          targetEntityId: CHARACTER_ID,
          relationshipType: "member_of",
          relatedEntityType: "faction",
          relatedEntityId: FACTION_ID,
        },
        USER_ID,
        writer,
      );

      expect(input).toEqual({
        requestingUserId: USER_ID,
        requestingMembership: writer,
        operation,
        targetEntityType: "character",
        targetEntityId: CHARACTER_ID,
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: FACTION_ID,
      });
      expect("fieldPath" in input).toBe(false);
      expect("newValue" in input).toBe(false);
    }
  });
});

describe("NarrativeTransitionDtoMapper.toMutateTransitionInput", () => {
  it("carries the caller and nothing else — apply and delete take no body", () => {
    expect(
      NarrativeTransitionDtoMapper.toMutateTransitionInput(USER_ID, writer),
    ).toEqual({ requestingUserId: USER_ID, requestingMembership: writer });
  });
});

describe("NarrativeTransitionDtoMapper response mapping", () => {
  it("maps an assertion field for field, including the provenance pair", () => {
    const response =
      NarrativeTransitionDtoMapper.toAssertionResponse(
        appliedAttributeAssertion,
      );

    expect(response).toEqual(appliedAttributeAssertion);
    expect(assertionResponseSchema.parse(response)).toEqual(response);
  });

  it("maps a transition with its assertions and passes its own response schema", () => {
    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionResponse(
        transitionDetail,
      );

    expect(response.status).toBe("partially_applied");
    expect(response.assertions).toHaveLength(2);
    expect(response.assertions[0]?.appliedAt).toEqual(
      appliedAttributeAssertion.appliedAt,
    );
    expect(response.assertions[1]?.appliedAt).toBeNull();
    // `.strict()` plus a total field list: a field dropped by the mapper fails
    // the parse here rather than reaching a client as a missing key.
    expect(narrativeTransitionResponseSchema.parse(response)).toEqual(response);
  });

  it("wraps a list under one key and keeps order", () => {
    const second: NarrativeTransitionDetail = {
      ...transitionDetail,
      id: "99999999-9999-4999-8999-999999999999",
      title: "The retreat",
      status: "declared",
      assertions: [],
    };

    const response =
      NarrativeTransitionDtoMapper.toNarrativeTransitionListResponse([
        transitionDetail,
        second,
      ]);

    expect(response.narrativeTransitions.map((item) => item.title)).toEqual([
      "The duel at the bridge",
      "The retreat",
    ]);
    expect(response.narrativeTransitions[1]?.assertions).toEqual([]);
  });

  it("returns an empty list as an empty array, never as an absent key", () => {
    expect(
      NarrativeTransitionDtoMapper.toNarrativeTransitionListResponse([]),
    ).toEqual({ narrativeTransitions: [] });
  });
});
