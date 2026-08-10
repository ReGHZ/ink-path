import { describe, expect, it } from "vitest";

import { Plot, type PlotStatus } from "./Plot.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const later = new Date("2026-07-01T01:00:00.000Z");

const revisionId = "22222222-0000-4000-8000-000000000002";

type PlotSnapshot = Parameters<typeof Plot.reconstitute>[0];

const baseSnapshot: PlotSnapshot = {
  id: "plot-1",
  version: 0,
  projectId: "project-1",
  createdByUserId: "user-1",
  name: "The Fall of the Falling Ash Faction",
  description: "The Falling Ash Faction's alliance with a demonic sect unravels.",
  theme: "Betrayal and the price of forbidden power",
  conflict:
    "Elder Wuyin discovers the faction leader has been secretly cultivating a demonic technique.",
  resolution:
    "The faction leader is exposed at the Sect Alliance Tribunal and stripped of his cultivation base.",
  content:
    "A multi-chapter arc tracking the Falling Ash Faction's slow corruption, from the first whispered rumor to the public tribunal.",
  status: "draft",
  currentRevisionId: revisionId,
  createdAt: now,
  updatedAt: now,
};

function createPlot(overrides: Partial<Parameters<typeof Plot.create>[0]> = {}) {
  return Plot.create({
    id: baseSnapshot.id,
    projectId: baseSnapshot.projectId,
    createdByUserId: baseSnapshot.createdByUserId,
    name: baseSnapshot.name,
    currentRevisionId: baseSnapshot.currentRevisionId,
    now,
    ...overrides,
  });
}

function reconstitutePlot(overrides: Partial<PlotSnapshot> = {}) {
  return Plot.reconstitute({ ...baseSnapshot, ...overrides });
}

describe("Plot", () => {
  describe("create", () => {
    it("creates a draft plot with normalized optional fields", () => {
      const plot = createPlot({
        description: "  Alliance with a demonic sect unravels.  ",
        theme: "  Betrayal and the price of forbidden power  ",
        conflict: "  A secret demonic technique is discovered.  ",
        resolution: "  Exposed at the Sect Alliance Tribunal.  ",
        content: "  A multi-chapter corruption arc.  ",
      });

      expect(plot.status).toBe("draft");
      expect(plot.description).toBe("Alliance with a demonic sect unravels.");
      expect(plot.theme).toBe("Betrayal and the price of forbidden power");
      expect(plot.conflict).toBe("A secret demonic technique is discovered.");
      expect(plot.resolution).toBe("Exposed at the Sect Alliance Tribunal.");
      expect(plot.content).toBe("A multi-chapter corruption arc.");
      expect(plot.createdAt).toEqual(now);
      expect(plot.updatedAt).toEqual(now);
    });

    it("collapses whitespace-only optional fields to null", () => {
      const plot = createPlot({
        description: "   ",
        theme: "   ",
        conflict: "   ",
        resolution: "   ",
        content: "   ",
      });

      expect(plot.description).toBeNull();
      expect(plot.theme).toBeNull();
      expect(plot.conflict).toBeNull();
      expect(plot.resolution).toBeNull();
      expect(plot.content).toBeNull();
    });

    it("treats omitted optional fields as null", () => {
      const plot = createPlot();

      expect(plot.description).toBeNull();
      expect(plot.theme).toBeNull();
      expect(plot.conflict).toBeNull();
      expect(plot.resolution).toBeNull();
      expect(plot.content).toBeNull();
    });

    it("trims the name before storing it", () => {
      const plot = createPlot({ name: "  The Fall of the Falling Ash Faction  " });

      expect(plot.name).toBe("The Fall of the Falling Ash Faction");
    });

    it("rejects a whitespace-only name", () => {
      expect(() => createPlot({ name: "   " })).toThrow(DomainError);
    });

    it("rejects an empty current revision id (established-aggregate invariant)", () => {
      expect(() => createPlot({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("rejects an empty id, project id, or created-by user id", () => {
      expect(() => createPlot({ id: "  " })).toThrow(DomainError);
      expect(() => createPlot({ projectId: "  " })).toThrow(DomainError);
      expect(() => createPlot({ createdByUserId: "  " })).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims name, normalizes optional text fields, and returns true", () => {
      const plot = createPlot();

      const changed = plot.updateDetails({
        name: "  The Rise of the Azure Cloud Sect  ",
        description: "  Updated description  ",
        theme: "  Updated theme  ",
        conflict: "  Updated conflict  ",
        resolution: "  Updated resolution  ",
        content: "  Updated content  ",
        now: later,
      });

      expect(changed).toBe(true);
      expect(plot.name).toBe("The Rise of the Azure Cloud Sect");
      expect(plot.description).toBe("Updated description");
      expect(plot.theme).toBe("Updated theme");
      expect(plot.conflict).toBe("Updated conflict");
      expect(plot.resolution).toBe("Updated resolution");
      expect(plot.content).toBe("Updated content");
      expect(plot.updatedAt).toEqual(later);
    });

    it("leaves unspecified fields untouched", () => {
      const plot = createPlot({
        theme: "Betrayal",
        conflict: "Discovery of the demonic technique",
        content: "Keep content",
      });

      plot.updateDetails({ name: "Renamed Arc", now: later });

      expect(plot.name).toBe("Renamed Arc");
      expect(plot.theme).toBe("Betrayal");
      expect(plot.conflict).toBe("Discovery of the demonic technique");
      expect(plot.content).toBe("Keep content");
    });

    it("clears an optional field when null is passed explicitly", () => {
      const plot = createPlot({ theme: "Betrayal", content: "Content" });

      plot.updateDetails({ theme: null, content: null, now: later });

      expect(plot.theme).toBeNull();
      expect(plot.content).toBeNull();
    });

    it("collapses a whitespace-only optional field to null", () => {
      const plot = createPlot({ theme: "Betrayal", content: "Content" });

      plot.updateDetails({ theme: "   ", content: "   ", now: later });

      expect(plot.theme).toBeNull();
      expect(plot.content).toBeNull();
    });

    it("returns false and does NOT bump updatedAt when no concrete field changes", () => {
      const plot = createPlot({ name: "Falling Ash Arc" });

      const changed = plot.updateDetails({ name: "  Falling Ash Arc  ", now: later });

      expect(changed).toBe(false);
      expect(plot.updatedAt).toEqual(now);
    });

    it("returns false and does NOT bump updatedAt when the new content is whitespace-equivalent", () => {
      const plot = createPlot({ content: "A multi-chapter corruption arc." });

      const changed = plot.updateDetails({
        content: "  A multi-chapter corruption arc.  ",
        now: later,
      });

      expect(changed).toBe(false);
      expect(plot.content).toBe("A multi-chapter corruption arc.");
      expect(plot.updatedAt).toEqual(now);
    });

    it("is atomic: a whitespace-only name rolls back name and updatedAt", () => {
      const plot = createPlot({ name: "Falling Ash Arc" });

      expect(() => plot.updateDetails({ name: "   ", now: later })).toThrow(DomainError);

      expect(plot.name).toBe("Falling Ash Arc");
      expect(plot.updatedAt).toEqual(now);
    });

    it("is atomic: clearing content on an active plot rolls back content and updatedAt", () => {
      const plot = reconstitutePlot({ status: "active", content: "Body" });

      expect(() => plot.updateDetails({ content: null, now: later })).toThrow(DomainError);

      expect(plot.content).toBe("Body");
      expect(plot.status).toBe("active");
      expect(plot.updatedAt).toEqual(now);
    });

    it("is atomic: clearing resolution on a completed plot rolls back resolution and updatedAt", () => {
      const plot = reconstitutePlot({
        status: "completed",
        content: "Body",
        resolution: "Exposed at the tribunal.",
      });

      expect(() => plot.updateDetails({ resolution: null, now: later })).toThrow(
        DomainError,
      );

      expect(plot.resolution).toBe("Exposed at the tribunal.");
      expect(plot.status).toBe("completed");
      expect(plot.updatedAt).toEqual(now);
    });

    it("allows clearing content and resolution while the plot is a draft", () => {
      const plot = createPlot({ content: "Body", resolution: "Resolved" });

      plot.updateDetails({ content: null, resolution: null, now: later });

      expect(plot.content).toBeNull();
      expect(plot.resolution).toBeNull();
      expect(plot.status).toBe("draft");
    });
  });

  describe("changeStatus", () => {
    it("transitions draft to active and returns true when content is present", () => {
      const plot = createPlot({ content: "Body" });

      const changed = plot.changeStatus("active", later);

      expect(changed).toBe(true);
      expect(plot.status).toBe("active");
      expect(plot.updatedAt).toEqual(later);
    });

    it("rejects draft to active when content is null", () => {
      const plot = createPlot({ content: null });

      expect(() => plot.changeStatus("active", later)).toThrow(DomainError);
      expect(plot.status).toBe("draft");
      expect(plot.updatedAt).toEqual(now);
    });

    it("rejects draft to completed when content is present but resolution is null", () => {
      const plot = createPlot({ content: "Body", resolution: null });

      expect(() => plot.changeStatus("completed", later)).toThrow(DomainError);
      expect(plot.status).toBe("draft");
      expect(plot.updatedAt).toEqual(now);
    });

    it("rejects draft to completed when resolution is whitespace-only (normalized to null)", () => {
      const plot = createPlot({ content: "Body", resolution: "   " });

      expect(plot.resolution).toBeNull();
      expect(() => plot.changeStatus("completed", later)).toThrow(DomainError);
      expect(plot.status).toBe("draft");
    });

    it("transitions draft to completed when both content and resolution are present", () => {
      const plot = createPlot({ content: "Body", resolution: "Exposed at the tribunal." });

      const changed = plot.changeStatus("completed", later);

      expect(changed).toBe(true);
      expect(plot.status).toBe("completed");
      expect(plot.updatedAt).toEqual(later);
    });

    it("accepts a deliberately ambiguous ending as a valid resolution (guard checks presence, not narrative closure)", () => {
      const plot = createPlot({
        content: "Body",
        resolution: "Left deliberately open — the northern faction's fate is never confirmed.",
      });

      const changed = plot.changeStatus("completed", later);

      expect(changed).toBe(true);
      expect(plot.status).toBe("completed");
    });

    it("transitions completed back to draft freely (no directional restriction)", () => {
      const plot = reconstitutePlot({
        status: "completed",
        content: "Body",
        resolution: "Exposed at the tribunal.",
      });

      const changed = plot.changeStatus("draft", later);

      expect(changed).toBe(true);
      expect(plot.status).toBe("draft");
      expect(plot.updatedAt).toEqual(later);
    });

    it("transitions completed directly to active (skipping draft) when content is present", () => {
      const plot = reconstitutePlot({
        status: "completed",
        content: "Body",
        resolution: "Exposed at the tribunal.",
      });

      const changed = plot.changeStatus("active", later);

      expect(changed).toBe(true);
      expect(plot.status).toBe("active");
    });

    it("returns false and leaves state untouched when transitioning to the same status", () => {
      const draft = createPlot({ content: "Body" });

      expect(draft.changeStatus("draft", later)).toBe(false);
      expect(draft.status).toBe("draft");
      expect(draft.updatedAt).toEqual(now);

      const active = reconstitutePlot({ status: "active", content: "Body" });

      expect(active.changeStatus("active", later)).toBe(false);
      expect(active.status).toBe("active");
      expect(active.updatedAt).toEqual(now);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const plot = reconstitutePlot({
        name: "  raw name  ",
        theme: "  raw theme  ",
        conflict: "  raw conflict  ",
        resolution: "  raw resolution  ",
        content: "  raw content  ",
      });

      expect(plot.name).toBe("  raw name  ");
      expect(plot.theme).toBe("  raw theme  ");
      expect(plot.conflict).toBe("  raw conflict  ");
      expect(plot.resolution).toBe("  raw resolution  ");
      expect(plot.content).toBe("  raw content  ");
    });

    it("rejects a negative or non-integer version", () => {
      expect(() => reconstitutePlot({ version: -1 })).toThrow(DomainError);
      expect(() => reconstitutePlot({ version: 1.5 })).toThrow(DomainError);
    });

    it("rejects an invalid status", () => {
      expect(() =>
        reconstitutePlot({ status: "archived" as PlotStatus }),
      ).toThrow(DomainError);
    });

    it("rejects an active snapshot with null content", () => {
      expect(() => reconstitutePlot({ status: "active", content: null })).toThrow(
        DomainError,
      );
    });

    it("rejects a completed snapshot with content present but resolution null", () => {
      expect(() =>
        reconstitutePlot({ status: "completed", content: "Body", resolution: null }),
      ).toThrow(DomainError);
    });

    it("rejects an established snapshot with an empty current revision id", () => {
      expect(() => reconstitutePlot({ currentRevisionId: "   " })).toThrow(DomainError);
    });

    it("accepts an active snapshot with non-empty content", () => {
      const plot = reconstitutePlot({ status: "active", content: "Body" });

      expect(plot.status).toBe("active");
      expect(plot.content).toBe("Body");
    });

    it("accepts a completed snapshot with content and resolution both present", () => {
      const plot = reconstitutePlot({
        status: "completed",
        content: "Body",
        resolution: "Exposed at the tribunal.",
      });

      expect(plot.status).toBe("completed");
      expect(plot.resolution).toBe("Exposed at the tribunal.");
    });
  });

  describe("toSnapshot", () => {
    it("returns a copy that is decoupled from the entity", () => {
      const plot = createPlot({ content: "Body" });
      const snapshot = plot.toSnapshot();

      snapshot.name = "mutated";
      snapshot.content = null;

      expect(plot.name).toBe(baseSnapshot.name);
      expect(plot.content).toBe("Body");
    });

    it("round-trips through reconstitute without changing observable state", () => {
      const plot = reconstitutePlot({
        status: "completed",
        content: "Body",
        resolution: "Exposed at the tribunal.",
      });
      const snapshot = plot.toSnapshot();
      const restored = Plot.reconstitute(snapshot);

      expect(restored.toSnapshot()).toEqual(plot.toSnapshot());
    });
  });

  describe("invariant boundaries (improvement rule)", () => {
    // The entity treats currentRevisionId as an opaque established-aggregate token.
    // Per the phase-4 improvement rule, the entity must NOT verify cross-aggregate
    // ownership (that revision belongs to this entity) — that is guaranteed by
    // construction in the Application Service. This test pins the boundary: any
    // non-empty string is accepted, with no relation check.
    it("accepts any non-empty current revision id without verifying ownership", () => {
      const plot = createPlot({
        currentRevisionId: "not-even-a-uuid-but-non-empty",
      });

      expect(plot.currentRevisionId).toBe("not-even-a-uuid-but-non-empty");
    });

    it("rejects with the neutral domain-validation code, not a relation-specific one", () => {
      const error = (() => {
        try {
          createPlot({ content: null }).changeStatus("active", later);
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
