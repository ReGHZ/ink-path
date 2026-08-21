import { describe, expect, it } from "vitest";

import { Chapter, type ChapterStatus } from "./Chapter.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");
const evenLater = new Date("2026-07-01T02:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000003";

type ChapterSnapshot = Parameters<typeof Chapter.reconstitute>[0];

const baseSnapshot: ChapterSnapshot = {
  id: "chapter-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  title: "Chapter One: The Falling Ash Valley Trial",
  order: 1,
  summary:
    "Three disciples of the Azure Cloud Sect enter the trial grounds to test their foundation.",
  content:
    "The gates of Falling Ash Valley groaned open as three disciples stepped across the threshold, qi coiling tight around their meridians.",
  status: "outline",
  publishedAt: null,
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createChapter(overrides: Partial<Parameters<typeof Chapter.create>[0]> = {}) {
  return Chapter.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    title: baseSnapshot.title,
    order: baseSnapshot.order,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteChapter(overrides: Partial<ChapterSnapshot> = {}) {
  return Chapter.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("Chapter", () => {
  describe("create", () => {
    it("creates an outline chapter with normalized optional fields", () => {
      const chapter = createChapter({
        summary: "  Three disciples enter the trial grounds.  ",
        content: "  The gates groaned open.  ",
      });

      expect(chapter.status).toBe("outline");
      expect(chapter.summary).toBe("Three disciples enter the trial grounds.");
      expect(chapter.content).toBe("The gates groaned open.");
      expect(chapter.publishedAt).toBeNull();
      expect(chapter.createdAt).toEqual(now);
      expect(chapter.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const chapter = createChapter({ summary: "   ", content: "   " });

      expect(chapter.summary).toBeNull();
      expect(chapter.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const chapter = createChapter();

      expect(chapter.summary).toBeNull();
      expect(chapter.content).toBeNull();
    });

    it("trims the title before storing it", () => {
      const chapter = createChapter({ title: "  Chapter One  " });

      expect(chapter.title).toBe("Chapter One");
    });

    it("rejects a whitespace-only title", () => {
      expect(() => createChapter({ title: "   " })).toThrow(DomainError);
    });

    it("rejects a non-integer order", () => {
      expect(() => createChapter({ order: 1.5 })).toThrow(DomainError);
    });

    it("rejects a negative order", () => {
      expect(() => createChapter({ order: -1 })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createChapter({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createChapter({ id: "  " })).toThrow(DomainError);
      expect(() => createChapter({ projectId: "  " })).toThrow(DomainError);
      expect(() => createChapter({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims title, normalizes optional fields, and returns true while in outline", () => {
      const chapter = createChapter();

      const changed = chapter.updateDetails({
        title: "  Chapter One: Revised  ",
        order: 2,
        summary: "  Updated summary  ",
        content: "  Updated content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(chapter.title).toBe("Chapter One: Revised");
      expect(chapter.order).toBe(2);
      expect(chapter.summary).toBe("Updated summary");
      expect(chapter.content).toBe("Updated content");
      expect(chapter.updatedAt).toEqual(later);
    });

    it("allows editing while status is draft", () => {
      const chapter = createChapter({ summary: "Outline done" });
      chapter.startDrafting(later);

      const changed = chapter.updateDetails({ content: "Drafting begins.", now: evenLater });

      expect(changed).toBe(true);
      expect(chapter.status).toBe("draft");
      expect(chapter.content).toBe("Drafting begins.");
    });

    it("leaves unspecified fields untouched", () => {
      const chapter = createChapter({ summary: "Keep summary", content: "Keep content" });

      chapter.updateDetails({ title: "Renamed Chapter", now: later });

      expect(chapter.title).toBe("Renamed Chapter");
      expect(chapter.summary).toBe("Keep summary");
      expect(chapter.content).toBe("Keep content");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const chapter = createChapter({ summary: "Summary", content: "Content" });

      chapter.updateDetails({ summary: null, content: null, now: later });

      expect(chapter.summary).toBeNull();
      expect(chapter.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const chapter = createChapter({ title: "Chapter One", order: 1 });

      const changed = chapter.updateDetails({ title: "  Chapter One  ", order: 1, now: later });

      expect(changed).toBe(false);
      expect(chapter.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only title rolls back title and updatedAt", () => {
      const chapter = createChapter({ title: "Chapter One" });

      expect(() => chapter.updateDetails({ title: "   ", now: later })).toThrow(DomainError);

      expect(chapter.title).toBe("Chapter One");
      expect(chapter.updatedAt).toEqual(now);
    });

    it("is atomic: a negative order rolls back order and updatedAt", () => {
      const chapter = createChapter({ order: 1 });

      expect(() => chapter.updateDetails({ order: -1, now: later })).toThrow(DomainError);

      expect(chapter.order).toBe(1);
      expect(chapter.updatedAt).toEqual(now);
    });

    it("rejects editing while status is review, leaving state untouched", () => {
      const chapter = reconstituteChapter({ status: "review", content: "Body" });

      expect(() => chapter.updateDetails({ title: "New title", now: later })).toThrow(
        DomainError,
      );

      expect(chapter.title).toBe(baseSnapshot.title);
      expect(chapter.status).toBe("review");
      expect(chapter.updatedAt).toEqual(now);
    });

    it("rejects editing while status is published, leaving state untouched", () => {
      const chapter = reconstituteChapter({
        status: "published",
        content: "Body",
        publishedAt: now,
      });

      expect(() => chapter.updateDetails({ content: "Sneaky rewrite", now: later })).toThrow(
        DomainError,
      );

      expect(chapter.content).toBe("Body");
      expect(chapter.status).toBe("published");
      expect(chapter.updatedAt).toEqual(now);
    });

    it("allows editing again after unpublish() returns the chapter to draft", () => {
      const chapter = reconstituteChapter({
        status: "published",
        content: "Body",
        publishedAt: now,
      });

      chapter.unpublish(later);
      const changed = chapter.updateDetails({ content: "Revised after unpublish", now: evenLater });

      expect(changed).toBe(true);
      expect(chapter.content).toBe("Revised after unpublish");
    });
  });

  describe("startDrafting", () => {
    it("transitions outline to draft when summary is present", () => {
      const chapter = createChapter({ summary: "Outline is ready." });

      const changed = chapter.startDrafting(later);

      expect(changed).toBe(true);
      expect(chapter.status).toBe("draft");
      expect(chapter.updatedAt).toEqual(later);
      expect(chapter.publishedAt).toBeNull();
    });

    it("rejects when summary is null", () => {
      const chapter = createChapter({ summary: null });

      expect(() => chapter.startDrafting(later)).toThrow(DomainError);
      expect(chapter.status).toBe("outline");
    });

    it("rejects when summary is whitespace-only (normalized to null)", () => {
      const chapter = createChapter({ summary: "   " });

      expect(chapter.summary).toBeNull();
      expect(() => chapter.startDrafting(later)).toThrow(DomainError);
    });

    it("rejects when the chapter is not currently in outline", () => {
      const chapter = reconstituteChapter({ status: "draft" });

      expect(() => chapter.startDrafting(later)).toThrow(DomainError);
      expect(chapter.status).toBe("draft");
    });
  });

  describe("submitForReview", () => {
    it("transitions draft to review when content is present", () => {
      const chapter = reconstituteChapter({ status: "draft", content: "Drafted prose." });

      const changed = chapter.submitForReview(later);

      expect(changed).toBe(true);
      expect(chapter.status).toBe("review");
      expect(chapter.updatedAt).toEqual(later);
    });

    it("rejects when content is null", () => {
      const chapter = reconstituteChapter({ status: "draft", content: null });

      expect(() => chapter.submitForReview(later)).toThrow(DomainError);
      expect(chapter.status).toBe("draft");
    });

    it("rejects when content is whitespace-only (normalized to null)", () => {
      const chapter = createChapter({ summary: "Ready" });
      chapter.startDrafting(later);
      chapter.updateDetails({ content: "   ", now: later });

      expect(chapter.content).toBeNull();
      expect(() => chapter.submitForReview(later)).toThrow(DomainError);
    });

    it("rejects when the chapter is not currently in draft", () => {
      const chapter = createChapter({ summary: "Ready", content: "Body" });

      expect(() => chapter.submitForReview(later)).toThrow(DomainError);
      expect(chapter.status).toBe("outline");
    });
  });

  describe("publish", () => {
    it("transitions review to published and sets publishedAt", () => {
      const chapter = reconstituteChapter({ status: "review", content: "Reviewed prose." });

      const changed = chapter.publish(later);

      expect(changed).toBe(true);
      expect(chapter.status).toBe("published");
      expect(chapter.publishedAt).toEqual(later);
      expect(chapter.updatedAt).toEqual(later);
    });

    it("rejects when the chapter is not currently in review", () => {
      const chapter = reconstituteChapter({ status: "draft", content: "Body" });

      expect(() => chapter.publish(later)).toThrow(DomainError);
      expect(chapter.status).toBe("draft");
      expect(chapter.publishedAt).toBeNull();
    });
  });

  describe("requestRevision", () => {
    it("transitions review back to draft", () => {
      const chapter = reconstituteChapter({ status: "review", content: "Body" });

      const changed = chapter.requestRevision(later);

      expect(changed).toBe(true);
      expect(chapter.status).toBe("draft");
      expect(chapter.updatedAt).toEqual(later);
      expect(chapter.publishedAt).toBeNull();
    });

    it("rejects when the chapter is not currently in review", () => {
      const chapter = reconstituteChapter({ status: "draft", content: "Body" });

      expect(() => chapter.requestRevision(later)).toThrow(DomainError);
      expect(chapter.status).toBe("draft");
    });
  });

  describe("unpublish", () => {
    it("transitions published back to draft and clears publishedAt", () => {
      const chapter = reconstituteChapter({
        status: "published",
        content: "Body",
        publishedAt: now,
      });

      const changed = chapter.unpublish(later);

      expect(changed).toBe(true);
      expect(chapter.status).toBe("draft");
      expect(chapter.publishedAt).toBeNull();
      expect(chapter.updatedAt).toEqual(later);
    });

    it("rejects when the chapter is not currently published", () => {
      const chapter = reconstituteChapter({ status: "review", content: "Body" });

      expect(() => chapter.unpublish(later)).toThrow(DomainError);
      expect(chapter.status).toBe("review");
    });
  });

  describe("full lifecycle (integration of the state machine)", () => {
    it("walks outline -> draft -> review -> published -> draft -> review -> published", () => {
      const chapter = createChapter({ summary: "Outline is ready." });

      chapter.startDrafting(later);
      expect(chapter.status).toBe("draft");

      chapter.updateDetails({ content: "The first draft of the trial arc.", now: evenLater });
      chapter.submitForReview(evenLater);
      expect(chapter.status).toBe("review");

      chapter.publish(evenLater);
      expect(chapter.status).toBe("published");
      expect(chapter.publishedAt).toEqual(evenLater);

      chapter.unpublish(evenLater);
      expect(chapter.status).toBe("draft");
      expect(chapter.publishedAt).toBeNull();

      chapter.updateDetails({ content: "A revised trial arc.", now: evenLater });
      chapter.submitForReview(evenLater);
      chapter.publish(evenLater);

      expect(chapter.status).toBe("published");
      expect(chapter.content).toBe("A revised trial arc.");
    });

    it("never allows a direct jump that skips a required transition", () => {
      const outline = createChapter({ summary: "Ready", content: "Body" });
      expect(() => outline.submitForReview(later)).toThrow(DomainError);
      expect(() => outline.publish(later)).toThrow(DomainError);

      const draft = reconstituteChapter({ status: "draft", content: "Body" });
      expect(() => draft.publish(later)).toThrow(DomainError);
      expect(() => draft.unpublish(later)).toThrow(DomainError);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const chapter = reconstituteChapter({
        title: "  raw title  ",
        summary: "  raw summary  ",
        content: "  raw content  ",
      });

      expect(chapter.title).toBe("  raw title  ");
      expect(chapter.summary).toBe("  raw summary  ");
      expect(chapter.content).toBe("  raw content  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteChapter({ version: -1 })).toThrow(DomainError);
      expect(() => reconstituteChapter({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteChapter({ status: "archived" as ChapterStatus }),
      ).toThrow(DomainError);
    });

    it("rejects a negative order", () => {
      expect(() => reconstituteChapter({ order: -1 })).toThrow(DomainError);
    });

    it("rejects a review snapshot with null content", () => {
      expect(() => reconstituteChapter({ status: "review", content: null })).toThrow(
        DomainError,
      );
    });

    it("rejects a review snapshot with whitespace-only content", () => {
      expect(() => reconstituteChapter({ status: "review", content: "   " })).toThrow(
        DomainError,
      );
    });

    it("rejects a published snapshot with null content", () => {
      expect(() =>
        reconstituteChapter({ status: "published", content: null, publishedAt: now }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with publishedAt null (inconsistent side-assertion marker)", () => {
      expect(() =>
        reconstituteChapter({ status: "published", content: "Body", publishedAt: null }),
      ).toThrow(DomainError);
    });

    it("rejects a non-published snapshot with publishedAt set (inconsistent side-assertion marker)", () => {
      expect(() =>
        reconstituteChapter({ status: "draft", content: "Body", publishedAt: now }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteChapter({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts a published snapshot with content present and publishedAt set", () => {
      const chapter = reconstituteChapter({
        status: "published",
        content: "Body",
        publishedAt: now,
      });

      expect(chapter.status).toBe("published");
      expect(chapter.publishedAt).toEqual(now);
    });

    it("accepts an outline or draft snapshot with summary and content both null", () => {
      const outline = reconstituteChapter({ summary: null, content: null });
      expect(outline.content).toBeNull();

      const draft = reconstituteChapter({ status: "draft", summary: null, content: null });
      expect(draft.content).toBeNull();
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const chapter = createChapter({ summary: "Summary" });
      const snapshot = chapter.toSnapshot();

      snapshot.title = "mutated";
      snapshot.summary = null;

      expect(chapter.title).toBe(baseSnapshot.title);
      expect(chapter.summary).toBe("Summary");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const chapter = reconstituteChapter({
        status: "published",
        content: "Body",
        publishedAt: now,
      });
      const snapshot = chapter.toSnapshot();
      const restored = Chapter.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(chapter.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The entity treats currentRevisionId as an opaque established-aggregate token.
    // Per the phase-4 improvement rule, the entity must NOT verify cross-aggregate
    // ownership (that revision belongs to this entity) — that is guaranteed by
    // construction in the Application Service. This test pins the boundary: any
    // non-empty string is accepted, with no relation check.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const chapter = createChapter({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(chapter.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          reconstituteChapter({ status: "draft", content: null }).submitForReview(later);
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
