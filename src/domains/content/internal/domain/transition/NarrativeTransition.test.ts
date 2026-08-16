import { describe, expect, it } from "vitest";

import {
  deriveNarrativeTransitionStatus,
  NarrativeTransition,
  type CreateNarrativeTransitionProperties,
  type NarrativeTransitionProperties,
} from "./NarrativeTransition.js";
import { TransitionEffect } from "./TransitionEffect.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const projectId = "project-1";
const declaredByUserId = "user-1";

function createTransition(
  overrides: Partial<CreateNarrativeTransitionProperties> = {},
) {
  return NarrativeTransition.create({
    id: "transition-1",
    projectId,
    sourceEntityType: "scene",
    sourceEntityId: "scene-1",
    title: "Raja Terbunuh",
    declaredByUserId,
    now,
    ...overrides,
  });
}

const baseSnapshot: NarrativeTransitionProperties = {
  id: "transition-1",
  projectId,
  sourceEntityType: "scene",
  sourceEntityId: "scene-1",
  title: "Raja Terbunuh",
  description: null,
  declaredByUserId,
  reversesTransitionId: null,
  createdAt: now,
  updatedAt: now,
};

function reconstitute(overrides: Partial<NarrativeTransitionProperties> = {}) {
  return NarrativeTransition.reconstitute({ ...baseSnapshot, ...overrides });
}

let effectSequence = 0;

function pendingEffect() {
  effectSequence += 1;

  return TransitionEffect.create({
    id: `effect-${String(effectSequence)}`,
    narrativeTransitionId: "transition-1",
    projectId,
    effectType: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "description",
    newValue: "Tewas di tangga istana",
    now,
  });
}

function appliedEffect() {
  const effect = pendingEffect();

  effect.markApplied({ contentRevisionId: "revision-1", now: later });

  return effect;
}

describe("NarrativeTransition.create", () => {
  it("declares a transition with normalised labels", () => {
    const transition = createTransition({
      title: "  Raja Terbunuh  ",
      description: "   ",
    });

    expect(transition.title).toBe("Raja Terbunuh");
    expect(transition.description).toBeNull();
    expect(transition.reversesTransitionId).toBeNull();
    expect(transition.createdAt).toBe(now);
    expect(transition.updatedAt).toBe(now);
  });

  it("keeps a reversal link when one is declared", () => {
    const transition = createTransition({
      reversesTransitionId: "transition-0",
    });

    expect(transition.reversesTransitionId).toBe("transition-0");
  });

  it.each(["scene", "event", "chapter"] as const)(
    "accepts %s as a source",
    (sourceEntityType) => {
      expect(() =>
        createTransition({
          sourceEntityType,
          sourceEntityId: `${sourceEntityType}-1`,
        }),
      ).not.toThrow();
    },
  );

  // A Character or a Map is what gets affected, never the cause. Casting past
  // the union is the only way to express it, which is the point of the runtime
  // check.
  it("rejects a content entity type that is not a narrative cause", () => {
    expect(() =>
      createTransition({ sourceEntityType: "character" as never }),
    ).toThrow(/Invalid narrative transition source entity type/);
  });

  it.each([
    ["id", { id: " " }],
    ["project id", { projectId: "" }],
    ["source entity id", { sourceEntityId: "  " }],
    ["declared by user id", { declaredByUserId: "" }],
  ] as const)("rejects a blank %s", (_label, overrides) => {
    expect(() => createTransition(overrides)).toThrow(DomainError);
  });

  it("rejects a blank title", () => {
    expect(() => createTransition({ title: "   " })).toThrow(
      /title is required/,
    );
  });

  it("rejects a transition that reverses itself", () => {
    expect(() =>
      createTransition({ id: "transition-1", reversesTransitionId: "transition-1" }),
    ).toThrow(/cannot reverse itself/);
  });

  it("rejects a blank reversal link", () => {
    expect(() => createTransition({ reversesTransitionId: "  " })).toThrow(
      /must not be blank/,
    );
  });
});

describe("NarrativeTransition.updateDetails", () => {
  it("reports no change when nothing moved", () => {
    const transition = reconstitute();

    expect(
      transition.updateDetails({ title: "Raja Terbunuh", now: later }),
    ).toBe(false);
    expect(transition.updatedAt).toBe(now);
  });

  it("treats a title that only differs by surrounding space as unchanged", () => {
    const transition = reconstitute();

    expect(
      transition.updateDetails({ title: "  Raja Terbunuh  ", now: later }),
    ).toBe(false);
  });

  it("updates the labels and stamps the update time", () => {
    const transition = reconstitute();

    expect(
      transition.updateDetails({
        title: "Raja Terbunuh di Tangga Istana",
        description: "  Dua penjaga ikut tewas.  ",
        now: later,
      }),
    ).toBe(true);

    expect(transition.title).toBe("Raja Terbunuh di Tangga Istana");
    expect(transition.description).toBe("Dua penjaga ikut tewas.");
    expect(transition.updatedAt).toBe(later);
  });

  it("clears a description with a blank value", () => {
    const transition = reconstitute({ description: "Dua penjaga ikut tewas." });

    expect(transition.updateDetails({ description: "  ", now: later })).toBe(
      true,
    );
    expect(transition.description).toBeNull();
  });

  it("refuses a blank title and leaves the aggregate untouched", () => {
    const transition = reconstitute();

    expect(() => transition.updateDetails({ title: "  ", now: later })).toThrow(
      DomainError,
    );

    expect(transition.title).toBe("Raja Terbunuh");
    expect(transition.updatedAt).toBe(now);
  });
});

describe("deriveNarrativeTransitionStatus", () => {
  // Vacuously "all applied" is exactly the wrong reading: a transition with no
  // effects has changed nothing in the world.
  it("treats a transition with no effects as declared", () => {
    expect(deriveNarrativeTransitionStatus([])).toBe("declared");
  });

  it("is declared while every effect is pending", () => {
    expect(
      deriveNarrativeTransitionStatus([pendingEffect(), pendingEffect()]),
    ).toBe("declared");
  });

  it("is partially applied once one effect is applied", () => {
    expect(
      deriveNarrativeTransitionStatus([appliedEffect(), pendingEffect()]),
    ).toBe("partially_applied");
  });

  it("is fully applied only when no effect is left pending", () => {
    expect(
      deriveNarrativeTransitionStatus([appliedEffect(), appliedEffect()]),
    ).toBe("fully_applied");
  });

  it("follows an effect that is applied after the first reading", () => {
    const effect = pendingEffect();
    const effects = [effect, appliedEffect()];

    expect(deriveNarrativeTransitionStatus(effects)).toBe("partially_applied");

    effect.markApplied({ contentRevisionId: "revision-2", now: later });

    expect(deriveNarrativeTransitionStatus(effects)).toBe("fully_applied");
  });
});

describe("NarrativeTransition.toSnapshot", () => {
  it("returns a copy that cannot mutate the aggregate", () => {
    const transition = reconstitute();
    const snapshot = transition.toSnapshot();

    snapshot.title = "Judul Lain";

    expect(transition.title).toBe("Raja Terbunuh");
  });
});
