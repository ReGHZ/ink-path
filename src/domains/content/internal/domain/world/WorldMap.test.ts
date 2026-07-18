import { describe, expect, it } from "vitest";

import { WorldMap, type WorldMapStatus } from "./WorldMap.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type WorldMapSnapshot = Parameters<typeof WorldMap.reconstitute>[0];

const baseSnapshot: WorldMapSnapshot = {
  id: "map-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  parentId: null,
  name: "Continent of Vael",
  scale: "1:100000",
  terrain: "mountainous",
  environment: "temperate",
  description: "The known world.",
  content: "Coastlines and trade routes.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createMap(overrides: Partial<Parameters<typeof WorldMap.create>[0]> = {}) {
  return WorldMap.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteMap(overrides: Partial<WorldMapSnapshot> = {}) {
  return WorldMap.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("WorldMap", () => {
  describe("create", () => {
    it("creates a draft map with normalized optional fields and null parent", () => {
      const map = createMap({
        scale: "  1:100000  ",
        terrain: "  mountainous  ",
        environment: "  temperate  ",
        description: "  The known world.  ",
        content: "  Coastlines and trade routes.  ",
      });

      expect(map.status).toBe("draft");
      expect(map.parentId).toBeNull();
      expect(map.scale).toBe("1:100000");
      expect(map.terrain).toBe("mountainous");
      expect(map.environment).toBe("temperate");
      expect(map.description).toBe("The known world.");
      expect(map.content).toBe("Coastlines and trade routes.");
      expect(map.createdAt).toEqual(now);
      expect(map.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional text fields to null", () => {
      const map = createMap({
        scale: "   ",
        terrain: "   ",
        environment: "   ",
        description: "   ",
        content: "   ",
      });

      expect(map.scale).toBeNull();
      expect(map.terrain).toBeNull();
      expect(map.environment).toBeNull();
      expect(map.description).toBeNull();
      expect(map.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const map = createMap();

      expect(map.parentId).toBeNull();
      expect(map.scale).toBeNull();
      expect(map.terrain).toBeNull();
      expect(map.environment).toBeNull();
      expect(map.description).toBeNull();
      expect(map.content).toBeNull();
    });

    it("normalizes a whitespace-only parent id to null", () => {
      const map = createMap({ parentId: "   " });

      expect(map.parentId).toBeNull();
    });

    it("stores a provided parent id", () => {
      const map = createMap({ parentId: "map-2" });

      expect(map.parentId).toBe("map-2");
    });

    it("trims the name before storing it", () => {
      const map = createMap({ name: "  Continent of Vael  " });

      expect(map.name).toBe("Continent of Vael");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createMap({ name: "   " })).toThrow(DomainError);
    });

    it("rejects the entity as its own parent", () => {
      expect(() => createMap({ parentId: baseSnapshot.id })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createMap({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createMap({ id: "  " })).toThrow(DomainError);
      expect(() => createMap({ projectId: "  " })).toThrow(DomainError);
      expect(() => createMap({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name, normalizes optional text fields, and returns true", () => {
      const map = createMap();

      const changed = map.updateDetails({
        name: "  Continent of Vael  ",
        scale: "  1:50000  ",
        terrain: "  coastal  ",
        environment: "  arid  ",
        description: "  Updated  ",
        content: "  New content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(map.name).toBe("Continent of Vael");
      expect(map.scale).toBe("1:50000");
      expect(map.terrain).toBe("coastal");
      expect(map.environment).toBe("arid");
      expect(map.description).toBe("Updated");
      expect(map.content).toBe("New content");
      expect(map.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const map = createMap({
        parentId: "map-2",
        scale: "1:100000",
        terrain: "mountainous",
        environment: "temperate",
        description: "Keep desc",
        content: "Keep content",
      });

      map.updateDetails({ name: "Renamed", now: later });

      expect(map.name).toBe("Renamed");
      expect(map.parentId).toBe("map-2");
      expect(map.scale).toBe("1:100000");
      expect(map.terrain).toBe("mountainous");
      expect(map.environment).toBe("temperate");
      expect(map.description).toBe("Keep desc");
      expect(map.content).toBe("Keep content");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const map = createMap({
        scale: "1:100000",
        terrain: "mountainous",
        environment: "temperate",
        description: "Desc",
        content: "Content",
      });

      map.updateDetails({
        name: "Continent of Vael",
        scale: null,
        terrain: null,
        environment: null,
        description: null,
        content: null,
        now: later,
      });

      expect(map.scale).toBeNull();
      expect(map.terrain).toBeNull();
      expect(map.environment).toBeNull();
      expect(map.description).toBeNull();
      expect(map.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const map = createMap({
        scale: "1:100000",
        terrain: "mountainous",
        environment: "temperate",
        description: "Desc",
        content: "Content",
      });

      map.updateDetails({
        scale: "   ",
        terrain: "   ",
        environment: "   ",
        description: "   ",
        content: "   ",
        now: later,
      });

      expect(map.scale).toBeNull();
      expect(map.terrain).toBeNull();
      expect(map.environment).toBeNull();
      expect(map.description).toBeNull();
      expect(map.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const map = createMap({ name: "Continent of Vael" });

      const changed = map.updateDetails({ name: "  Continent of Vael  ", now: later });

      expect(changed).toBe(false);
      expect(map.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new content is whitespace-equivalent", () => {
      const map = createMap({ content: "Coastlines and trade routes." });

      const changed = map.updateDetails({
        content: "  Coastlines and trade routes.  ",
        now: later,
      });

      expect(changed).toBe(false);
      expect(map.content).toBe("Coastlines and trade routes.");
      expect(map.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new description is whitespace-equivalent", () => {
      const map = createMap({ description: "The known world." });

      const changed = map.updateDetails({ description: "  The known world.  ", now: later });

      expect(changed).toBe(false);
      expect(map.description).toBe("The known world.");
      expect(map.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new scale is whitespace-equivalent", () => {
      const map = createMap({ scale: "1:100000" });

      const changed = map.updateDetails({ scale: "  1:100000  ", now: later });

      expect(changed).toBe(false);
      expect(map.scale).toBe("1:100000");
      expect(map.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new terrain is whitespace-equivalent", () => {
      const map = createMap({ terrain: "mountainous" });

      const changed = map.updateDetails({ terrain: "  mountainous  ", now: later });

      expect(changed).toBe(false);
      expect(map.terrain).toBe("mountainous");
      expect(map.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new environment is whitespace-equivalent", () => {
      const map = createMap({ environment: "temperate" });

      const changed = map.updateDetails({ environment: "  temperate  ", now: later });

      expect(changed).toBe(false);
      expect(map.environment).toBe("temperate");
      expect(map.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const map = createMap({ name: "Continent of Vael" });

      expect(() => map.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(map.name).toBe("Continent of Vael");
      expect(map.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on a published map rolls back content and updatedAt", () => {
      const map = reconstituteMap({ status: "published", content: "Body" });

      expect(() =>
        map.updateDetails({ name: "Continent of Vael", content: null, now: later }),
      ).toThrow(DomainError);

      expect(map.content).toBe("Body");
      expect(map.status).toBe("published");
      expect(map.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only content update on a published map rolls back", () => {
      const map = reconstituteMap({ status: "published", content: "Body" });

      expect(() =>
        map.updateDetails({ name: "Continent of Vael", content: "   ", now: later }),
      ).toThrow(DomainError);

      expect(map.content).toBe("Body");
      expect(map.updatedAt).toEqual(now);
    });

    it("allows clearing content while the map is a draft", () => {
      const map = createMap({ content: "Body" });

      map.updateDetails({ name: "Continent of Vael", content: null, now: later });

      expect(map.content).toBeNull();
      expect(map.status).toBe("draft");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to published and returns true when content is present", () => {
      const map = createMap({ content: "Body" });

      const changed = map.changeStatus("published", later);

      expect(changed).toBe(true);
      expect(map.status).toBe("published");
      expect(map.updatedAt).toEqual(later);
    });

    it("rejects draft to published when content is null", () => {
      const map = createMap({ content: null });

      expect(() => map.changeStatus("published", later)).toThrow(DomainError);
      expect(map.status).toBe("draft");
      expect(map.updatedAt).toEqual(now);
    });

    it("rejects draft to published when content is whitespace-only (normalized to null)", () => {
      const map = createMap({ content: "   " });

      expect(map.content).toBeNull();
      expect(() => map.changeStatus("published", later)).toThrow(DomainError);
      expect(map.status).toBe("draft");
    });

    it("transitions published back to draft (publish is a marker, not a one-way workflow)", () => {
      const map = reconstituteMap({ status: "published", content: "Body" });

      const changed = map.changeStatus("draft", later);

      expect(changed).toBe(true);
      expect(map.status).toBe("draft");
      expect(map.updatedAt).toEqual(later);
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createMap({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const published = reconstituteMap({ status: "published", content: "Body" });

      expect(published.changeStatus("published", later)).toBe(false);
      expect(published.status).toBe("published");
      expect(published.updatedAt).toEqual(now);
    });

    it("rejects an archived status (Map has no archived lifecycle)", () => {
      const map = createMap({ content: "Body" });

      expect(() => map.changeStatus("archived" as WorldMapStatus, later)).toThrow(DomainError);
      expect(map.status).toBe("draft");
      expect(map.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const map = reconstituteMap({
        name: "  raw name  ",
        scale: "  raw scale  ",
        terrain: "  raw terrain  ",
        environment: "  raw env  ",
        description: "  raw desc  ",
        content: "  raw content  ",
        parentId: "  raw-parent  ",
      });

      expect(map.name).toBe("  raw name  ");
      expect(map.scale).toBe("  raw scale  ");
      expect(map.terrain).toBe("  raw terrain  ");
      expect(map.environment).toBe("  raw env  ");
      expect(map.description).toBe("  raw desc  ");
      expect(map.content).toBe("  raw content  ");
      expect(map.parentId).toBe("  raw-parent  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteMap({ version: -1 })).toThrow(DomainError);
      expect(() => reconstituteMap({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() => reconstituteMap({ status: "bogus" as WorldMapStatus })).toThrow(DomainError);
    });

    it("rejects the entity as its own parent", () => {
      expect(() => reconstituteMap({ parentId: baseSnapshot.id })).toThrow(DomainError);
    });

    it("rejects a published snapshot with null content", () => {
      expect(() => reconstituteMap({ status: "published", content: null })).toThrow(DomainError);
    });

    it("rejects a published snapshot with whitespace-only content", () => {
      expect(() => reconstituteMap({ status: "published", content: "   " })).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteMap({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts a published snapshot with non-empty content", () => {
      const map = reconstituteMap({ status: "published", content: "Body" });

      expect(map.status).toBe("published");
      expect(map.content).toBe("Body");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const map = createMap({ parentId: "map-2", content: "Body" });
      const snapshot = map.toSnapshot();

      snapshot.name = "mutated";
      snapshot.parentId = null;
      snapshot.content = null;

      expect(map.name).toBe("Continent of Vael");
      expect(map.parentId).toBe("map-2");
      expect(map.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const map = reconstituteMap({ status: "published", content: "Body" });
      const snapshot = map.toSnapshot();
      const restored = WorldMap.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(map.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // currentRevisionId and parentId are opaque tokens. Cross-aggregate concerns
    // (revision ownership, parent existence, project match) are guaranteed by
    // construction in the Application Service / DB CHECK (maps_no_self_parent),
    // NOT by runtime entity checks. These tests pin the boundary.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const map = createMap({ currentRevisionId: "not-even-a-uuid-but-non-empty" });

      expect(map.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("accepts any non-self parent id without verifying existence or project match", () => {
      const map = createMap({ parentId: "map-totally-made-up" });

      expect(map.parentId).toBe("map-totally-made-up");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createMap({ content: null }).changeStatus("published", later);
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
          createMap({ parentId: baseSnapshot.id });
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