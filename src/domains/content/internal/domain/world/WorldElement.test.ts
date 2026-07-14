import { describe, expect, it } from "vitest";

import { WorldElement, type WorldElementStatus } from "./WorldElement.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type WorldElementSnapshot = Parameters<typeof WorldElement.reconstitute>[0];

const baseSnapshot: WorldElementSnapshot = {
  id: "world-1",
  projectId: "project-1",
  createdByUserId: "user-1",
  name: "Dragon Range",
  description: "A mountain range",
  category: "geography",
  content: "Spans the eastern continent.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createElement(overrides: Partial<Parameters<typeof WorldElement.create>[0]> = {}) {
  return WorldElement.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    category: baseSnapshot.category,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteElement(overrides: Partial<WorldElementSnapshot> = {}) {
  return WorldElement.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("WorldElement", () => {
  describe("create", () => {
    it("creates a draft world element with normalized optional fields", () => {
      const element = createElement({
        description: "  A mountain range  ",
        content: "  Spans the eastern continent.  ",
      });

      expect(element.status).toBe("draft");
      expect(element.description).toBe("A mountain range");
      expect(element.content).toBe("Spans the eastern continent.");
      expect(element.createdAt).toEqual(now);
      expect(element.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const element = createElement({ description: "   ", content: "   " });

      expect(element.description).toBeNull();
      expect(element.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const element = createElement();

      expect(element.description).toBeNull();
      expect(element.content).toBeNull();
    });

    it("trims the name and category before storing them", () => {
      const element = createElement({
        name: "  Dragon Range  ",
        category: "  geography  ",
      });

      expect(element.name).toBe("Dragon Range");
      expect(element.category).toBe("geography");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createElement({ name: "   " })).toThrow(DomainError);
    });

    it("rejects a whitespace-only category", () => {
      expect(() => createElement({ category: "   " })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createElement({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createElement({ id: "  " })).toThrow(DomainError);
      expect(() => createElement({ projectId: "  " })).toThrow(DomainError);
      expect(() => createElement({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name and category, normalizes optional text fields, and returns true", () => {
      const element = createElement();

      const changed = element.updateDetails({
        name: "  Dragon Range  ",
        description: "  Updated  ",
        category: "  landmark  ",
        content: "  New content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(element.name).toBe("Dragon Range");
      expect(element.description).toBe("Updated");
      expect(element.category).toBe("landmark");
      expect(element.content).toBe("New content");
      expect(element.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const element = createElement({
        description: "Keep desc",
        category: "geography",
        content: "Keep content",
      });

      element.updateDetails({ name: "Renamed", now: later });

      expect(element.name).toBe("Renamed");
      expect(element.description).toBe("Keep desc");
      expect(element.category).toBe("geography");
      expect(element.content).toBe("Keep content");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const element = createElement({ description: "Desc", content: "Content" });

      element.updateDetails({
        name: "Dragon Range",
        description: null,
        content: null,
        now: later,
      });

      expect(element.description).toBeNull();
      expect(element.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const element = createElement({ description: "Desc", content: "Content" });

      element.updateDetails({
        description: "   ",
        content: "   ",
        now: later,
      });

      expect(element.description).toBeNull();
      expect(element.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const element = createElement({ name: "Dragon Range", category: "geography" });

      const changed = element.updateDetails({
        name: "  Dragon Range  ",
        category: "geography",
        now: later,
      });

      expect(changed).toBe(false);
      expect(element.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new description is whitespace-equivalent", () => {
      const element = createElement({ description: "A mountain range" });

      const changed = element.updateDetails({ description: "  A mountain range  ", now: later });

      expect(changed).toBe(false);
      expect(element.description).toBe("A mountain range");
      expect(element.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new content is whitespace-equivalent", () => {
      const element = createElement({ content: "Spans the eastern continent." });

      const changed = element.updateDetails({ content: "  Spans the eastern continent.  ", now: later });

      expect(changed).toBe(false);
      expect(element.content).toBe("Spans the eastern continent.");
      expect(element.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new category is whitespace-equivalent", () => {
      const element = createElement({ category: "geography" });

      const changed = element.updateDetails({ category: "  geography  ", now: later });

      expect(changed).toBe(false);
      expect(element.category).toBe("geography");
      expect(element.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const element = createElement({ name: "Dragon Range" });

      expect(() => element.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(element.name).toBe("Dragon Range");
      expect(element.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on a published element rolls back content and updatedAt", () => {
      const element = reconstituteElement({ status: "published", content: "Body" });

      expect(() =>
        element.updateDetails({ name: "Dragon Range", content: null, now: later }),
      ).toThrow(DomainError);

      expect(element.content).toBe("Body");
      expect(element.status).toBe("published");
      expect(element.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only content update on a published element rolls back", () => {
      const element = reconstituteElement({ status: "published", content: "Body" });

      expect(() =>
        element.updateDetails({ name: "Dragon Range", content: "   ", now: later }),
      ).toThrow(DomainError);

      expect(element.content).toBe("Body");
      expect(element.updatedAt).toEqual(now);
    });

    it("allows clearing content while the element is a draft", () => {
      const element = createElement({ content: "Body" });

      element.updateDetails({ name: "Dragon Range", content: null, now: later });

      expect(element.content).toBeNull();
      expect(element.status).toBe("draft");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to published and returns true when content is present", () => {
      const element = createElement({ content: "Body" });

      const changed = element.changeStatus("published", later);

      expect(changed).toBe(true);
      expect(element.status).toBe("published");
      expect(element.updatedAt).toEqual(later);
    });

    it("rejects draft to published when content is null", () => {
      const element = createElement({ content: null });

      expect(() => element.changeStatus("published", later)).toThrow(DomainError);
      expect(element.status).toBe("draft");
      expect(element.updatedAt).toEqual(now);
    });

    it("rejects draft to published when content is whitespace-only (normalized to null)", () => {
      const element = createElement({ content: "   " });

      expect(element.content).toBeNull();
      expect(() => element.changeStatus("published", later)).toThrow(DomainError);
      expect(element.status).toBe("draft");
    });

    it("transitions published back to draft (publish is a marker, not a one-way workflow)", () => {
      const element = reconstituteElement({ status: "published", content: "Body" });

      const changed = element.changeStatus("draft", later);

      expect(changed).toBe(true);
      expect(element.status).toBe("draft");
      expect(element.updatedAt).toEqual(later);
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createElement({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const published = reconstituteElement({ status: "published", content: "Body" });

      expect(published.changeStatus("published", later)).toBe(false);
      expect(published.status).toBe("published");
      expect(published.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const element = reconstituteElement({
        name: "  raw name  ",
        category: "  raw category  ",
        description: "  raw desc  ",
        content: "  raw content  ",
      });

      expect(element.name).toBe("  raw name  ");
      expect(element.category).toBe("  raw category  ");
      expect(element.description).toBe("  raw desc  ");
      expect(element.content).toBe("  raw content  ");
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteElement({ status: "archived" as WorldElementStatus }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with null content", () => {
      expect(() =>
        reconstituteElement({ status: "published", content: null }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with whitespace-only content", () => {
      expect(() =>
        reconstituteElement({ status: "published", content: "   " }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteElement({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts a published snapshot with non-empty content", () => {
      const element = reconstituteElement({ status: "published", content: "Body" });

      expect(element.status).toBe("published");
      expect(element.content).toBe("Body");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const element = createElement({ content: "Body" });
      const snapshot = element.toSnapshot();

      snapshot.name = "mutated";
      snapshot.content = null;

      expect(element.name).toBe("Dragon Range");
      expect(element.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const element = reconstituteElement({ status: "published", content: "Body" });
      const snapshot = element.toSnapshot();
      const restored = WorldElement.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(element.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The entity treats currentRevisionId as an opaque established-aggregate token.
    // Per the phase-4 improvement rule, the entity must NOT verify cross-aggregate
    // ownership (that revision belongs to this entity) — that is guaranteed by
    // construction in the Application Service. This test pins the boundary: any
    // non-empty string is accepted, with no relation check.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const element = createElement({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(element.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createElement({ content: null }).changeStatus("published", later);
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