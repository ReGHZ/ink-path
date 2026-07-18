import { describe, expect, it } from "vitest";

import {
  Faction,
  type FactionStatus,
  type UpdateFactionDetailsProperties,
} from "./Faction.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type FactionSnapshot = Parameters<typeof Faction.reconstitute>[0];

const baseSnapshot: FactionSnapshot = {
  id: "faction-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  name: "The Cartographers' Guild",
  description: "A guild of mapmakers.",
  background: "Founded after the Sundering.",
  ideology: "Knowledge above borders.",
  size: "medium",
  content: "Detailed dossier.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

// The two fields a faction MUST have to enter the `active` lifecycle gate.
const ACTIVE_REQUIRED = {
  description: "A guild of mapmakers.",
  background: "Founded after the Sundering.",
} as const;

// The five optional normalized text fields of a Faction (everything
// `string | null` set via `normalizeOptionalText`). `name` is excluded — it is
// a required `string` trimmed, not normalized.
type FactionTextField =
  | "description"
  | "background"
  | "ideology"
  | "size"
  | "content";

function createFaction(overrides: Partial<Parameters<typeof Faction.create>[0]> = {}) {
  return Faction.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteFaction(overrides: Partial<FactionSnapshot> = {}) {
  return Faction.reconstitute({ ...baseSnapshot, ...overrides });
}

function createWithField(field: FactionTextField, value: string | null): Faction {
  switch (field) {
    case "description":
      return createFaction({ description: value });
    case "background":
      return createFaction({ background: value });
    case "ideology":
      return createFaction({ ideology: value });
    case "size":
      return createFaction({ size: value });
    case "content":
      return createFaction({ content: value });
  }
}

function updateField(
  faction: Faction,
  field: FactionTextField,
  value: string | null,
): boolean {
  const input: UpdateFactionDetailsProperties = { now: later };
  switch (field) {
    case "description":
      input.description = value;
      break;
    case "background":
      input.background = value;
      break;
    case "ideology":
      input.ideology = value;
      break;
    case "size":
      input.size = value;
      break;
    case "content":
      input.content = value;
      break;
  }
  return faction.updateDetails(input);
}

function getField(faction: Faction, field: FactionTextField): string | null {
  switch (field) {
    case "description":
      return faction.description;
    case "background":
      return faction.background;
    case "ideology":
      return faction.ideology;
    case "size":
      return faction.size;
    case "content":
      return faction.content;
  }
}

describe("Faction", () => {
  describe("create", () => {
    it("creates a draft faction regardless of how many optional fields are filled", () => {
      const faction = createFaction({
        description: "  A guild of mapmakers.  ",
        background: "  Founded after the Sundering.  ",
        ideology: "  Knowledge above borders.  ",
        size: "  medium  ",
        content: "  Detailed dossier.  ",
      });

      expect(faction.status).toBe("draft");
      expect(faction.description).toBe("A guild of mapmakers.");
      expect(faction.background).toBe("Founded after the Sundering.");
      expect(faction.ideology).toBe("Knowledge above borders.");
      expect(faction.size).toBe("medium");
      expect(faction.content).toBe("Detailed dossier.");
      expect(faction.createdAt).toEqual(now);
      expect(faction.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const faction = createFaction({
        description: "   ",
        background: "   ",
        ideology: "   ",
        size: "   ",
        content: "   ",
      });

      expect(faction.description).toBeNull();
      expect(faction.background).toBeNull();
      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const faction = createFaction();

      expect(faction.description).toBeNull();
      expect(faction.background).toBeNull();
      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
    });

    it("trims the name before storing it", () => {
      const faction = createFaction({ name: "  The Cartographers' Guild  " });

      expect(faction.name).toBe("The Cartographers' Guild");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createFaction({ name: "   " })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createFaction({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createFaction({ id: "  " })).toThrow(DomainError);
      expect(() => createFaction({ projectId: "  " })).toThrow(DomainError);
      expect(() => createFaction({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name, normalizes optional text fields, and returns true", () => {
      const faction = createFaction();

      const changed = faction.updateDetails({
        name: "  The Cartographers' Guild  ",
        description: "  Updated desc  ",
        background: "  Updated background  ",
        ideology: "  Updated ideology  ",
        size: "  large  ",
        content: "  New content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(faction.name).toBe("The Cartographers' Guild");
      expect(faction.description).toBe("Updated desc");
      expect(faction.background).toBe("Updated background");
      expect(faction.ideology).toBe("Updated ideology");
      expect(faction.size).toBe("large");
      expect(faction.content).toBe("New content");
      expect(faction.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const faction = createFaction({
        description: "D",
        background: "B",
        ideology: "I",
        size: "S",
        content: "C",
      });

      faction.updateDetails({ name: "Renamed", now: later });

      expect(faction.name).toBe("Renamed");
      expect(faction.description).toBe("D");
      expect(faction.background).toBe("B");
      expect(faction.ideology).toBe("I");
      expect(faction.size).toBe("S");
      expect(faction.content).toBe("C");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const faction = createFaction({
        description: "D",
        background: "B",
        ideology: "I",
        size: "S",
        content: "C",
      });

      faction.updateDetails({
        name: "The Cartographers' Guild",
        description: null,
        background: null,
        ideology: null,
        size: null,
        content: null,
        now: later,
      });

      expect(faction.description).toBeNull();
      expect(faction.background).toBeNull();
      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const faction = createFaction({
        description: "D",
        background: "B",
        ideology: "I",
        size: "S",
        content: "C",
      });

      faction.updateDetails({
        description: "   ",
        background: "   ",
        ideology: "   ",
        size: "   ",
        content: "   ",
        now: later,
      });

      expect(faction.description).toBeNull();
      expect(faction.background).toBeNull();
      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const faction = createFaction({ name: "The Cartographers' Guild" });

      const changed = faction.updateDetails({ name: "The Cartographers' Guild", now: later });

      expect(changed).toBe(false);
      expect(faction.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new name is whitespace-equivalent", () => {
      const faction = createFaction({ name: "The Cartographers' Guild" });

      const changed = faction.updateDetails({
        name: "  The Cartographers' Guild  ",
        now: later,
      });

      expect(changed).toBe(false);
      expect(faction.name).toBe("The Cartographers' Guild");
      expect(faction.updatedAt).toEqual(now);
    });

    it.each([
      "description",
      "background",
      "ideology",
      "size",
      "content",
    ] as const)(
      "returns false and does NOT bump updatedAt when the new %s is whitespace-equivalent",
      (field) => {
        const current = "seeded value";
        const faction = createWithField(field, current);

        const changed = updateField(faction, field, `  ${current}  `);

        expect(changed).toBe(false);
        expect(getField(faction, field)).toBe(current);
        expect(faction.updatedAt).toEqual(now);
      },
    );

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const faction = createFaction({ name: "The Cartographers' Guild" });

      expect(() => faction.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(faction.name).toBe("The Cartographers' Guild");
      expect(faction.updatedAt).toEqual(now);
    });

    it.each([
      "description",
      "background",
    ] as const)(
      "is atomic: clearing %s on an active faction rolls back the field, status, and updatedAt",
      (field) => {
        const faction = reconstituteFaction({
          status: "active",
          ...ACTIVE_REQUIRED,
        });

        const before = getField(faction, field);

        expect(() => updateField(faction, field, null)).toThrow(DomainError);

        expect(getField(faction, field)).toBe(before);
        expect(faction.status).toBe("active");
        expect(faction.updatedAt).toEqual(now);
      },
    );

    it("is atomic: a whitespace-only update of an active-required field on an active faction rolls back", () => {
      const faction = reconstituteFaction({ status: "active", ...ACTIVE_REQUIRED });

      expect(() =>
        faction.updateDetails({ name: "The Cartographers' Guild", description: "   ", now: later }),
      ).toThrow(DomainError);

      expect(faction.description).toBe(ACTIVE_REQUIRED.description);
      expect(faction.status).toBe("active");
      expect(faction.updatedAt).toEqual(now);
    });

    it("allows clearing an active-required field while the faction is a draft", () => {
      const faction = createFaction({ description: "D", background: "B" });

      faction.updateDetails({
        name: "The Cartographers' Guild",
        description: null,
        background: null,
        now: later,
      });

      expect(faction.description).toBeNull();
      expect(faction.background).toBeNull();
      expect(faction.status).toBe("draft");
    });

    it("allows clearing a non-required field (ideology/size/content) on an active faction", () => {
      const faction = reconstituteFaction({
        status: "active",
        ...ACTIVE_REQUIRED,
        ideology: "I",
        size: "S",
        content: "C",
      });

      faction.updateDetails({
        name: "The Cartographers' Guild",
        ideology: null,
        size: null,
        content: null,
        now: later,
      });

      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
      expect(faction.status).toBe("active");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to active and returns true when the two required fields are present", () => {
      const faction = createFaction(ACTIVE_REQUIRED);

      const changed = faction.changeStatus("active", later);

      expect(changed).toBe(true);
      expect(faction.status).toBe("active");
      expect(faction.updatedAt).toEqual(later);
    });

    it.each([
      ["description", { background: "B" }],
      ["background", { description: "D" }],
    ] as const)(
      "rejects draft to active when %s is null",
      (missing, others) => {
        const faction = createFaction({ ...others, [missing]: null });

        expect(() => faction.changeStatus("active", later)).toThrow(DomainError);
        expect(faction.status).toBe("draft");
        expect(faction.updatedAt).toEqual(now);
      },
    );

    it.each([
      ["description", { background: "B" }],
      ["background", { description: "D" }],
    ] as const)(
      "rejects draft to active when %s is whitespace-only (normalized to null)",
      (missing, others) => {
        const faction = createFaction({ ...others, [missing]: "   " });

        expect(() => faction.changeStatus("active", later)).toThrow(DomainError);
        expect(faction.status).toBe("draft");
      },
    );

    it("allows draft to active when ideology, size, and content are null (not required for active)", () => {
      const faction = createFaction({ ...ACTIVE_REQUIRED, ideology: null, size: null, content: null });

      expect(faction.changeStatus("active", later)).toBe(true);
      expect(faction.status).toBe("active");
    });

    it("transitions active to archived (active completeness no longer enforced while archived)", () => {
      const faction = reconstituteFaction({ status: "active", ...ACTIVE_REQUIRED });

      expect(faction.changeStatus("archived", later)).toBe(true);
      expect(faction.status).toBe("archived");
    });

    it("transitions active back to draft", () => {
      const faction = reconstituteFaction({ status: "active", ...ACTIVE_REQUIRED });

      expect(faction.changeStatus("draft", later)).toBe(true);
      expect(faction.status).toBe("draft");
    });

    it("transitions archived back to draft (no terminal-archived restriction at entity level)", () => {
      const faction = reconstituteFaction({
        status: "archived",
        description: null,
        background: null,
      });

      expect(faction.changeStatus("draft", later)).toBe(true);
      expect(faction.status).toBe("draft");
    });

    it("rejects archived to active when an active-required field is null (invariant is state-based, not transition-based)", () => {
      const faction = reconstituteFaction({
        status: "archived",
        description: null,
        background: "B",
      });

      expect(() => faction.changeStatus("active", later)).toThrow(DomainError);
      expect(faction.status).toBe("archived");
      expect(faction.updatedAt).toEqual(now);
    });

    it("allows archived to active when both active-required fields are present", () => {
      const faction = reconstituteFaction({ status: "archived", ...ACTIVE_REQUIRED });

      expect(faction.changeStatus("active", later)).toBe(true);
      expect(faction.status).toBe("active");
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createFaction();

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const active = reconstituteFaction({ status: "active", ...ACTIVE_REQUIRED });

      expect(active.changeStatus("active", later)).toBe(false);
      expect(active.status).toBe("active");
      expect(active.updatedAt).toEqual(now);

      const archived = reconstituteFaction({ status: "archived", ...ACTIVE_REQUIRED });

      expect(archived.changeStatus("archived", later)).toBe(false);
      expect(archived.status).toBe("archived");
      expect(archived.updatedAt).toEqual(now);
    });

    it("rejects a status outside the faction lifecycle (no published status)", () => {
      const faction = createFaction(ACTIVE_REQUIRED);

      expect(() => faction.changeStatus("published" as FactionStatus, later)).toThrow(
        DomainError,
      );
      expect(faction.status).toBe("draft");
      expect(faction.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const faction = reconstituteFaction({
        name: "  raw name  ",
        description: "  raw desc  ",
        background: "  raw background  ",
        ideology: "  raw ideology  ",
        size: "  raw size  ",
        content: "  raw content  ",
      });

      expect(faction.name).toBe("  raw name  ");
      expect(faction.description).toBe("  raw desc  ");
      expect(faction.background).toBe("  raw background  ");
      expect(faction.ideology).toBe("  raw ideology  ");
      expect(faction.size).toBe("  raw size  ");
      expect(faction.content).toBe("  raw content  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteFaction({ version: -1 })).toThrow(DomainError);
      expect(() => reconstituteFaction({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() => reconstituteFaction({ status: "published" as FactionStatus })).toThrow(
        DomainError,
      );
    });

    it.each([
      ["description", { background: "B" }],
      ["background", { description: "D" }],
    ] as const)(
      "rejects an active snapshot when %s is null",
      (missing, others) => {
        expect(() =>
          reconstituteFaction({ status: "active", ...others, [missing]: null }),
        ).toThrow(DomainError);
      },
    );

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteFaction({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts an active snapshot with both required fields (ideology/size/content may be null)", () => {
      const faction = reconstituteFaction({
        status: "active",
        ...ACTIVE_REQUIRED,
        ideology: null,
        size: null,
        content: null,
      });

      expect(faction.status).toBe("active");
      expect(faction.ideology).toBeNull();
      expect(faction.size).toBeNull();
      expect(faction.content).toBeNull();
    });

    it("accepts a draft snapshot with no required fields filled (completeness only enforced at active)", () => {
      const faction = reconstituteFaction({
        status: "draft",
        description: null,
        background: null,
      });

      expect(faction.status).toBe("draft");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const faction = createFaction({ content: "Body" });
      const snapshot = faction.toSnapshot();

      snapshot.name = "mutated";
      snapshot.content = null;

      expect(faction.name).toBe("The Cartographers' Guild");
      expect(faction.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const faction = reconstituteFaction({ status: "active", ...ACTIVE_REQUIRED });
      const snapshot = faction.toSnapshot();
      const restored = Faction.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(faction.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // currentRevisionId is an opaque established-aggregate token. The entity must
    // NOT verify cross-aggregate ownership — that is guaranteed by construction in
    // the Application Service. This test pins the boundary.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const faction = createFaction({ currentRevisionId: "not-even-a-uuid-but-non-empty" });

      expect(faction.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createFaction(ACTIVE_REQUIRED).changeStatus("published" as FactionStatus, later);
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