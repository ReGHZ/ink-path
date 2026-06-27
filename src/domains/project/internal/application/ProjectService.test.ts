import { describe, expect, it } from "vitest";

import { ProjectService } from "./ProjectService.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { Project } from "../domain/Project.js";
import { ProjectRepositoryNotFoundError } from "../domain/ProjectRepositoryError.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../shared/application/ports/IdGenerator.js";
import type { ProjectRepository } from "../domain/ProjectRepository.js";
import type { UserProject } from "../domain/UserProject.js";
import type { UserProjectRepository } from "../domain/UserProjectRepository.js";
import type {
  ProjectRepositories,
  ProjectUnitOfWork,
} from "./ports/ProjectUnitOfWork.js";

const now = new Date("2026-06-15T00:00:00.000Z");
const later = new Date("2026-06-15T01:00:00.000Z");

class FakeProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  findById(id: string): Promise<Project | null> {
    return Promise.resolve(this.projects.get(id) ?? null);
  }

  findByOwnerUserId(ownerUserId: string): Promise<Project[]> {
    return Promise.resolve(
      [...this.projects.values()].filter((p) => p.ownerUserId === ownerUserId),
    );
  }

  insert(project: Project): Promise<void> {
    this.projects.set(project.id, project);
    return Promise.resolve();
  }

  update(project: Project): Promise<void> {
    this.projects.set(project.id, project);
    return Promise.resolve();
  }
}

class FakeUserProjectRepository implements UserProjectRepository {
  readonly memberships = new Map<string, UserProject>();

  findActiveByProjectIdAndUserId(
    projectId: string,
    userId: string,
  ): Promise<UserProject | null> {
    return Promise.resolve(
      [...this.memberships.values()].find(
        (m) => m.projectId === projectId && m.userId === userId && m.status === "active",
      ) ?? null,
    );
  }

  findActiveByProjectIdAndUserIdForUpdate(
    projectId: string,
    userId: string,
  ): Promise<UserProject | null> {
    return this.findActiveByProjectIdAndUserId(projectId, userId);
  }

  findActiveByProjectId(projectId: string): Promise<UserProject[]> {
    return Promise.resolve(
      [...this.memberships.values()].filter(
        (m) => m.projectId === projectId && m.status === "active",
      ),
    );
  }

  insert(userProject: UserProject): Promise<void> {
    this.memberships.set(userProject.id, userProject);
    return Promise.resolve();
  }

  update(userProject: UserProject): Promise<void> {
    this.memberships.set(userProject.id, userProject);
    return Promise.resolve();
  }
}

class FakeProjectUnitOfWork implements ProjectUnitOfWork {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly userProjectRepo: UserProjectRepository,
  ) { }

  async transaction<T>(
    work: (repositories: ProjectRepositories) => Promise<T>,
  ): Promise<T> {
    return work({
      projects: this.projectRepo,
      userProjects: this.userProjectRepo,
    });
  }
}

class FakeIdGenerator implements IdGenerator {
  private nextId = 1;

  generate(): string {
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return id;
  }
}

const clock: Clock = { now: () => now };
const laterClock: Clock = { now: () => later };

function createService(options: { clock?: Clock } = {}) {
  const projects = new FakeProjectRepository();
  const userProjects = new FakeUserProjectRepository();
  const idGenerator = new FakeIdGenerator();
  const uow = new FakeProjectUnitOfWork(projects, userProjects);

  return {
    projects,
    userProjects,
    service: new ProjectService(options.clock ?? clock, idGenerator, projects, uow),
  };
}

describe("ProjectService", () => {
  describe("createProject", () => {
    it("creates project and creator membership atomically, returns projectId", async () => {
      const { projects, userProjects, service } = createService();

      const result = await service.createProject({
        requestingUserId: "user-1",
        name: "My Novel",
      });

      expect(result.projectId).toBeDefined();
      expect(projects.projects.size).toBe(1);
      expect(userProjects.memberships.size).toBe(1);
    });

    it("creates project with correct owner and defaults", async () => {
      const { projects, service } = createService();

      const result = await service.createProject({
        requestingUserId: "user-1",
        name: "My Novel",
        genre: "Fantasy",
      });

      const project = projects.projects.get(result.projectId);

      expect(project?.ownerUserId).toBe("user-1");
      expect(project?.createdByUserId).toBe("user-1");
      expect(project?.name).toBe("My Novel");
      expect(project?.genre).toBe("Fantasy");
      expect(project?.status).toBe("draft");
      expect(project?.visibility).toBe("private");
    });

    it("creates creator membership as writer with full permissions", async () => {
      const { userProjects, service } = createService();

      const result = await service.createProject({
        requestingUserId: "user-1",
        name: "My Novel",
      });

      const membership = [...userProjects.memberships.values()][0];

      expect(membership?.projectId).toBe(result.projectId);
      expect(membership?.userId).toBe("user-1");
      expect(membership?.role).toBe("writer");
      expect(membership?.canDelete).toBe(true);
      expect(membership?.aiAccess).toBe("full");
      expect(membership?.status).toBe("active");
    });
  });

  describe("getProjectById", () => {
    it("returns ProjectDetail with all fields correctly mapped", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        description: "A story",
        now,
      });
      await projects.insert(project);

      const detail = await service.getProjectById("proj-1");

      expect(detail).toEqual({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        description: "A story",
        genre: null,
        tone: null,
        style: null,
        language: null,
        visibility: "private",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      });
    });

    it("does not leak entity internals", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      await projects.insert(project);

      const detail = await service.getProjectById("proj-1");

      expect(Object.hasOwn(detail, "props")).toBe(false);
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      const { service } = createService();

      await expect(service.getProjectById("missing")).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe("updateProjectDetails", () => {
    it("updates fields and returns updated detail", async () => {
      const { projects, service } = createService({ clock: laterClock });

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "Old Name",
        now,
      });
      await projects.insert(project);

      const detail = await service.updateProjectDetails("proj-1", {
        name: "New Name",
        description: "Updated description",
        genre: "Fantasy",
      });

      expect(detail.name).toBe("New Name");
      expect(detail.description).toBe("Updated description");
      expect(detail.genre).toBe("Fantasy");
    });

    it("persists the update to the repository", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "Old Name",
        now,
      });
      await projects.insert(project);

      await service.updateProjectDetails("proj-1", { name: "New Name" });

      const persisted = await projects.findById("proj-1");
      expect(persisted?.name).toBe("New Name");
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateProjectDetails("missing", { name: "Name" }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws CONFLICT when updating an archived project", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      project.archive(now);
      await projects.insert(project);

      await expect(
        service.updateProjectDetails("proj-1", { name: "New Name" }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it("throws NOT_FOUND when project disappears between load and update", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      await projects.insert(project);

      projects.update = (): Promise<void> =>
        Promise.reject(new ProjectRepositoryNotFoundError());

      await expect(
        service.updateProjectDetails("proj-1", { name: "New Name" }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("activateProject", () => {
    it("sets status to active and persists", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      await projects.insert(project);

      await service.activateProject("proj-1");

      const persisted = await projects.findById("proj-1");
      expect(persisted?.status).toBe("active");
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      const { service } = createService();

      await expect(service.activateProject("missing")).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("throws CONFLICT when activating an archived project", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      project.archive(now);
      await projects.insert(project);

      await expect(service.activateProject("proj-1")).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
    });
  });

  describe("archiveProject", () => {
    it("sets status to archived with archivedAt and persists", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      await projects.insert(project);

      await service.archiveProject("proj-1");

      const persisted = await projects.findById("proj-1");
      expect(persisted?.status).toBe("archived");
      expect(persisted?.archivedAt).toEqual(now);
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      const { service } = createService();

      await expect(service.archiveProject("missing")).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("throws CONFLICT when archiving an already-archived project", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      project.archive(now);
      await projects.insert(project);

      await expect(service.archiveProject("proj-1")).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
    });
  });

  describe("changeProjectVisibility", () => {
    it("changes visibility and persists", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      await projects.insert(project);

      await service.changeProjectVisibility("proj-1", { visibility: "public" });

      const persisted = await projects.findById("proj-1");
      expect(persisted?.visibility).toBe("public");
    });

    it("throws NOT_FOUND when project does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeProjectVisibility("missing", { visibility: "public" }),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws CONFLICT when changing visibility of an archived project", async () => {
      const { projects, service } = createService();

      const project = Project.create({
        id: "proj-1",
        ownerUserId: "user-1",
        createdByUserId: "user-1",
        name: "My Novel",
        now,
      });
      project.archive(now);
      await projects.insert(project);

      await expect(
        service.changeProjectVisibility("proj-1", { visibility: "public" }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });
});
