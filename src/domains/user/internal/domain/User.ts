import { DomainError } from "../../../../shared/errors/DomainError.js";

export type UserStatus = "active" | "disabled" | "deleted";

export type UserProperties = {
    id: string;
    email: string;
    username: string | null;
    passwordHash: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    status: UserStatus;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

export type CreateUserProperties = {
    id: string;
    email: string;
    username?: string | null;
    passwordHash: string;
    displayName?: string | null;
    now: Date;
};


const USER_STATUSES: readonly UserStatus[] = ["active", "disabled", "deleted"];

export class User {
    private constructor(private readonly props: UserProperties) {
        User.validate(props);
    }

    static create(props: CreateUserProperties): User {
        return new User({
            id: props.id,
            email: User.normalizeEmail(props.email),
            username: props.username ?? null,
            passwordHash: props.passwordHash,
            displayName: props.displayName ?? null,
            avatarUrl: null,
            status: "active",
            emailVerifiedAt: null,
            lastLoginAt: null,
            createdAt: props.now,
            updatedAt: props.now,
        });
    }

    static reconstitute(props: UserProperties): User {
        return new User(props);
    }

    get id(): string {
        return this.props.id;
    }

    get email(): string {
        return this.props.email;
    }

    get username(): string | null {
        return this.props.username;
    }

    get displayName(): string | null {
        return this.props.displayName;
    }

    get avatarUrl(): string | null {
        return this.props.avatarUrl;
    }

    get status(): UserStatus {
        return this.props.status;
    }

    get emailVerifiedAt(): Date | null {
        return this.props.emailVerifiedAt;
    }

    get lastLoginAt(): Date | null {
        return this.props.lastLoginAt;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    get updatedAt(): Date {
        return this.props.updatedAt;
    }

    getPasswordHash(): string | null {
        return this.props.passwordHash;
    }

    assertCanLogin(): void {
        if (this.props.status === "disabled") {
            throw new DomainError("Account disabled");
        }

        if (this.props.status === "deleted") {
            throw new DomainError("Account deleted");
        }

        if (this.props.emailVerifiedAt === null) {
            throw new DomainError("Email is not verified");
        }

        if (this.props.passwordHash === null) {
            throw new DomainError("Password login is not available");
        }
    }

    canLogin(): boolean {
        try {
            this.assertCanLogin();
            return true;
        } catch {
            return false;
        }
    }

    markLoggedIn(now: Date): void {
        if (!this.canLogin()) {
            throw new DomainError("User cannot login");
        }

        this.props.lastLoginAt = now;
        this.props.updatedAt = now;
    }

    verifyEmail(now: Date): void {
        if (this.props.status === "deleted") {
            throw new DomainError("Deleted user cannot verify email");
        }

        if (this.props.emailVerifiedAt !== null) {
            return;
        }

        this.props.emailVerifiedAt = now;
        this.props.updatedAt = now;
    }

    changeProfile(input: {
        displayName?: string | null;
        avatarUrl?: string | null;
        now: Date;
    }): void {
        if (this.props.status === "deleted") {
            throw new DomainError("Deleted user profile cannot be changed");
        }

        if (input.displayName !== undefined) {
            this.props.displayName = input.displayName;
        }

        if (input.avatarUrl !== undefined) {
            this.props.avatarUrl = input.avatarUrl;
        }

        this.props.updatedAt = input.now;
    }

    disable(now: Date): void {
        if (this.props.status === "deleted") {
            throw new DomainError("Deleted user cannot be disabled");
        }

        if (this.props.status === "disabled") {
            return;
        }

        this.props.status = "disabled";
        this.props.updatedAt = now;
    }

    activate(now: Date): void {
        if (this.props.status === "deleted") {
            throw new DomainError("Deleted user cannot be activated");
        }

        if (this.props.status === "active") {
            return;
        }

        this.props.status = "active";
        this.props.updatedAt = now;
    }

    markDeleted(now: Date): void {
        if (this.props.status === "deleted") {
            return;
        }

        this.props.status = "deleted";
        this.props.updatedAt = now;
    }

    toSnapshot(): UserProperties {
        return { ...this.props };
    }

    private static normalizeEmail(email: string): string {
        return email.trim().toLowerCase();
    }

    private static validate(props: UserProperties): void {
        if (props.id.trim() === "") {
            throw new DomainError("User id is required");
        }

        if (!User.isValidEmail(props.email)) {
            throw new DomainError("Invalid user email");
        }

        if (!USER_STATUSES.includes(props.status)) {
            throw new DomainError("Invalid user status");
        }

        if (props.passwordHash !== null && props.passwordHash.trim() === "") {
            throw new DomainError("Password hash cannot be empty");
        }
    }

    private static isValidEmail(email: string): boolean {
        const trimmed = email.trim();

        if (trimmed.length === 0 || trimmed.length > 254) {
            return false;
        }

        const atIndex = trimmed.indexOf("@");

        if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf("@")) {
            return false;
        }

        const domain = trimmed.slice(atIndex + 1);

        return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
    }
}