import { describe, expect, it } from "vitest";

import {
  ContentRevision,
  type ContentEntityType,
  type ContentRevisionChangeType,
  type CreateContentRevisionProperties,
} from "./ContentRevision.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");

const projectId = "project-1";
const entityId = "world-element-1";
const changedByUserId = "user-1";

type ContentRevisionSnapshot = Parameters<typeof ContentRevision.reconstitute>[0];

type CreateVariant = Extract<CreateContentRevisionProperties, { changeType: "create" }>;
type UpdateVariant = Extract<CreateContentRevisionProperties, { changeType: "update" }>;
type DeleteVariant = Extract<CreateContentRevisionProperties, { changeType: "delete" }>;

const baseReconstituteSnapshot: ContentRevisionSnapshot = {
  id: "revision-1",
  projectId,
  entityType: "world_element",
  entityId,
  revisionNumber: 0,
  changedByUserId,
  changeType: "create",
  summary: null,
  reason: null,
  beforeSnapshot: null,
  afterSnapshot: { name: "Dragon Range" },
  createdAt: now,
};

function createCreateRevision(overrides: Partial<Omit<CreateVariant, "changeType">> = {}) {
  return ContentRevision.create({
    id: "revision-1",
    projectId,
    entityType: "world_element",
    entityId,
    revisionNumber: 0,
    changedByUserId,
    changeType: "create",
    afterSnapshot: { name: "Dragon Range" },
    now,
    ...overrides,
  });
}

function createUpdateRevision(overrides: Partial<Omit<UpdateVariant, "changeType">> = {}) {
  return ContentRevision.create({
    id: "revision-2",
    projectId,
    entityType: "world_element",
    entityId,
    revisionNumber: 1,
    changedByUserId,
    changeType: "update",
    beforeSnapshot: { name: "Old name" },
    afterSnapshot: { name: "New name" },
    now,
    ...overrides,
  });
}

function createDeleteRevision(overrides: Partial<Omit<DeleteVariant, "changeType">> = {}) {
  return ContentRevision.create({
    id: "revision-3",
    projectId,
    entityType: "world_element",
    entityId,
    revisionNumber: 2,
    changedByUserId,
    changeType: "delete",
    beforeSnapshot: { name: "Final name" },
    now,
    ...overrides,
  });
}

function reconstituteRevision(overrides: Partial<ContentRevisionSnapshot> = {}) {
  return ContentRevision.reconstitute({ ...baseReconstituteSnapshot, ...overrides });
}

describe("ContentRevision", () => {
  describe("create", () => {
    it("creates a 'create' revision with a null before snapshot and set after snapshot", () => {
      const revision = createCreateRevision();

      expect(revision.changeType).toBe("create");
      expect(revision.beforeSnapshot).toBeNull();
      expect(revision.afterSnapshot).toEqual({ name: "Dragon Range" });
      expect(revision.createdAt).toEqual(now);
    });

    it("creates an 'update' revision with both snapshots set", () => {
      const revision = createUpdateRevision();

      expect(revision.changeType).toBe("update");
      expect(revision.beforeSnapshot).toEqual({ name: "Old name" });
      expect(revision.afterSnapshot).toEqual({ name: "New name" });
    });

    it("creates a 'delete' revision with a set before snapshot and a null after snapshot", () => {
      const revision = createDeleteRevision();

      expect(revision.changeType).toBe("delete");
      expect(revision.beforeSnapshot).toEqual({ name: "Final name" });
      expect(revision.afterSnapshot).toBeNull();
    });

    it("normalizes summary and reason, collapsing whitespace-only text to null", () => {
      const revision = createCreateRevision({
        summary: "  Initial creation  ",
        reason: "   ",
      });

      expect(revision.summary).toBe("Initial creation");
      expect(revision.reason).toBeNull();
    });

    it("treats omitted summary and reason as null", () => {
      const revision = createCreateRevision();

      expect(revision.summary).toBeNull();
      expect(revision.reason).toBeNull();
    });

    it("rejects an empty id, project id, entity id, or changed-by user id", () => {
      expect(() => createCreateRevision({ id: "  " })).toThrow(DomainError);
      expect(() => createCreateRevision({ projectId: "  " })).toThrow(DomainError);
      expect(() => createCreateRevision({ entityId: "  " })).toThrow(DomainError);
      expect(() => createCreateRevision({ changedByUserId: "  " })).toThrow(DomainError);
    });

    it("rejects a negative or non-integer revision number", () => {
      expect(() => createCreateRevision({ revisionNumber: -1 })).toThrow(DomainError);
      expect(() => createCreateRevision({ revisionNumber: 1.5 })).toThrow(DomainError);
    });

    it("rejects an entity type outside the allowed closed set", () => {
      expect(() =>
        createCreateRevision({
          entityType: "not_a_real_entity" as ContentEntityType,
        }),
      ).toThrow(DomainError);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted summary and reason", () => {
      const revision = reconstituteRevision({
        summary: "  raw summary  ",
        reason: "  raw reason  ",
      });

      expect(revision.summary).toBe("  raw summary  ");
      expect(revision.reason).toBe("  raw reason  ");
    });

    it("rejects a negative or non-integer revision number", () => {
      expect(() => reconstituteRevision({ revisionNumber: -1 })).toThrow(DomainError);
      expect(() => reconstituteRevision({ revisionNumber: 1.5 })).toThrow(DomainError);
    });

    it("rejects an entity type outside the allowed closed set", () => {
      expect(() =>
        reconstituteRevision({ entityType: "not_a_real_entity" as ContentEntityType }),
      ).toThrow(DomainError);
    });

    it("rejects a change type outside the allowed closed set", () => {
      expect(() =>
        reconstituteRevision({
          changeType: "archive" as ContentRevisionChangeType,
          beforeSnapshot: { name: "Anything" },
        }),
      ).toThrow(DomainError);
    });

    describe("snapshot presence rule (mirrors the DB CHECK constraint)", () => {
      it("rejects a 'create' revision with a non-null before snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "create",
            beforeSnapshot: { name: "Should not be here" },
            afterSnapshot: { name: "Dragon Range" },
          }),
        ).toThrow(DomainError);
      });

      it("rejects a 'create' revision with a null after snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "create",
            beforeSnapshot: null,
            afterSnapshot: null,
          }),
        ).toThrow(DomainError);
      });

      it("rejects an 'update' revision missing the before snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "update",
            beforeSnapshot: null,
            afterSnapshot: { name: "New name" },
          }),
        ).toThrow(DomainError);
      });

      it("rejects an 'update' revision missing the after snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "update",
            beforeSnapshot: { name: "Old name" },
            afterSnapshot: null,
          }),
        ).toThrow(DomainError);
      });

      it("rejects a 'delete' revision missing the before snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "delete",
            beforeSnapshot: null,
            afterSnapshot: null,
          }),
        ).toThrow(DomainError);
      });

      it("rejects a 'delete' revision with a non-null after snapshot", () => {
        expect(() =>
          reconstituteRevision({
            changeType: "delete",
            beforeSnapshot: { name: "Final name" },
            afterSnapshot: { name: "Should not be here" },
          }),
        ).toThrow(DomainError);
      });

      it("accepts a well-formed 'update' snapshot", () => {
        const revision = reconstituteRevision({
          changeType: "update",
          beforeSnapshot: { name: "Old name" },
          afterSnapshot: { name: "New name" },
        });

        expect(revision.changeType).toBe("update");
      });

      it("accepts a well-formed 'delete' snapshot", () => {
        const revision = reconstituteRevision({
          changeType: "delete",
          beforeSnapshot: { name: "Final name" },
          afterSnapshot: null,
        });

        expect(revision.changeType).toBe("delete");
      });
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const revision = createCreateRevision();
      const snapshot = revision.toSnapshot();

      snapshot.afterSnapshot = { name: "mutated" };

      expect(revision.afterSnapshot).toEqual({ name: "Dragon Range" });
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const revision = createUpdateRevision({ summary: "Renamed", reason: "Typo fix" });
      const snapshot = revision.toSnapshot();
      const restored = ContentRevision.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(revision.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // ContentRevision only validates what it can verify from its own fields
    // (snapshot presence given its own changeType, closed sets for entityType/
    // changeType, non-empty ids, non-negative revisionNumber). Whether entityId
    // is actually a valid row of entityType, whether that row belongs to
    // projectId, and whether revisionNumber matches the entity's real version
    // are cross-aggregate facts the Entity cannot see — those stay the
    // Application Service's responsibility, guaranteed by construction, same
    // boundary already established for WorldElement.currentRevisionId.
    it("accepts any non-empty entityId/projectId without verifying they relate to each other", () => {
      const revision = createCreateRevision({
        projectId: "some-other-project",
        entityId: "not-even-a-uuid-but-non-empty",
      });

      expect(revision.projectId).toBe("some-other-project");
      expect(revision.entityId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("accepts a revisionNumber without verifying it matches the entity's actual version", () => {
      const revision = createCreateRevision({ revisionNumber: 42 });

      expect(revision.revisionNumber).toBe(42);
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createCreateRevision({ entityType: "not_a_real_entity" as ContentEntityType });
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
