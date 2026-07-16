import { describe, expect, it } from "vitest";

import { UserProjectService } from "./UserProjectService.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { UserProject } from "../domain/UserProject.js";
import {
  UserProjectRepositoryConflictError,
  UserProjectRepositoryNotFoundError,
} from "../domain/UserProjectRepositoryError.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type { ProjectRepository } from "../domain/ProjectRepository.js";
import type { UserProjectRepository } from "../domain/UserProjectRepository.js";
import type {
  ProjectRepositories,
  ProjectUnitOfWork,
} from "./ports/ProjectUnitOfWork.js";

const now = new Date("2026-06-15T00:00:00.000Z");
const later = new Date("2026-06-15T01:00:00.000Z");
const laterClock: Clock = { now: () => later };

const projectId = "proj-1";
const ownerId = "user-owner";
const memberId = "user-member";

class FakeUserProjectRepository implements UserProjectRepository {
  readonly memberships = new Map<string, UserProject>();
  readonly updateCalls: UserProject[] = [];
  // Simulates snapshot-too-old: the next load of this id returns a copy whose
  // version is older than the stored one (caller loaded before another writer
  // committed). Models the race window the optimistic WHERE version catches.
  readonly staleLoadVersions = new Map<string, number>();
  // Simulates row disappearing between load and update: the next FOR UPDATE
  // load of this id returns a copy, then the store forgets the row so update's
  // follow-up findUnique (the count===0 disambiguation) finds nothing.
  disappearAfterLoad: string | null = null;

  copy(entity: UserProject): UserProject {
    // Loads return fresh objects, like a DB row → caller mutations never touch
    // the store directly. Keeps the in-memory fake honest with Prisma.
    return UserProject.reconstitute(entity.toSnapshot());
  }

  findActiveByProjectIdAndUserId(
    pId: string,
    userId: string,
  ): Promise<UserProject | null> {
    const stored = [...this.memberships.values()].find(
      (m) => m.projectId === pId && m.userId === userId && m.status === "active",
    ) ?? null;

    return Promise.resolve(stored ? this.copy(stored) : null);
  }

  findActiveByProjectIdAndUserIdForUpdate(
    pId: string,
    userId: string,
  ): Promise<UserProject | null> {
    const stored = [...this.memberships.values()].find(
      (m) => m.projectId === pId && m.userId === userId && m.status === "active",
    ) ?? null;

    if (!stored) {
      return Promise.resolve(null);
    }

    if (this.disappearAfterLoad === stored.id) {
      this.disappearAfterLoad = null;
      const snapshot = stored.toSnapshot();
      this.memberships.delete(stored.id);
      return Promise.resolve(UserProject.reconstitute(snapshot));
    }

    const staleVersion = this.staleLoadVersions.get(stored.id);
    if (staleVersion !== undefined) {
      this.staleLoadVersions.delete(stored.id);
      return Promise.resolve(
        UserProject.reconstitute({ ...stored.toSnapshot(), version: staleVersion }),
      );
    }

    return Promise.resolve(this.copy(stored));
  }

  findActiveByProjectId(pId: string): Promise<UserProject[]> {
    return Promise.resolve(
      [...this.memberships.values()]
        .filter((m) => m.projectId === pId && m.status === "active")
        .map((m) => this.copy(m)),
    );
  }

  insert(userProject: UserProject): Promise<void> {
    this.memberships.set(userProject.id, this.copy(userProject));
    return Promise.resolve();
  }

  update(userProject: UserProject): Promise<void> {
    // Optimistic concurrency (policy 06 §3 Opsi A): match the version the
    // caller loaded; reject on mismatch like the real updateMany count===0 path.
    const current = this.memberships.get(userProject.id);

    if (!current) {
      return Promise.reject(new UserProjectRepositoryNotFoundError());
    }

    if (userProject.version !== current.version) {
      return Promise.reject(new UserProjectRepositoryConflictError());
    }

    const bumped = UserProject.reconstitute({
      ...userProject.toSnapshot(),
      version: userProject.version + 1,
    });

    this.updateCalls.push(userProject);
    this.memberships.set(userProject.id, bumped);
    return Promise.resolve();
  }
}

class FakeProjectUnitOfWork implements ProjectUnitOfWork {
  constructor(private readonly userProjectRepo: UserProjectRepository) { }

  async transaction<T>(
    work: (repositories: ProjectRepositories) => Promise<T>,
  ): Promise<T> {
    return work({
      projects: {} as ProjectRepository,
      userProjects: this.userProjectRepo,
    });
  }
}

function createService() {
  const userProjects = new FakeUserProjectRepository();
  const uow = new FakeProjectUnitOfWork(userProjects);

  return {
    userProjects,
    service: new UserProjectService(laterClock, userProjects, uow),
  };
}

function makeWriter(id: string, userId: string): UserProject {
  return UserProject.create({ id, projectId, userId, now });
}

function makeEditor(id: string, userId: string): UserProject {
  const m = UserProject.create({ id, projectId, userId, now });
  m.changeRole("editor", now);
  return m;
}

describe("UserProjectService", () => {
  describe("listMembers", () => {
    it("returns empty array when project has no members", async () => {
      const { service } = createService();

      const result = await service.listMembers(projectId);

      expect(result).toEqual([]);
    });

    it("returns MemberDetail with correctly mapped fields", async () => {
      const { userProjects, service } = createService();

      const membership = makeWriter("up-1", ownerId);
      userProjects.memberships.set(membership.id, membership);

      const result = await service.listMembers(projectId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "up-1",
        userId: ownerId,
        role: "writer",
        canDelete: true,
        aiAccess: "full",
        joinedAt: now,
        invitedByUserId: null,
      });
    });

    it("does not leak entity internals in returned MemberDetail", async () => {
      const { userProjects, service } = createService();

      const membership = makeWriter("up-1", ownerId);
      userProjects.memberships.set(membership.id, membership);

      const result = await service.listMembers(projectId);

      const [first] = result;
      expect(first).toBeDefined();
      if (first !== undefined) {
        expect(Object.hasOwn(first, "props")).toBe(false);
      }
    });

    it("returns only active memberships", async () => {
      const { userProjects, service } = createService();

      const active = makeWriter("up-1", ownerId);
      const removed = UserProject.reconstitute({
        id: "up-2",
        projectId,
        userId: memberId,
        role: "editor",
        canDelete: false,
        aiAccess: "none",
        status: "removed",
        version: 0,
        joinedAt: now,
        removedAt: later,
        invitedByUserId: null,
        createdAt: now,
        updatedAt: later,
      });
      userProjects.memberships.set(active.id, active);
      userProjects.memberships.set(removed.id, removed);

      const result = await service.listMembers(projectId);

      expect(result).toHaveLength(1);
      const [first] = result;
      expect(first?.id).toBe("up-1");
    });
  });

  describe("changeMemberRole", () => {
    it("changes non-writer role successfully and persists", async () => {
      const { userProjects, service } = createService();

      const editor = makeEditor("up-1", memberId);
      userProjects.memberships.set(editor.id, editor);

      await service.changeMemberRole(projectId, memberId, "reviewer");

      expect(userProjects.updateCalls).toHaveLength(1);
      const [firstCall] = userProjects.updateCalls;
      expect(firstCall?.role).toBe("reviewer");
    });

    it("throws NOT_FOUND when membership does not exist", async () => {
      const { service } = createService();

      await expect(
        service.changeMemberRole(projectId, "no-such-user", "reviewer"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });

    it("throws FORBIDDEN when demoting the last writer", async () => {
      const { userProjects, service } = createService();

      const soleWriter = makeWriter("up-1", ownerId);
      userProjects.memberships.set(soleWriter.id, soleWriter);

      await expect(
        service.changeMemberRole(projectId, ownerId, "editor"),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it("allows demoting a writer when another writer exists in the project", async () => {
      const { userProjects, service } = createService();

      const writer1 = makeWriter("up-1", ownerId);
      const writer2 = makeWriter("up-2", memberId);
      userProjects.memberships.set(writer1.id, writer1);
      userProjects.memberships.set(writer2.id, writer2);

      await service.changeMemberRole(projectId, ownerId, "editor");

      expect(userProjects.updateCalls).toHaveLength(1);
      const [firstCall] = userProjects.updateCalls;
      expect(firstCall?.role).toBe("editor");
    });

    it("does not check writer count when changing the role of a non-writer", async () => {
      const { userProjects, service } = createService();

      // Project has no writers at all — only one editor.
      // Changing editor → reviewer should succeed without writer-count logic.
      const editor = makeEditor("up-1", memberId);
      userProjects.memberships.set(editor.id, userProjects.copy(editor));

      await service.changeMemberRole(projectId, memberId, "reviewer");

      expect(userProjects.updateCalls).toHaveLength(1);
    });

    it("is a no-op when the new role matches the current role: skips update entirely", async () => {
      const { userProjects, service } = createService();

      const editor = makeEditor("up-1", memberId);
      userProjects.memberships.set(editor.id, userProjects.copy(editor));

      await service.changeMemberRole(projectId, memberId, "editor");

      expect(userProjects.updateCalls).toHaveLength(0);
    });

    it("maps a version conflict on update to CONFLICT (409)", async () => {
      const { userProjects, service } = createService();

      const membership = makeEditor("up-1", memberId);
      // Seed at v0, then simulate another writer committing v1 underneath us,
      // while our caller's loaded snapshot is still v0 (snapshot-too-old).
      userProjects.memberships.set(
        membership.id,
        UserProject.reconstitute({ ...membership.toSnapshot(), version: 1 }),
      );
      userProjects.staleLoadVersions.set(membership.id, 0);

      await expect(
        service.changeMemberRole(projectId, memberId, "reviewer"),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

      expect(userProjects.updateCalls).toHaveLength(0);
    });

    it("maps a disappeared-row on update to NOT_FOUND (404)", async () => {
      const membership = makeEditor("up-1", memberId);
      const { userProjects, service } = createService();
      userProjects.memberships.set(membership.id, userProjects.copy(membership));

      // After load resolves, the store drops the row so update's follow-up
      // findUnique lands on nothing -> UserProjectRepositoryNotFoundError.
      userProjects.disappearAfterLoad = membership.id;

      await expect(
        service.changeMemberRole(projectId, memberId, "reviewer"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

      expect(userProjects.updateCalls).toHaveLength(0);
    });
  });
});
