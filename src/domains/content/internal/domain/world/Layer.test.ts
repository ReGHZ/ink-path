import { describe, expect, it } from "vitest";

import { Layer, type LayerExposure, type LayerStatus } from "./Layer.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type LayerSnapshot = Parameters<typeof Layer.reconstitute>[0];

const baseSnapshot: LayerSnapshot = {
  id: "layer-1",
  projectId: "project-1",
  createdByUserId: "user-1",
  parentId: null,
  name: "Surface World",
  level: 1,
  exposure: "internal_only",
  description: "Top of the hierarchy",
  content: "The visible world.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createLayer(overrides: Partial<Parameters<typeof Layer.create>[0]> = {}) {
  return Layer.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    level: baseSnapshot.level,
    exposure: baseSnapshot.exposure,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteLayer(overrides: Partial<LayerSnapshot> = {}) {
  return Layer.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("Layer", () => {
  describe("create", () => {
    it("creates a draft layer with normalized optional fields and null parent", () => {
      const layer = createLayer({
        description: "  Top of the hierarchy  ",
        content: "  The visible world.  ",
      });

      expect(layer.status).toBe("draft");
      expect(layer.parentId).toBeNull();
      expect(layer.description).toBe("Top of the hierarchy");
      expect(layer.content).toBe("The visible world.");
      expect(layer.createdAt).toEqual(now);
      expect(layer.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional text fields to null", () => {
      const layer = createLayer({ description: "   ", content: "   " });

      expect(layer.description).toBeNull();
      expect(layer.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const layer = createLayer();

      expect(layer.parentId).toBeNull();
      expect(layer.description).toBeNull();
      expect(layer.content).toBeNull();
    });

    it("normalizes a whitespace-only parent id to null", () => {
      const layer = createLayer({ parentId: "   " });

      expect(layer.parentId).toBeNull();
    });

    it("stores a provided parent id", () => {
      const layer = createLayer({ parentId: "layer-2" });

      expect(layer.parentId).toBe("layer-2");
    });

    it("trims the name and stores level and exposure verbatim", () => {
      const layer = createLayer({
        name: "  Surface World  ",
        level: 3,
        exposure: "reader_visible",
      });

      expect(layer.name).toBe("Surface World");
      expect(layer.level).toBe(3);
      expect(layer.exposure).toBe("reader_visible");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createLayer({ name: "   " })).toThrow(DomainError);
    });

    it("rejects a level that is not greater than zero", () => {
      expect(() => createLayer({ level: 0 })).toThrow(DomainError);
      expect(() => createLayer({ level: -1 })).toThrow(DomainError);
    });

    it("rejects the entity as its own parent", () => {
      expect(() => createLayer({ parentId: baseSnapshot.id })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createLayer({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createLayer({ id: "  " })).toThrow(DomainError);
      expect(() => createLayer({ projectId: "  " })).toThrow(DomainError);
      expect(() => createLayer({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name, updates level/exposure, normalizes text fields, and returns true", () => {
      const layer = createLayer();

      const changed = layer.updateDetails({
        name: "  Underworld  ",
        level: 2,
        exposure: "character_aware",
        description: "  Updated  ",
        content: "  New content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(layer.name).toBe("Underworld");
      expect(layer.level).toBe(2);
      expect(layer.exposure).toBe("character_aware");
      expect(layer.description).toBe("Updated");
      expect(layer.content).toBe("New content");
      expect(layer.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const layer = createLayer({
        parentId: "layer-2",
        level: 2,
        exposure: "character_aware",
        description: "Keep desc",
        content: "Keep content",
      });

      layer.updateDetails({ name: "Renamed", now: later });

      expect(layer.name).toBe("Renamed");
      expect(layer.parentId).toBe("layer-2");
      expect(layer.level).toBe(2);
      expect(layer.exposure).toBe("character_aware");
      expect(layer.description).toBe("Keep desc");
      expect(layer.content).toBe("Keep content");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const layer = createLayer({ description: "Desc", content: "Content" });

      layer.updateDetails({
        name: "Surface World",
        description: null,
        content: null,
        now: later,
      });

      expect(layer.description).toBeNull();
      expect(layer.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const layer = createLayer({ description: "Desc", content: "Content" });

      layer.updateDetails({ description: "   ", content: "   ", now: later });

      expect(layer.description).toBeNull();
      expect(layer.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const layer = createLayer({ name: "Surface World", level: 1 });

      const changed = layer.updateDetails({
        name: "  Surface World  ",
        level: 1,
        now: later,
      });

      expect(changed).toBe(false);
      expect(layer.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new description is whitespace-equivalent", () => {
      const layer = createLayer({ description: "Top of the hierarchy" });

      const changed = layer.updateDetails({ description: "  Top of the hierarchy  ", now: later });

      expect(changed).toBe(false);
      expect(layer.description).toBe("Top of the hierarchy");
      expect(layer.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new content is whitespace-equivalent", () => {
      const layer = createLayer({ content: "The visible world." });

      const changed = layer.updateDetails({ content: "  The visible world.  ", now: later });

      expect(changed).toBe(false);
      expect(layer.content).toBe("The visible world.");
      expect(layer.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const layer = createLayer({ name: "Surface World" });

      expect(() => layer.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(layer.name).toBe("Surface World");
      expect(layer.updatedAt).toEqual(now);
    });

    it("is atomic: an invalid level rolls back level and updatedAt", () => {
      const layer = createLayer({ level: 1 });

      expect(() => layer.updateDetails({ level: 0, now: later })).toThrow(DomainError);

      expect(layer.level).toBe(1);
      expect(layer.updatedAt).toEqual(now);
    });

    it("is atomic: an invalid exposure rolls back exposure and updatedAt", () => {
      const layer = createLayer({ exposure: "internal_only" });

      expect(() =>
        layer.updateDetails({ exposure: "bogus" as LayerExposure, now: later }),
      ).toThrow(DomainError);

      expect(layer.exposure).toBe("internal_only");
      expect(layer.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on a published layer rolls back content and updatedAt", () => {
      const layer = reconstituteLayer({ status: "published", content: "Body" });

      expect(() =>
        layer.updateDetails({ name: "Surface World", content: null, now: later }),
      ).toThrow(DomainError);

      expect(layer.content).toBe("Body");
      expect(layer.status).toBe("published");
      expect(layer.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only content update on a published layer rolls back", () => {
      const layer = reconstituteLayer({ status: "published", content: "Body" });

      expect(() =>
        layer.updateDetails({ name: "Surface World", content: "   ", now: later }),
      ).toThrow(DomainError);

      expect(layer.content).toBe("Body");
      expect(layer.updatedAt).toEqual(now);
    });

    it("allows clearing content while the layer is a draft", () => {
      const layer = createLayer({ content: "Body" });

      layer.updateDetails({ name: "Surface World", content: null, now: later });

      expect(layer.content).toBeNull();
      expect(layer.status).toBe("draft");
    });

    it("permits updates on an archived layer (no archived guard — status is a marker)", () => {
      // The entity intentionally has no ensureNotArchived guard, mirroring the phase-4
      // stance that status is a state marker, not a workflow gate. This pins current
      // behavior; revisit if archived is later meant to freeze the layer.
      const layer = reconstituteLayer({ status: "archived", content: null });

      const changed = layer.updateDetails({ name: "Renamed", now: later });

      expect(changed).toBe(true);
      expect(layer.name).toBe("Renamed");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to published and returns true when content is present", () => {
      const layer = createLayer({ content: "Body" });

      const changed = layer.changeStatus("published", later);

      expect(changed).toBe(true);
      expect(layer.status).toBe("published");
      expect(layer.updatedAt).toEqual(later);
    });

    it("rejects draft to published when content is null", () => {
      const layer = createLayer({ content: null });

      expect(() => layer.changeStatus("published", later)).toThrow(DomainError);
      expect(layer.status).toBe("draft");
      expect(layer.updatedAt).toEqual(now);
    });

    it("rejects draft to published when content is whitespace-only (normalized to null)", () => {
      const layer = createLayer({ content: "   " });

      expect(layer.content).toBeNull();
      expect(() => layer.changeStatus("published", later)).toThrow(DomainError);
      expect(layer.status).toBe("draft");
    });

    it("transitions draft to archived (archived needs no content)", () => {
      const layer = createLayer({ content: null });

      const changed = layer.changeStatus("archived", later);

      expect(changed).toBe(true);
      expect(layer.status).toBe("archived");
      expect(layer.content).toBeNull();
    });

    it("transitions published to archived", () => {
      const layer = reconstituteLayer({ status: "published", content: "Body" });

      expect(layer.changeStatus("archived", later)).toBe(true);
      expect(layer.status).toBe("archived");
    });

    it("transitions published back to draft", () => {
      const layer = reconstituteLayer({ status: "published", content: "Body" });

      expect(layer.changeStatus("draft", later)).toBe(true);
      expect(layer.status).toBe("draft");
      expect(layer.content).toBe("Body");
    });

    it("transitions archived back to draft (no terminal-archived restriction)", () => {
      const layer = reconstituteLayer({ status: "archived", content: null });

      expect(layer.changeStatus("draft", later)).toBe(true);
      expect(layer.status).toBe("draft");
    });

    it("rejects archived to published when content is null", () => {
      const layer = reconstituteLayer({ status: "archived", content: null });

      expect(() => layer.changeStatus("published", later)).toThrow(DomainError);
      expect(layer.status).toBe("archived");
    });

    it("allows archived to published when content is present", () => {
      const layer = reconstituteLayer({ status: "archived", content: "Body" });

      expect(layer.changeStatus("published", later)).toBe(true);
      expect(layer.status).toBe("published");
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createLayer({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const archived = reconstituteLayer({ status: "archived", content: null });

      expect(archived.changeStatus("archived", later)).toBe(false);
      expect(archived.status).toBe("archived");
      expect(archived.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const layer = reconstituteLayer({
        name: "  raw name  ",
        description: "  raw desc  ",
        content: "  raw content  ",
        parentId: "  raw-parent  ",
      });

      expect(layer.name).toBe("  raw name  ");
      expect(layer.description).toBe("  raw desc  ");
      expect(layer.content).toBe("  raw content  ");
      expect(layer.parentId).toBe("  raw-parent  ");
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteLayer({ status: "bogus" as LayerStatus }),
      ).toThrow(DomainError);
    });

    it("rejects an invalid exposure", () => {
      expect(() =>
        reconstituteLayer({ exposure: "bogus" as LayerExposure }),
      ).toThrow(DomainError);
    });

    it("rejects a level that is not greater than zero", () => {
      expect(() => reconstituteLayer({ level: 0 })).toThrow(DomainError);
      expect(() => reconstituteLayer({ level: -2 })).toThrow(DomainError);
    });

    it("rejects the entity as its own parent", () => {
      expect(() => reconstituteLayer({ parentId: baseSnapshot.id })).toThrow(DomainError);
    });

    it("rejects a published snapshot with null content", () => {
      expect(() =>
        reconstituteLayer({ status: "published", content: null }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with whitespace-only content", () => {
      expect(() =>
        reconstituteLayer({ status: "published", content: "   " }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteLayer({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts an archived snapshot with null content", () => {
      const layer = reconstituteLayer({ status: "archived", content: null });

      expect(layer.status).toBe("archived");
      expect(layer.content).toBeNull();
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const layer = createLayer({ parentId: "layer-2", content: "Body" });
      const snapshot = layer.toSnapshot();

      snapshot.name = "mutated";
      snapshot.parentId = null;
      snapshot.content = null;

      expect(layer.name).toBe("Surface World");
      expect(layer.parentId).toBe("layer-2");
      expect(layer.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const layer = reconstituteLayer({ status: "published", content: "Body" });
      const snapshot = layer.toSnapshot();
      const restored = Layer.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(layer.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The entity treats currentRevisionId and parentId as opaque tokens. Per the
    // phase-4 improvement rule, cross-aggregate concerns are guaranteed by
    // construction in the Application Service / DB CHECK, NOT by runtime entity
    // checks. These tests pin the boundary.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const layer = createLayer({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(layer.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("accepts any non-self parent id without verifying existence or project match", () => {
      const layer = createLayer({ parentId: "layer-totally-made-up" });

      expect(layer.parentId).toBe("layer-totally-made-up");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createLayer({ content: null }).changeStatus("published", later);
          return null;
        } catch (error_) {
          return error_ as DomainError;
        }
      })();

      expect(error).toBeInstanceOf(DomainError);
      expect(error?.code).toBe(DomainErrorCode.DOMAIN_VALIDATION_FAILED);
    });

    it("rejects a self-parent with the neutral domain-validation code", () => {
      const error = (() => {
        try {
          createLayer({ parentId: baseSnapshot.id });
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