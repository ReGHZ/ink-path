import { describe, expect, it } from "vitest";

import { Scene, type SceneStatus } from "./Scene.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000004";
const chapterId = "33333333-0000-4000-8000-000000000001";

type SceneSnapshot = Parameters<typeof Scene.reconstitute>[0];

const baseSnapshot: SceneSnapshot = {
  id: "scene-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  chapterId,
  title: "The Threshold of Falling Ash Valley",
  summary: "The disciples cross into the trial grounds for the first time.",
  content:
    "Qi coiled tight around their meridians as the gates groaned open, revealing a valley choked in grey ash.",
  orderInChapter: 0,
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createScene(overrides: Partial<Parameters<typeof Scene.create>[0]> = {}) {
  return Scene.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    chapterId: baseSnapshot.chapterId,
    orderInChapter: baseSnapshot.orderInChapter,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteScene(overrides: Partial<SceneSnapshot> = {}) {
  return Scene.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("Scene", () => {
  describe("create", () => {
    it("creates a draft scene with normalized optional fields", () => {
      const scene = createScene({
        title: "  The Threshold of Falling Ash Valley  ",
        summary: "  The disciples cross into the trial grounds.  ",
        content: "  The gates groaned open.  ",
      });

      expect(scene.status).toBe("draft");
      expect(scene.title).toBe("The Threshold of Falling Ash Valley");
      expect(scene.summary).toBe("The disciples cross into the trial grounds.");
      expect(scene.content).toBe("The gates groaned open.");
      expect(scene.createdAt).toEqual(now);
      expect(scene.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const scene = createScene({ title: "   ", summary: "   ", content: "   " });

      expect(scene.title).toBeNull();
      expect(scene.summary).toBeNull();
      expect(scene.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const scene = createScene();

      expect(scene.title).toBeNull();
      expect(scene.summary).toBeNull();
      expect(scene.content).toBeNull();
    });

    it("stores the provided orderInChapter and chapterId", () => {
      const scene = createScene({ orderInChapter: 3 });

      expect(scene.orderInChapter).toBe(3);
      expect(scene.chapterId).toBe(chapterId);
    });

    it("rejects a non-integer orderInChapter", () => {
      expect(() => createScene({ orderInChapter: 1.5 })).toThrow(DomainError);
    });

    it("rejects a negative orderInChapter", () => {
      expect(() => createScene({ orderInChapter: -1 })).toThrow(DomainError);
    });

    it("rejects an empty chapterId", () => {
      expect(() => createScene({ chapterId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createScene({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createScene({ id: "  " })).toThrow(DomainError);
      expect(() => createScene({ projectId: "  " })).toThrow(DomainError);
      expect(() => createScene({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("normalizes optional text fields, updates orderInChapter, and returns true", () => {
      const scene = createScene();

      const changed = scene.updateDetails({
        title: "  Updated title  ",
        summary: "  Updated summary  ",
        content: "  Updated content  ",
        orderInChapter: 2,
        now: later,
      });

      expect(changed).toBe(true);
      expect(scene.title).toBe("Updated title");
      expect(scene.summary).toBe("Updated summary");
      expect(scene.content).toBe("Updated content");
      expect(scene.orderInChapter).toBe(2);
      expect(scene.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const scene = createScene({ title: "Keep title", content: "Keep content" });

      scene.updateDetails({ summary: "New summary", now: later });

      expect(scene.title).toBe("Keep title");
      expect(scene.content).toBe("Keep content");
      expect(scene.summary).toBe("New summary");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const scene = createScene({ title: "Title", content: "Content" });

      scene.updateDetails({ title: null, content: null, now: later });

      expect(scene.title).toBeNull();
      expect(scene.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const scene = createScene({ title: "Title", content: "Content" });

      scene.updateDetails({ title: "   ", content: "   ", now: later });

      expect(scene.title).toBeNull();
      expect(scene.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const scene = createScene({ title: "Title", orderInChapter: 0 });

      const changed = scene.updateDetails({
        title: "  Title  ",
        orderInChapter: 0,
        now: later,
      });

      expect(changed).toBe(false);
      expect(scene.updatedAt).toEqual(now);
    });

    it("is atomic: a negative orderInChapter rolls back orderInChapter and updatedAt", () => {
      const scene = createScene({ orderInChapter: 0 });

      expect(() => scene.updateDetails({ orderInChapter: -1, now: later })).toThrow(
        DomainError,
      );

      expect(scene.orderInChapter).toBe(0);
      expect(scene.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on a published scene rolls back content and updatedAt", () => {
      const scene = reconstituteScene({ status: "published", content: "Body" });

      expect(() => scene.updateDetails({ content: null, now: later })).toThrow(DomainError);

      expect(scene.content).toBe("Body");
      expect(scene.status).toBe("published");
      expect(scene.updatedAt).toEqual(now);
    });

    it("allows clearing content while the scene is a draft", () => {
      const scene = createScene({ content: "Body" });

      scene.updateDetails({ content: null, now: later });

      expect(scene.content).toBeNull();
      expect(scene.status).toBe("draft");
    });

    it("has no way to change chapterId (fixed at creation, not part of updateDetails)", () => {
      const scene = createScene();

      // @ts-expect-error chapterId is intentionally absent from UpdateSceneDetailsProperties
      scene.updateDetails({ chapterId: "different-chapter", now: later });

      expect(scene.chapterId).toBe(chapterId);
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to published and returns true when content is present", () => {
      const scene = createScene({ content: "Body" });

      const changed = scene.changeStatus("published", later);

      expect(changed).toBe(true);
      expect(scene.status).toBe("published");
      expect(scene.updatedAt).toEqual(later);
    });

    it("rejects draft to published when content is null", () => {
      const scene = createScene({ content: null });

      expect(() => scene.changeStatus("published", later)).toThrow(DomainError);
      expect(scene.status).toBe("draft");
      expect(scene.updatedAt).toEqual(now);
    });

    it("rejects draft to published when content is whitespace-only (normalized to null)", () => {
      const scene = createScene({ content: "   " });

      expect(scene.content).toBeNull();
      expect(() => scene.changeStatus("published", later)).toThrow(DomainError);
      expect(scene.status).toBe("draft");
    });

    it("transitions published back to draft (publish is a marker, not a one-way workflow)", () => {
      const scene = reconstituteScene({ status: "published", content: "Body" });

      const changed = scene.changeStatus("draft", later);

      expect(changed).toBe(true);
      expect(scene.status).toBe("draft");
      expect(scene.updatedAt).toEqual(later);
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createScene({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const published = reconstituteScene({ status: "published", content: "Body" });

      expect(published.changeStatus("published", later)).toBe(false);
      expect(published.status).toBe("published");
      expect(published.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const scene = reconstituteScene({
        title: "  raw title  ",
        summary: "  raw summary  ",
        content: "  raw content  ",
      });

      expect(scene.title).toBe("  raw title  ");
      expect(scene.summary).toBe("  raw summary  ");
      expect(scene.content).toBe("  raw content  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteScene({ version: -1 })).toThrow(DomainError);
      expect(() => reconstituteScene({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteScene({ status: "archived" as SceneStatus }),
      ).toThrow(DomainError);
    });

    it("rejects a negative orderInChapter", () => {
      expect(() => reconstituteScene({ orderInChapter: -1 })).toThrow(DomainError);
    });

    it("rejects a published snapshot with null content", () => {
      expect(() =>
        reconstituteScene({ status: "published", content: null }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with whitespace-only content", () => {
      expect(() =>
        reconstituteScene({ status: "published", content: "   " }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty chapter id", () => {
      expect(() => reconstituteScene({ chapterId: "   " })).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteScene({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts a published snapshot with non-empty content", () => {
      const scene = reconstituteScene({ status: "published", content: "Body" });

      expect(scene.status).toBe("published");
      expect(scene.content).toBe("Body");
    });

    it("accepts a null title (title is optional, unlike Chapter's)", () => {
      const scene = reconstituteScene({ title: null });

      expect(scene.title).toBeNull();
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const scene = createScene({ content: "Body" });
      const snapshot = scene.toSnapshot();

      snapshot.title = "mutated";
      snapshot.content = null;

      expect(scene.title).toBeNull();
      expect(scene.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const scene = reconstituteScene({ status: "published", content: "Body" });
      const snapshot = scene.toSnapshot();
      const restored = Scene.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(scene.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // Both currentRevisionId and chapterId are opaque established-aggregate
    // tokens. Per the phase-4 improvement rule (reaffirmed for Scene's
    // cross-entity parent), the entity must NOT verify cross-aggregate
    // ownership — that Chapter exists and belongs to the same project is
    // guaranteed by construction in SceneService, not here.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const scene = createScene({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(scene.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("accepts any non-empty chapter id without verifying it exists or belongs to the same project", () => {
      const scene = createScene({
        chapterId: "not-even-a-uuid-but-non-empty",
      });

      expect(scene.chapterId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createScene({ content: null }).changeStatus("published", later);
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
