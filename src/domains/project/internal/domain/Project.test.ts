import { describe, expect, it } from "vitest";

import { Project } from "./Project.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-06-14T00:00:00.000Z");
const later = new Date("2026-06-14T01:00:00.000Z");

type ProjectSnapshot = Parameters<typeof Project.reconstitute>[0];

const baseProjectSnapshot: ProjectSnapshot = {
  id: "project-1",
  ownerUserId: "user-1",
  name: "My Novel",
  description: null,
  genre: null,
  tone: null,
  style: null,
  language: null,
  visibility: "private",
  status: "draft",
  createdByUserId: "user-1",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};

function createProject(): Project {
  return Project.create({
    id: "project-1",
    ownerUserId: "user-1",
    createdByUserId: "user-1",
    name: "My Novel",
    now,
  });
}

function reconstituteProject(
  overrides: Partial<ProjectSnapshot> = {},
): Project {
  return Project.reconstitute({
    ...baseProjectSnapshot,
    ...overrides,
  });
}

describe("Project", () => {
  describe("create", () => {
    it("creates a private draft project with null optional fields", () => {
      const project = createProject();

      expect(project.visibility).toBe("private");
      expect(project.status).toBe("draft");
      expect(project.description).toBeNull();
      expect(project.genre).toBeNull();
      expect(project.tone).toBeNull();
      expect(project.style).toBeNull();
      expect(project.language).toBeNull();
      expect(project.archivedAt).toBeNull();
      expect(project.createdAt).toEqual(now);
      expect(project.updatedAt).toEqual(now);
    });

    it("trims the name before storing it", () => {
      const project = Project.create({
        id: "project-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "  My Novel  ",
        now,
      });

      expect(project.name).toBe("My Novel");
    });

    it("trims optional fields and collapses whitespace-only to null", () => {
      const project = Project.create({
        id: "project-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        description: "  An epic tale  ",
        genre: "   ",
        now,
      });

      expect(project.description).toBe("An epic tale");
      expect(project.genre).toBeNull();
    });

    it("rejects a whitespace-only name", () => {
      expect(() => {
        Project.create({
          id: "project-1",
          ownerUserId: "user-1",
          createdByUserId: "user-1",
          name: "   ",
          now,
        });
      }).toThrow(DomainError);
    });

    it("rejects an empty owner user id", () => {
      expect(() => {
        Project.create({
          id: "project-1",
          ownerUserId: " ",
          createdByUserId: "user-1",
          name: "My Novel",
          now,
        });
      }).toThrow(DomainError);
    });
  });

  describe("updateDetails", () => {
    it("trims the name before storing it", () => {
      const project = createProject();

      project.updateDetails({ name: "  Renamed  ", now: later });

      expect(project.name).toBe("Renamed");
      expect(project.updatedAt).toEqual(later);
    });

    it("rejects a whitespace-only name", () => {
      const project = createProject();

      expect(() => {
        project.updateDetails({ name: "   ", now: later });
      }).toThrow(DomainError);
    });

    it("does not bump updatedAt when validation fails", () => {
      const project = createProject();

      expect(() => {
        project.updateDetails({ name: "   ", now: later });
      }).toThrow(DomainError);
      expect(project.updatedAt).toEqual(now);
    });

    it("skips a field that is omitted (undefined)", () => {
      const project = reconstituteProject({ genre: "Fantasy" });

      project.updateDetails({ name: "My Novel", now: later });

      expect(project.genre).toBe("Fantasy");
    });

    it("clears a field when null is passed explicitly", () => {
      const project = reconstituteProject({ genre: "Fantasy" });

      project.updateDetails({ name: "My Novel", genre: null, now: later });

      expect(project.genre).toBeNull();
      expect(project.updatedAt).toEqual(later);
    });

    it("clears a field when a whitespace-only string is passed", () => {
      const project = reconstituteProject({ description: "Old summary" });

      project.updateDetails({
        name: "My Novel",
        description: "   ",
        now: later,
      });

      expect(project.description).toBeNull();
    });

    it("trims a non-empty field before storing it", () => {
      const project = createProject();

      project.updateDetails({
        name: "My Novel",
        genre: "  Science Fiction  ",
        now: later,
      });

      expect(project.genre).toBe("Science Fiction");
    });

    it("updates only the targeted fields and leaves the rest untouched", () => {
      const project = reconstituteProject({
        description: "Keep me",
        genre: "Fantasy",
        tone: "Dark",
        style: "Terse",
        language: "en",
      });

      project.updateDetails({
        name: "My Novel",
        tone: "Hopeful",
        language: null,
        now: later,
      });

      expect(project.description).toBe("Keep me");
      expect(project.genre).toBe("Fantasy");
      expect(project.tone).toBe("Hopeful");
      expect(project.style).toBe("Terse");
      expect(project.language).toBeNull();
    });

    it("does not allow an archived project to be updated", () => {
      const project = reconstituteProject({
        status: "archived",
        archivedAt: now,
      });

      expect(() => {
        project.updateDetails({ name: "My Novel", now: later });
      }).toThrow(DomainError);
    });
  });

  describe("lifecycle", () => {
    it("activates a draft project", () => {
      const project = createProject();

      project.activate(later);

      expect(project.status).toBe("active");
      expect(project.updatedAt).toEqual(later);
    });

    it("does not allow an archived project to be activated", () => {
      const project = reconstituteProject({
        status: "archived",
        archivedAt: now,
      });

      expect(() => {
        project.activate(later);
      }).toThrow(DomainError);
    });

    it("archives a project and records archivedAt", () => {
      const project = createProject();

      project.archive(later);

      expect(project.status).toBe("archived");
      expect(project.archivedAt).toEqual(later);
      expect(project.updatedAt).toEqual(later);
    });

    it("rejects archiving an already archived project", () => {
      const project = reconstituteProject({
        status: "archived",
        archivedAt: now,
      });

      expect(() => {
        project.archive(later);
      }).toThrow(
        new DomainError(
          DomainErrorCode.PROJECT_ALREADY_ARCHIVED,
          "Project is already archived",
        ),
      );
    });

    it("changes visibility", () => {
      const project = createProject();

      project.changeVisibility("public", later);

      expect(project.visibility).toBe("public");
      expect(project.updatedAt).toEqual(later);
    });

    it("does not allow visibility change on an archived project", () => {
      const project = reconstituteProject({
        status: "archived",
        archivedAt: now,
      });

      expect(() => {
        project.changeVisibility("public", later);
      }).toThrow(DomainError);
    });
  });

  describe("reconstitute", () => {
    it("does not normalize persisted state", () => {
      const project = reconstituteProject({
        name: "  Already Stored  ",
        genre: "  raw genre  ",
      });

      expect(project.name).toBe("  Already Stored  ");
      expect(project.genre).toBe("  raw genre  ");
    });

    it("rejects an archived snapshot without archivedAt", () => {
      expect(() => {
        reconstituteProject({ status: "archived", archivedAt: null });
      }).toThrow(DomainError);
    });

    it("rejects a non-archived snapshot that has archivedAt", () => {
      expect(() => {
        reconstituteProject({ status: "draft", archivedAt: now });
      }).toThrow(DomainError);
    });
  });
});
