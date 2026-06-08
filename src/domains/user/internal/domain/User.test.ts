import { describe, expect, it } from "vitest";

import { User } from "./User.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";

const now = new Date("2026-06-08T00:00:00.000Z");
const later = new Date("2026-06-08T01:00:00.000Z");

type UserSnapshot = Parameters<typeof User.reconstitute>[0];

const baseUserSnapshot: UserSnapshot = {
    id: "user-1",
    email: "test@example.com",
    username: null,
    passwordHash: "hashed-password",
    displayName: null,
    avatarUrl: null,
    status: "active",
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
};

function createUser(): User {
    return User.create({
        id: "user-1",
        email: "test@example.com",
        passwordHash: "hashed-password",
        now,
    });
}

function reconstituteUser(overrides: Partial<UserSnapshot> = {}): User {
    return User.reconstitute({
        ...baseUserSnapshot,
        ...overrides,
    });
}

describe("User", () => {
    it("creates active user with normalized email", () => {
        const user = User.create({
            id: "user-1",
            email: " Test@Example.COM ",
            username: "tester",
            passwordHash: "hashed-password",
            now,
        });

        expect(user.email).toBe("test@example.com");
        expect(user.status).toBe("active");
        expect(user.canLogin()).toBe(false);
    });

    it("rejects invalid email", () => {
        expect(() => {
            User.create({
                id: "user-1",
                email: "invalid-email",
                passwordHash: "hashed-password",
                now,
            });
        }).toThrow(DomainError);
    });

    it("rejects empty password hash", () => {
        expect(() => {
            User.create({
                id: "user-1",
                email: "test@example.com",
                passwordHash: " ",
                now,
            });
        }).toThrow(DomainError);
    });

    it("does not normalize email when reconstituting persisted state", () => {
        const user = User.reconstitute({
            id: "user-1",
            email: "Test@Example.com",
            username: null,
            passwordHash: "hashed-password",
            displayName: null,
            avatarUrl: null,
            status: "active",
            emailVerifiedAt: null,
            lastLoginAt: null,
            createdAt: now,
            updatedAt: now,
        });

        expect(user.email).toBe("Test@Example.com");
    });

    it("marks active user as logged in", () => {
        const user = createUser();

        user.verifyEmail(now);
        user.markLoggedIn(later);

        expect(user.lastLoginAt).toEqual(later);
        expect(user.updatedAt).toEqual(later);
    });

    it("does not allow disabled user to login", () => {
        const user = createUser();

        user.disable(now);

        expect(() => {
            user.markLoggedIn(now);
        }).toThrow(DomainError);
    });

    it("allows disabled user to be activated", () => {
        const user = createUser();

        user.disable(now);
        user.activate(later);

        expect(user.status).toBe("active");
        expect(user.updatedAt).toEqual(later);
    });

    it("does not allow deleted user to be activated", () => {
        const user = createUser();

        user.markDeleted(now);

        expect(() => {
            user.activate(now);
        }).toThrow(DomainError);
    });

    it("does not expose password hash through normal getters", () => {
        const user = createUser();

        expect(user.getPasswordHash()).toBe("hashed-password");
        expect("passwordHash" in user).toBe(false);
    });

    it("verifies email for an unverified user", () => {
        const user = createUser();

        user.verifyEmail(later);

        expect(user.emailVerifiedAt).toEqual(later);
        expect(user.updatedAt).toEqual(later);
        expect(user.canLogin()).toBe(true);
    });

    it("keeps email verification idempotent", () => {
        const user = reconstituteUser({
            emailVerifiedAt: now,
            updatedAt: now,
        });

        user.verifyEmail(later);

        expect(user.emailVerifiedAt).toEqual(now);
        expect(user.updatedAt).toEqual(now);
    });

    it("does not allow deleted user to verify email", () => {
        const user = reconstituteUser({
            status: "deleted",
        });

        expect(() => {
            user.verifyEmail(later);
        }).toThrow("Deleted user cannot verify email");
    });

    it("changes profile fields", () => {
        const user = createUser();

        user.changeProfile({
            avatarUrl: "https://example.com/avatar.png",
            displayName: "Ink Writer",
            now: later,
        });

        expect(user.displayName).toBe("Ink Writer");
        expect(user.avatarUrl).toBe("https://example.com/avatar.png");
        expect(user.updatedAt).toEqual(later);
    });

    it("changes profile fields partially", () => {
        const user = reconstituteUser({
            avatarUrl: "https://example.com/old.png",
            displayName: "Old Name",
        });

        user.changeProfile({
            displayName: "New Name",
            now: later,
        });

        expect(user.displayName).toBe("New Name");
        expect(user.avatarUrl).toBe("https://example.com/old.png");
        expect(user.updatedAt).toEqual(later);
    });

    it("does not allow deleted user profile to be changed", () => {
        const user = reconstituteUser({
            status: "deleted",
        });

        expect(() => {
            user.changeProfile({
                displayName: "Blocked",
                now: later,
            });
        }).toThrow("Deleted user profile cannot be changed");
    });

    it("marks user as deleted", () => {
        const user = createUser();

        user.markDeleted(later);

        expect(user.status).toBe("deleted");
        expect(user.updatedAt).toEqual(later);
    });

    it("keeps mark deleted idempotent", () => {
        const user = reconstituteUser({
            status: "deleted",
            updatedAt: now,
        });

        user.markDeleted(later);

        expect(user.status).toBe("deleted");
        expect(user.updatedAt).toEqual(now);
    });

    it("keeps disable idempotent", () => {
        const user = reconstituteUser({
            status: "disabled",
            updatedAt: now,
        });

        user.disable(later);

        expect(user.status).toBe("disabled");
        expect(user.updatedAt).toEqual(now);
    });

    it("returns a snapshot copy of all fields", () => {
        const user = reconstituteUser({
            displayName: "Original Name",
            emailVerifiedAt: now,
        });

        const snapshot = user.toSnapshot();

        expect(snapshot).toEqual({
            ...baseUserSnapshot,
            displayName: "Original Name",
            emailVerifiedAt: now,
        });

        snapshot.displayName = "Mutated Name";

        expect(user.displayName).toBe("Original Name");
    });

    it("rejects login for deleted user with specific reason", () => {
        const user = reconstituteUser({
            emailVerifiedAt: now,
            status: "deleted",
        });

        expect(() => {
            user.assertCanLogin();
        }).toThrow("Account deleted");
    });

    it("rejects login for disabled user with specific reason", () => {
        const user = reconstituteUser({
            emailVerifiedAt: now,
            status: "disabled",
        });

        expect(() => {
            user.assertCanLogin();
        }).toThrow("Account disabled");
    });

    it("rejects login for unverified user with specific reason", () => {
        const user = createUser();

        expect(() => {
            user.assertCanLogin();
        }).toThrow("Email is not verified");
    });

    it("rejects login when password login is unavailable", () => {
        const user = reconstituteUser({
            emailVerifiedAt: now,
            passwordHash: null,
        });

        expect(() => {
            user.assertCanLogin();
        }).toThrow("Password login is not available");
    });

    it("allows login when active verified user has password hash", () => {
        const user = reconstituteUser({
            emailVerifiedAt: now,
        });

        expect(() => {
            user.assertCanLogin();
        }).not.toThrow();
        expect(user.canLogin()).toBe(true);
    });
});
