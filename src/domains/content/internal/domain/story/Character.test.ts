import { describe, expect, it } from "vitest";

import {
  Character,
  type CharacterStatus,
  type UpdateCharacterDetailsProperties,
} from "./Character.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type CharacterSnapshot = Parameters<typeof Character.reconstitute>[0];

const baseSnapshot: CharacterSnapshot = {
  id: "character-1",
  projectId: "project-1",
  createdByUserId: "user-1",
  name: "Kael of Vael",
  archetype: "Reluctant Hero",
  background: "Orphan raised by cartographers.",
  personality: "Curious, guarded.",
  goal: "Find the lost map.",
  description: "A young wayfarer.",
  content: "Detailed biography.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

// The four fields a character MUST have to enter the `active` lifecycle gate.
const ACTIVE_REQUIRED = {
  archetype: "Reluctant Hero",
  background: "Orphan raised by cartographers.",
  personality: "Curious, guarded.",
  description: "A young wayfarer.",
} as const;

function createCharacter(overrides: Partial<Parameters<typeof Character.create>[0]> = {}) {
  return Character.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteCharacter(overrides: Partial<CharacterSnapshot> = {}) {
  return Character.reconstitute({ ...baseSnapshot, ...overrides });
}

// The optional normalized text fields of a Character (everything `string | null`
// set via `normalizeOptionalText`). `name` is excluded — it is a required `string`
// trimmed, not normalized. Routing through typed switch dispatchers keeps the
// parametrized tests type-safe without string-index casts.
type CharacterTextField =
  | "archetype"
  | "background"
  | "personality"
  | "goal"
  | "description"
  | "content";

function createWithField(field: CharacterTextField, value: string | null): Character {
  switch (field) {
    case "archetype":
      return createCharacter({ archetype: value });
    case "background":
      return createCharacter({ background: value });
    case "personality":
      return createCharacter({ personality: value });
    case "goal":
      return createCharacter({ goal: value });
    case "description":
      return createCharacter({ description: value });
    case "content":
      return createCharacter({ content: value });
  }
}

function updateField(
  character: Character,
  field: CharacterTextField,
  value: string | null,
): boolean {
  const input: UpdateCharacterDetailsProperties = { now: later };
  switch (field) {
    case "archetype":
      input.archetype = value;
      break;
    case "background":
      input.background = value;
      break;
    case "personality":
      input.personality = value;
      break;
    case "goal":
      input.goal = value;
      break;
    case "description":
      input.description = value;
      break;
    case "content":
      input.content = value;
      break;
  }
  return character.updateDetails(input);
}

function getField(character: Character, field: CharacterTextField): string | null {
  switch (field) {
    case "archetype":
      return character.archetype;
    case "background":
      return character.background;
    case "personality":
      return character.personality;
    case "goal":
      return character.goal;
    case "description":
      return character.description;
    case "content":
      return character.content;
  }
}

describe("Character", () => {
  describe("create", () => {
    it("creates a draft character regardless of how many optional fields are filled", () => {
      const character = createCharacter({
        archetype: "  Reluctant Hero  ",
        background: "  Orphan raised by cartographers.  ",
        personality: "  Curious, guarded.  ",
        goal: "  Find the lost map.  ",
        description: "  A young wayfarer.  ",
        content: "  Detailed biography.  ",
      });

      expect(character.status).toBe("draft");
      expect(character.archetype).toBe("Reluctant Hero");
      expect(character.background).toBe("Orphan raised by cartographers.");
      expect(character.personality).toBe("Curious, guarded.");
      expect(character.goal).toBe("Find the lost map.");
      expect(character.description).toBe("A young wayfarer.");
      expect(character.content).toBe("Detailed biography.");
      expect(character.createdAt).toEqual(now);
      expect(character.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const character = createCharacter({
        archetype: "   ",
        background: "   ",
        personality: "   ",
        goal: "   ",
        description: "   ",
        content: "   ",
      });

      expect(character.archetype).toBeNull();
      expect(character.background).toBeNull();
      expect(character.personality).toBeNull();
      expect(character.goal).toBeNull();
      expect(character.description).toBeNull();
      expect(character.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const character = createCharacter();

      expect(character.archetype).toBeNull();
      expect(character.background).toBeNull();
      expect(character.personality).toBeNull();
      expect(character.goal).toBeNull();
      expect(character.description).toBeNull();
      expect(character.content).toBeNull();
    });

    it("trims the name before storing it", () => {
      const character = createCharacter({ name: "  Kael of Vael  " });

      expect(character.name).toBe("Kael of Vael");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createCharacter({ name: "   " })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createCharacter({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createCharacter({ id: "  " })).toThrow(DomainError);
      expect(() => createCharacter({ projectId: "  " })).toThrow(DomainError);
      expect(() => createCharacter({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name, normalizes optional text fields, and returns true", () => {
      const character = createCharacter();

      const changed = character.updateDetails({
        name: "  Kael of Vael  ",
        archetype: "  Mentor  ",
        background: "  Updated  ",
        personality: "  Stoic  ",
        goal: "  New goal  ",
        description: "  New description  ",
        content: "  New content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(character.name).toBe("Kael of Vael");
      expect(character.archetype).toBe("Mentor");
      expect(character.background).toBe("Updated");
      expect(character.personality).toBe("Stoic");
      expect(character.goal).toBe("New goal");
      expect(character.description).toBe("New description");
      expect(character.content).toBe("New content");
      expect(character.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const character = createCharacter({
        archetype: "Hero",
        background: "BG",
        personality: "P",
        goal: "G",
        description: "D",
        content: "C",
      });

      character.updateDetails({ name: "Renamed", now: later });

      expect(character.name).toBe("Renamed");
      expect(character.archetype).toBe("Hero");
      expect(character.background).toBe("BG");
      expect(character.personality).toBe("P");
      expect(character.goal).toBe("G");
      expect(character.description).toBe("D");
      expect(character.content).toBe("C");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const character = createCharacter({
        archetype: "Hero",
        background: "BG",
        personality: "P",
        goal: "G",
        description: "D",
        content: "C",
      });

      character.updateDetails({
        name: "Kael of Vael",
        archetype: null,
        background: null,
        personality: null,
        goal: null,
        description: null,
        content: null,
        now: later,
      });

      expect(character.archetype).toBeNull();
      expect(character.background).toBeNull();
      expect(character.personality).toBeNull();
      expect(character.goal).toBeNull();
      expect(character.description).toBeNull();
      expect(character.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const character = createCharacter({
        archetype: "Hero",
        background: "BG",
        personality: "P",
        goal: "G",
        description: "D",
        content: "C",
      });

      character.updateDetails({
        archetype: "   ",
        background: "   ",
        personality: "   ",
        goal: "   ",
        description: "   ",
        content: "   ",
        now: later,
      });

      expect(character.archetype).toBeNull();
      expect(character.background).toBeNull();
      expect(character.personality).toBeNull();
      expect(character.goal).toBeNull();
      expect(character.description).toBeNull();
      expect(character.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const character = createCharacter({ name: "Kael of Vael" });

      const changed = character.updateDetails({ name: "Kael of Vael", now: later });

      expect(changed).toBe(false);
      expect(character.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new name is whitespace-equivalent", () => {
      const character = createCharacter({ name: "Kael of Vael" });

      const changed = character.updateDetails({ name: "  Kael of Vael  ", now: later });

      expect(changed).toBe(false);
      expect(character.name).toBe("Kael of Vael");
      expect(character.updatedAt).toEqual(now);
    });

    it.each([
      "archetype",
      "background",
      "personality",
      "goal",
      "description",
      "content",
    ] as const)(
      "returns false and does NOT bump updatedAt when the new %s is whitespace-equivalent",
      (field) => {
        const current = "seeded value";
        const character = createWithField(field, current);

        const changed = updateField(character, field, `  ${current}  `);

        expect(changed).toBe(false);
        expect(getField(character, field)).toBe(current);
        expect(character.updatedAt).toEqual(now);
      },
    );

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const character = createCharacter({ name: "Kael of Vael" });

      expect(() => character.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(character.name).toBe("Kael of Vael");
      expect(character.updatedAt).toEqual(now);
    });

    it.each([
      "archetype",
      "background",
      "personality",
      "description",
    ] as const)(
      "is atomic: clearing %s on an active character rolls back the field, status, and updatedAt",
      (field) => {
        const character = reconstituteCharacter({
          status: "active",
          ...ACTIVE_REQUIRED,
        });

        const before = getField(character, field);

        expect(() => updateField(character, field, null)).toThrow(DomainError);

        expect(getField(character, field)).toBe(before);
        expect(character.status).toBe("active");
        expect(character.updatedAt).toEqual(now);
      },
    );

    it("is atomic: a whitespace-only update of an active-required field on an active character rolls back", () => {
      const character = reconstituteCharacter({ status: "active", ...ACTIVE_REQUIRED });

      expect(() =>
        character.updateDetails({ name: "Kael of Vael", personality: "   ", now: later }),
      ).toThrow(DomainError);

      expect(character.personality).toBe(ACTIVE_REQUIRED.personality);
      expect(character.status).toBe("active");
      expect(character.updatedAt).toEqual(now);
    });

    it("allows clearing an active-required field while the character is a draft", () => {
      const character = createCharacter({
        archetype: "Hero",
        background: "BG",
        personality: "P",
        description: "D",
      });

      character.updateDetails({
        name: "Kael of Vael",
        archetype: null,
        background: null,
        personality: null,
        description: null,
        now: later,
      });

      expect(character.archetype).toBeNull();
      expect(character.background).toBeNull();
      expect(character.personality).toBeNull();
      expect(character.description).toBeNull();
      expect(character.status).toBe("draft");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to active and returns true when all four required fields are present", () => {
      const character = createCharacter(ACTIVE_REQUIRED);

      const changed = character.changeStatus("active", later);

      expect(changed).toBe(true);
      expect(character.status).toBe("active");
      expect(character.updatedAt).toEqual(later);
    });

    it.each([
      ["archetype", { background: "BG", personality: "P", description: "D" }],
      ["background", { archetype: "A", personality: "P", description: "D" }],
      ["personality", { archetype: "A", background: "BG", description: "D" }],
      ["description", { archetype: "A", background: "BG", personality: "P" }],
    ] as const)(
      "rejects draft to active when %s is null",
      (missing, others) => {
        const character = createCharacter({ ...others, [missing]: null });

        expect(() => character.changeStatus("active", later)).toThrow(DomainError);
        expect(character.status).toBe("draft");
        expect(character.updatedAt).toEqual(now);
      },
    );

    it.each([
      ["archetype", { background: "BG", personality: "P", description: "D" }],
      ["background", { archetype: "A", personality: "P", description: "D" }],
      ["personality", { archetype: "A", background: "BG", description: "D" }],
      ["description", { archetype: "A", background: "BG", personality: "P" }],
    ] as const)(
      "rejects draft to active when %s is whitespace-only (normalized to null)",
      (missing, others) => {
        const character = createCharacter({ ...others, [missing]: "   " });

        expect(() => character.changeStatus("active", later)).toThrow(DomainError);
        expect(character.status).toBe("draft");
      },
    );

    it("allows draft to active when goal and content are null (not required for active)", () => {
      const character = createCharacter({ ...ACTIVE_REQUIRED, goal: null, content: null });

      expect(character.changeStatus("active", later)).toBe(true);
      expect(character.status).toBe("active");
    });

    it("transitions active to archived (active completeness no longer enforced while archived)", () => {
      const character = reconstituteCharacter({ status: "active", ...ACTIVE_REQUIRED });

      expect(character.changeStatus("archived", later)).toBe(true);
      expect(character.status).toBe("archived");
    });

    it("transitions active back to draft", () => {
      const character = reconstituteCharacter({ status: "active", ...ACTIVE_REQUIRED });

      expect(character.changeStatus("draft", later)).toBe(true);
      expect(character.status).toBe("draft");
    });

    it("transitions archived back to draft (no terminal-archived restriction at entity level)", () => {
      const character = reconstituteCharacter({
        status: "archived",
        archetype: null,
        background: null,
        personality: null,
        description: null,
      });

      expect(character.changeStatus("draft", later)).toBe(true);
      expect(character.status).toBe("draft");
    });

    it("rejects archived to active when an active-required field is null (invariant is state-based, not transition-based)", () => {
      const character = reconstituteCharacter({
        status: "archived",
        archetype: null,
        background: "BG",
        personality: "P",
        description: "D",
      });

      expect(() => character.changeStatus("active", later)).toThrow(DomainError);
      expect(character.status).toBe("archived");
      expect(character.updatedAt).toEqual(now);
    });

    it("allows archived to active when all four active-required fields are present", () => {
      const character = reconstituteCharacter({ status: "archived", ...ACTIVE_REQUIRED });

      expect(character.changeStatus("active", later)).toBe(true);
      expect(character.status).toBe("active");
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createCharacter();

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const active = reconstituteCharacter({ status: "active", ...ACTIVE_REQUIRED });

      expect(active.changeStatus("active", later)).toBe(false);
      expect(active.status).toBe("active");
      expect(active.updatedAt).toEqual(now);

      const archived = reconstituteCharacter({ status: "archived", ...ACTIVE_REQUIRED });

      expect(archived.changeStatus("archived", later)).toBe(false);
      expect(archived.status).toBe("archived");
      expect(archived.updatedAt).toEqual(now);
    });

    it("rejects a status outside the character lifecycle (no published status)", () => {
      const character = createCharacter(ACTIVE_REQUIRED);

      expect(() => character.changeStatus("published" as CharacterStatus, later)).toThrow(
        DomainError,
      );
      expect(character.status).toBe("draft");
      expect(character.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const character = reconstituteCharacter({
        name: "  raw name  ",
        archetype: "  raw archetype  ",
        background: "  raw background  ",
        personality: "  raw personality  ",
        goal: "  raw goal  ",
        description: "  raw description  ",
        content: "  raw content  ",
      });

      expect(character.name).toBe("  raw name  ");
      expect(character.archetype).toBe("  raw archetype  ");
      expect(character.background).toBe("  raw background  ");
      expect(character.personality).toBe("  raw personality  ");
      expect(character.goal).toBe("  raw goal  ");
      expect(character.description).toBe("  raw description  ");
      expect(character.content).toBe("  raw content  ");
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteCharacter({ status: "published" as CharacterStatus }),
      ).toThrow(DomainError);
    });

    it.each([
      ["archetype", { background: "BG", personality: "P", description: "D" }],
      ["background", { archetype: "A", personality: "P", description: "D" }],
      ["personality", { archetype: "A", background: "BG", description: "D" }],
      ["description", { archetype: "A", background: "BG", personality: "P" }],
    ] as const)(
      "rejects an active snapshot when %s is null",
      (missing, others) => {
        expect(() =>
          reconstituteCharacter({ status: "active", ...others, [missing]: null }),
        ).toThrow(DomainError);
      },
    );

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteCharacter({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts an active snapshot with all four required fields (goal/content may be null)", () => {
      const character = reconstituteCharacter({
        status: "active",
        ...ACTIVE_REQUIRED,
        goal: null,
        content: null,
      });

      expect(character.status).toBe("active");
      expect(character.goal).toBeNull();
      expect(character.content).toBeNull();
    });

    it("accepts a draft snapshot with no required fields filled (completeness only enforced at active)", () => {
      const character = reconstituteCharacter({
        status: "draft",
        archetype: null,
        background: null,
        personality: null,
        description: null,
      });

      expect(character.status).toBe("draft");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const character = createCharacter({ content: "Body" });
      const snapshot = character.toSnapshot();

      snapshot.name = "mutated";
      snapshot.content = null;

      expect(character.name).toBe("Kael of Vael");
      expect(character.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const character = reconstituteCharacter({ status: "active", ...ACTIVE_REQUIRED });
      const snapshot = character.toSnapshot();
      const restored = Character.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(character.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // currentRevisionId is an opaque established-aggregate token. The entity must NOT
    // verify cross-aggregate ownership — that is guaranteed by construction in the
    // Application Service. This test pins the boundary.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const character = createCharacter({ currentRevisionId: "not-even-a-uuid-but-non-empty" });

      expect(character.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createCharacter(ACTIVE_REQUIRED).changeStatus("published" as CharacterStatus, later);
          return null;
        } catch (error_) {
          return error_ as DomainError;
        }
      })();

      expect(error).toBeInstanceOf(DomainError);
      expect(error?.code).toBe(DomainErrorCode.DOMAIN_VALIDATION_FAILED);
    });
  });
});