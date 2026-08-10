import { describe, expect, it } from "vitest";

import { Event, type EventStatus } from "./Event.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000001";

type EventSnapshot = Parameters<typeof Event.reconstitute>[0];

const baseSnapshot: EventSnapshot = {
  id: "event-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  title: "The Azure Cloud Sect's Ascension Tribulation",
  era: "Age of the Nine Heavens",
  timelineOrder: 300,
  eventType: "tribulation",
  significance: "major",
  description:
    "Elder Wuyin leads three core disciples through a simultaneous Nascent Soul breakthrough.",
  content:
    "On the seventh moon, lightning tore through the Azure Cloud peak as three disciples entered seclusion together, their cultivation bases resonating until the heavens themselves took notice.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createEvent(overrides: Partial<Parameters<typeof Event.create>[0]> = {}) {
  return Event.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    title: baseSnapshot.title,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstituteEvent(overrides: Partial<EventSnapshot> = {}) {
  return Event.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("Event", () => {
  describe("create", () => {
    it("creates a draft event with normalized optional fields", () => {
      const event = createEvent({
        era: "  Age of the Nine Heavens  ",
        eventType: "  tribulation  ",
        significance: "  major  ",
        description: "  Three disciples attempt a joint breakthrough.  ",
        content: "  Lightning tore through the Azure Cloud peak.  ",
      });

      expect(event.status).toBe("draft");
      expect(event.era).toBe("Age of the Nine Heavens");
      expect(event.eventType).toBe("tribulation");
      expect(event.significance).toBe("major");
      expect(event.description).toBe("Three disciples attempt a joint breakthrough.");
      expect(event.content).toBe("Lightning tore through the Azure Cloud peak.");
      expect(event.createdAt).toEqual(now);
      expect(event.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional text fields to null", () => {
      const event = createEvent({
        era: "   ",
        eventType: "   ",
        significance: "   ",
        description: "   ",
        content: "   ",
      });

      expect(event.era).toBeNull();
      expect(event.eventType).toBeNull();
      expect(event.significance).toBeNull();
      expect(event.description).toBeNull();
      expect(event.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const event = createEvent();

      expect(event.era).toBeNull();
      expect(event.timelineOrder).toBeNull();
      expect(event.eventType).toBeNull();
      expect(event.significance).toBeNull();
      expect(event.description).toBeNull();
      expect(event.content).toBeNull();
    });

    it("stores a provided timelineOrder as-is", () => {
      const event = createEvent({ timelineOrder: 300 });

      expect(event.timelineOrder).toBe(300);
    });

    it("trims the title before storing it", () => {
      const event = createEvent({
        title: "  The Azure Cloud Sect's Ascension Tribulation  ",
      });

      expect(event.title).toBe("The Azure Cloud Sect's Ascension Tribulation");
    });

    it("rejects a whitespace-only title", () => {
      expect(() => createEvent({ title: "   " })).toThrow(DomainError);
    });

    it("rejects a non-integer timelineOrder", () => {
      expect(() => createEvent({ timelineOrder: 12.5 })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createEvent({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createEvent({ id: "  " })).toThrow(DomainError);
      expect(() => createEvent({ projectId: "  " })).toThrow(DomainError);
      expect(() => createEvent({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims title, normalizes optional text fields, and returns true", () => {
      const event = createEvent();

      const changed = event.updateDetails({
        title: "  The Sect War of Falling Ash Valley  ",
        era: "  Age of the Nine Heavens  ",
        eventType: "  sect_war  ",
        significance: "  major  ",
        description: "  Updated description  ",
        content: "  Updated content  ",
        timelineOrder: 301,
        now: later,
      });

      expect(changed).toBe(true);
      expect(event.title).toBe("The Sect War of Falling Ash Valley");
      expect(event.era).toBe("Age of the Nine Heavens");
      expect(event.eventType).toBe("sect_war");
      expect(event.significance).toBe("major");
      expect(event.description).toBe("Updated description");
      expect(event.content).toBe("Updated content");
      expect(event.timelineOrder).toBe(301);
      expect(event.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const event = createEvent({
        era: "Age of the Nine Heavens",
        timelineOrder: 300,
        content: "Keep content",
      });

      event.updateDetails({ title: "Renamed Event", now: later });

      expect(event.title).toBe("Renamed Event");
      expect(event.era).toBe("Age of the Nine Heavens");
      expect(event.timelineOrder).toBe(300);
      expect(event.content).toBe("Keep content");
    });

    it("clears an optional text field when null is passed explicitly", () => {
      const event = createEvent({ era: "Age of the Nine Heavens", content: "Content" });

      event.updateDetails({ era: null, content: null, now: later });

      expect(event.era).toBeNull();
      expect(event.content).toBeNull();
    });

    it("clears timelineOrder when null is passed explicitly", () => {
      const event = createEvent({ timelineOrder: 300 });

      event.updateDetails({ timelineOrder: null, now: later });

      expect(event.timelineOrder).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const event = createEvent({ era: "Era", content: "Content" });

      event.updateDetails({ era: "   ", content: "   ", now: later });

      expect(event.era).toBeNull();
      expect(event.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const event = createEvent({ title: "Ascension Tribulation", timelineOrder: 300 });

      const changed = event.updateDetails({
        title: "  Ascension Tribulation  ",
        timelineOrder: 300,
        now: later,
      });

      expect(changed).toBe(false);
      expect(event.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new title is whitespace-equivalent", () => {
      const event = createEvent({ title: "Ascension Tribulation" });

      const changed = event.updateDetails({ title: "  Ascension Tribulation  ", now: later });

      expect(changed).toBe(false);
      expect(event.title).toBe("Ascension Tribulation");
      expect(event.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new content is whitespace-equivalent", () => {
      const event = createEvent({ content: "Lightning tore through the peak." });

      const changed = event.updateDetails({
        content: "  Lightning tore through the peak.  ",
        now: later,
      });

      expect(changed).toBe(false);
      expect(event.content).toBe("Lightning tore through the peak.");
      expect(event.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only title rolls back title and updatedAt", () => {
      const event = createEvent({ title: "Ascension Tribulation" });

      expect(() => event.updateDetails({ title: "   ", now: later })).toThrow(DomainError);

      expect(event.title).toBe("Ascension Tribulation");
      expect(event.updatedAt).toEqual(now);
    });

    it("is atomic: a non-integer timelineOrder rolls back timelineOrder and updatedAt", () => {
      const event = createEvent({ timelineOrder: 300 });

      expect(() => event.updateDetails({ timelineOrder: 12.5, now: later })).toThrow(
        DomainError,
      );

      expect(event.timelineOrder).toBe(300);
      expect(event.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on a published event rolls back content and updatedAt", () => {
      const event = reconstituteEvent({ status: "published", content: "Body" });

      expect(() => event.updateDetails({ content: null, now: later })).toThrow(DomainError);

      expect(event.content).toBe("Body");
      expect(event.status).toBe("published");
      expect(event.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only content update on a published event rolls back", () => {
      const event = reconstituteEvent({ status: "published", content: "Body" });

      expect(() => event.updateDetails({ content: "   ", now: later })).toThrow(DomainError);

      expect(event.content).toBe("Body");
      expect(event.updatedAt).toEqual(now);
    });

    it("allows clearing content while the event is a draft", () => {
      const event = createEvent({ content: "Body" });

      event.updateDetails({ content: null, now: later });

      expect(event.content).toBeNull();
      expect(event.status).toBe("draft");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to published and returns true when content is present", () => {
      const event = createEvent({ content: "Body" });

      const changed = event.changeStatus("published", later);

      expect(changed).toBe(true);
      expect(event.status).toBe("published");
      expect(event.updatedAt).toEqual(later);
    });

    it("rejects draft to published when content is null", () => {
      const event = createEvent({ content: null });

      expect(() => event.changeStatus("published", later)).toThrow(DomainError);
      expect(event.status).toBe("draft");
      expect(event.updatedAt).toEqual(now);
    });

    it("rejects draft to published when content is whitespace-only (normalized to null)", () => {
      const event = createEvent({ content: "   " });

      expect(event.content).toBeNull();
      expect(() => event.changeStatus("published", later)).toThrow(DomainError);
      expect(event.status).toBe("draft");
    });

    it("transitions published back to draft (publish is a marker, not a one-way workflow)", () => {
      const event = reconstituteEvent({ status: "published", content: "Body" });

      const changed = event.changeStatus("draft", later);

      expect(changed).toBe(true);
      expect(event.status).toBe("draft");
      expect(event.updatedAt).toEqual(later);
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createEvent({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const published = reconstituteEvent({ status: "published", content: "Body" });

      expect(published.changeStatus("published", later)).toBe(false);
      expect(published.status).toBe("published");
      expect(published.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const event = reconstituteEvent({
        title: "  raw title  ",
        era: "  raw era  ",
        eventType: "  raw type  ",
        significance: "  raw significance  ",
        description: "  raw desc  ",
        content: "  raw content  ",
      });

      expect(event.title).toBe("  raw title  ");
      expect(event.era).toBe("  raw era  ");
      expect(event.eventType).toBe("  raw type  ");
      expect(event.significance).toBe("  raw significance  ");
      expect(event.description).toBe("  raw desc  ");
      expect(event.content).toBe("  raw content  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstituteEvent({ version: -1 })).toThrow(DomainError);
      expect(() => reconstituteEvent({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstituteEvent({ status: "archived" as EventStatus }),
      ).toThrow(DomainError);
    });

    it("rejects a non-integer timelineOrder", () => {
      expect(() => reconstituteEvent({ timelineOrder: 12.5 })).toThrow(DomainError);
    });

    it("accepts a null timelineOrder", () => {
      const event = reconstituteEvent({ timelineOrder: null });

      expect(event.timelineOrder).toBeNull();
    });

    it("rejects a published snapshot with null content", () => {
      expect(() =>
        reconstituteEvent({ status: "published", content: null }),
      ).toThrow(DomainError);
    });

    it("rejects a published snapshot with whitespace-only content", () => {
      expect(() =>
        reconstituteEvent({ status: "published", content: "   " }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstituteEvent({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts a published snapshot with non-empty content", () => {
      const event = reconstituteEvent({ status: "published", content: "Body" });

      expect(event.status).toBe("published");
      expect(event.content).toBe("Body");
    });

    it("does not require significance or eventType to be a closed set of values", () => {
      const event = reconstituteEvent({
        significance: "world-shattering",
        eventType: "forbidden_technique_backfire",
      });

      expect(event.significance).toBe("world-shattering");
      expect(event.eventType).toBe("forbidden_technique_backfire");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const event = createEvent({ content: "Body" });
      const snapshot = event.toSnapshot();

      snapshot.title = "mutated";
      snapshot.content = null;

      expect(event.title).toBe(baseSnapshot.title);
      expect(event.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const event = reconstituteEvent({ status: "published", content: "Body" });
      const snapshot = event.toSnapshot();
      const restored = Event.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(event.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The entity treats currentRevisionId as an opaque established-aggregate token.
    // Per the phase-4 improvement rule, the entity must NOT verify cross-aggregate
    // ownership (that revision belongs to this entity) — that is guaranteed by
    // construction in the Application Service. This test pins the boundary: any
    // non-empty string is accepted, with no relation check.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const event = createEvent({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(event.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createEvent({ content: null }).changeStatus("published", later);
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
