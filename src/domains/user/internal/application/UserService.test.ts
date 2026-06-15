import { describe, expect, it } from "vitest";

import { UserService } from "./UserService.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import { User } from "../domain/User.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type { UserRepository } from "../domain/UserRepository.js";

const now = new Date("2026-06-10T00:00:00.000Z");
const later = new Date("2026-06-10T01:00:00.000Z");

class FakeUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  updateCalls = 0;

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(
      [...this.users.values()].find((user) => user.email === email) ?? null,
    );
  }

  findByUsername(username: string): Promise<User | null> {
    return Promise.resolve(
      [...this.users.values()].find((user) => user.username === username) ??
      null,
    );
  }

  insert(user: User): Promise<void> {
    this.users.set(user.id, user);
    return Promise.resolve();
  }

  update(user: User): Promise<void> {
    this.updateCalls += 1;
    this.users.set(user.id, user);
    return Promise.resolve();
  }
}

const clock: Clock = {
  now: () => later,
};

function createUser(id = "user-1"): User {
  return User.create({
    id,
    email: `${id}@example.com`,
    passwordHash: "hashed-password",
    now,
  });
}

function createService() {
  const users = new FakeUserRepository();

  return {
    users,
    service: new UserService(users, clock),
  };
}

describe("UserService", () => {
  describe("getMyProfile", () => {
    it("returns the profile for an existing active user", async () => {
      const { service, users } = createService();
      const user = createUser();

      await users.insert(user);

      const profile = await service.getMyProfile(user.id);

      expect(profile).toEqual({
        id: "user-1",
        email: "user-1@example.com",
        username: null,
        displayName: null,
        avatarUrl: null,
      });
      expect(Object.hasOwn(profile, "passwordHash")).toBe(false);
      expect(Object.hasOwn(profile, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the user does not exist", async () => {
      const { service } = createService();

      await expect(service.getMyProfile("missing-user")).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("throws NOT_FOUND when the user is deleted", async () => {
      const { service, users } = createService();
      const user = createUser();

      user.markDeleted(now);
      await users.insert(user);

      await expect(service.getMyProfile(user.id)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe("updateMyProfile", () => {
    it("persists displayName and avatarUrl changes", async () => {
      const { service, users } = createService();
      const user = createUser();

      await users.insert(user);

      await service.updateMyProfile(user.id, {
        avatarUrl: "https://example.com/avatar.png",
        displayName: "Writer",
      });

      const persistedUser = await users.findById(user.id);

      expect(users.updateCalls).toBe(1);
      expect(persistedUser?.displayName).toBe("Writer");
      expect(persistedUser?.avatarUrl).toBe("https://example.com/avatar.png");
    });

    it("returns the updated mapped profile", async () => {
      const { service, users } = createService();
      const user = createUser();

      await users.insert(user);

      const profile = await service.updateMyProfile(user.id, {
        displayName: "Writer",
      });

      expect(profile).toEqual({
        id: "user-1",
        email: "user-1@example.com",
        username: null,
        displayName: "Writer",
        avatarUrl: null,
      });
      expect(Object.hasOwn(profile, "passwordHash")).toBe(false);
      expect(Object.hasOwn(profile, "props")).toBe(false);
    });

    it("throws NOT_FOUND when the user does not exist", async () => {
      const { service } = createService();

      await expect(
        service.updateMyProfile("missing-user", {
          displayName: "Writer",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("throws NOT_FOUND when the user is deleted", async () => {
      const { service, users } = createService();
      const user = createUser();

      user.markDeleted(now);
      await users.insert(user);

      await expect(
        service.updateMyProfile(user.id, {
          displayName: "Writer",
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it("keeps avatarUrl unchanged when only displayName changes", async () => {
      const { service, users } = createService();
      const user = createUser();

      user.changeProfile({
        avatarUrl: "https://example.com/old-avatar.png",
        displayName: "Old Writer",
        now,
      });
      await users.insert(user);

      const profile = await service.updateMyProfile(user.id, {
        displayName: "New Writer",
      });

      expect(users.updateCalls).toBe(1);
      expect(profile.displayName).toBe("New Writer");
      expect(profile.avatarUrl).toBe("https://example.com/old-avatar.png");
    });

    it("does not write when the input is empty", async () => {
      const { service, users } = createService();
      const user = createUser();

      user.changeProfile({
        avatarUrl: "https://example.com/avatar.png",
        displayName: "Writer",
        now,
      });
      await users.insert(user);

      const profile = await service.updateMyProfile(user.id, {});

      expect(users.updateCalls).toBe(0);
      expect(profile).toEqual({
        id: "user-1",
        email: "user-1@example.com",
        username: null,
        displayName: "Writer",
        avatarUrl: "https://example.com/avatar.png",
      });
    });

    it("does not write when submitted values are unchanged", async () => {
      const { service, users } = createService();
      const user = createUser();

      user.changeProfile({
        avatarUrl: "https://example.com/avatar.png",
        displayName: "Writer",
        now,
      });
      await users.insert(user);

      const profile = await service.updateMyProfile(user.id, {
        avatarUrl: "https://example.com/avatar.png",
        displayName: "Writer",
      });

      expect(users.updateCalls).toBe(0);
      expect(profile.displayName).toBe("Writer");
      expect(profile.avatarUrl).toBe("https://example.com/avatar.png");
    });
  });
});
