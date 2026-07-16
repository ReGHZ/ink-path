import { describe, expect, it } from "vitest";

import { UserProject } from "./UserProject.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";

const now = new Date("2026-06-14T00:00:00.000Z");
const later = new Date("2026-06-14T01:00:00.000Z");

type UserProjectSnapshot = Parameters<typeof UserProject.reconstitute>[0];

const baseSnapshot: UserProjectSnapshot = {
  id: "membership-1",
  projectId: "project-1",
  userId: "user-1",
  role: "writer",
  canDelete: true,
  aiAccess: "full",
  status: "active",
  version: 0,
  joinedAt: now,
  removedAt: null,
  invitedByUserId: null,
  createdAt: now,
  updatedAt: now,
};

function createMembership(): UserProject {
  return UserProject.create({
    id: "membership-1",
    projectId: "project-1",
    userId: "user-1",
    now,
  });
}

function reconstituteMembership(
  overrides: Partial<UserProjectSnapshot> = {},
): UserProject {
  return UserProject.reconstitute({
    ...baseSnapshot,
    ...overrides,
  });
}

describe("UserProject", () => {
  describe("create", () => {
    it("creates the creator membership with locked owner defaults", () => {
      const membership = createMembership();

      expect(membership.role).toBe("writer");
      expect(membership.canDelete).toBe(true);
      expect(membership.aiAccess).toBe("full");
      expect(membership.status).toBe("active");
      expect(membership.removedAt).toBeNull();
      expect(membership.invitedByUserId).toBeNull();
    });

    it("stamps joinedAt, createdAt and updatedAt with the creation time", () => {
      const membership = createMembership();

      expect(membership.joinedAt).toEqual(now);
      expect(membership.createdAt).toEqual(now);
      expect(membership.updatedAt).toEqual(now);
    });

    it("rejects an empty project id", () => {
      expect(() => {
        UserProject.create({
          id: "membership-1",
          projectId: " ",
          userId: "user-1",
          now,
        });
      }).toThrow(DomainError);
    });

    it("rejects an empty user id", () => {
      expect(() => {
        UserProject.create({
          id: "membership-1",
          projectId: "project-1",
          userId: " ",
          now,
        });
      }).toThrow(DomainError);
    });
  });

  describe("changeRole", () => {
    it("changes the role and bumps updatedAt", () => {
      const membership = createMembership();

      const changed = membership.changeRole("editor", later);

      expect(changed).toBe(true);
      expect(membership.role).toBe("editor");
      expect(membership.updatedAt).toEqual(later);
    });

    it("is a no-op when the role is unchanged: does not bump updatedAt", () => {
      const membership = createMembership();

      const changed = membership.changeRole("writer", later);

      expect(changed).toBe(false);
      expect(membership.role).toBe("writer");
      expect(membership.updatedAt).toEqual(now);
    });

    it("does not touch the other two permission axes", () => {
      const membership = createMembership();

      membership.changeRole("reviewer", later);

      expect(membership.canDelete).toBe(true);
      expect(membership.aiAccess).toBe("full");
    });

    it("rejects changing the role of a removed membership", () => {
      const membership = reconstituteMembership({
        status: "removed",
        removedAt: now,
      });

      expect(() => {
        membership.changeRole("editor", later);
      }).toThrow(
        new DomainError(
          DomainErrorCode.MEMBERSHIP_NOT_ACTIVE,
          "Cannot modify an inactive membership",
        ),
      );
    });

    it("rejects changing the role of a left membership", () => {
      const membership = reconstituteMembership({
        status: "left",
        removedAt: now,
      });

      expect(() => {
        membership.changeRole("editor", later);
      }).toThrow(DomainError);
    });

    it("rejects changing the role of a disabled membership", () => {
      const membership = reconstituteMembership({
        status: "disabled",
        removedAt: now,
      });

      expect(() => {
        membership.changeRole("editor", later);
      }).toThrow(DomainError);
    });

    it("does not mutate state when the guard rejects", () => {
      const membership = reconstituteMembership({
        role: "writer",
        status: "removed",
        removedAt: now,
        updatedAt: now,
      });

      expect(() => {
        membership.changeRole("editor", later);
      }).toThrow(DomainError);
      expect(membership.role).toBe("writer");
      expect(membership.updatedAt).toEqual(now);
    });
  });

  describe("validate (via reconstitute)", () => {
    it("rejects a negative or non-integer version", () => {
      expect(() => {
        reconstituteMembership({ version: -1 });
      }).toThrow(DomainError);

      expect(() => {
        reconstituteMembership({ version: 1.5 });
      }).toThrow(DomainError);
    });

    it("rejects an unknown role", () => {
      expect(() => {
        reconstituteMembership({ role: "owner" as never });
      }).toThrow(DomainError);
    });

    it("rejects an unknown ai access", () => {
      expect(() => {
        reconstituteMembership({ aiAccess: "partial" as never });
      }).toThrow(DomainError);
    });

    it("rejects an unknown status", () => {
      expect(() => {
        reconstituteMembership({ status: "banned" as never });
      }).toThrow(DomainError);
    });

    it("rejects an active membership that has removedAt", () => {
      expect(() => {
        reconstituteMembership({ status: "active", removedAt: now });
      }).toThrow(DomainError);
    });

    it("rejects an inactive membership without removedAt", () => {
      expect(() => {
        reconstituteMembership({ status: "removed", removedAt: null });
      }).toThrow(DomainError);
    });

    it("rejects an active membership without joinedAt", () => {
      expect(() => {
        reconstituteMembership({ status: "active", joinedAt: null });
      }).toThrow(DomainError);
    });

    it("accepts an inactive membership that has removedAt", () => {
      const membership = reconstituteMembership({
        status: "left",
        removedAt: later,
      });

      expect(membership.status).toBe("left");
      expect(membership.removedAt).toEqual(later);
    });

    it("rejects a membership invited by itself", () => {
      expect(() => {
        reconstituteMembership({ invitedByUserId: "user-1" });
      }).toThrow(DomainError);
    });

    it("rejects an empty inviter id", () => {
      expect(() => {
        reconstituteMembership({ invitedByUserId: " " });
      }).toThrow(DomainError);
    });

    it("accepts a valid inviter that differs from the member", () => {
      const membership = reconstituteMembership({
        invitedByUserId: "user-2",
      });

      expect(membership.invitedByUserId).toBe("user-2");
    });
  });

  describe("reconstitute", () => {
    it("carries persisted state through without normalizing", () => {
      const membership = reconstituteMembership({
        role: "reviewer",
        canDelete: false,
        aiAccess: "limited",
        invitedByUserId: "user-2",
      });

      expect(membership.role).toBe("reviewer");
      expect(membership.canDelete).toBe(false);
      expect(membership.aiAccess).toBe("limited");
      expect(membership.invitedByUserId).toBe("user-2");
    });
  });
});
