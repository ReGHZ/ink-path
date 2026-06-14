import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";

export type ProjectRole = "writer" | "editor" | "reviewer";

export type ProjectAiAccess = "none" | "limited" | "full";

export type UserProjectStatus = "active" | "removed" | "left" | "disabled";

export type UserProjectProperties = {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  canDelete: boolean;
  aiAccess: ProjectAiAccess;
  status: UserProjectStatus;
  joinedAt: Date | null;
  removedAt: Date | null;
  invitedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserProjectProperties = {
  id: string;
  projectId: string;
  userId: string;
  now: Date;
};

const PROJECT_ROLES: readonly ProjectRole[] = ["writer", "editor", "reviewer"];

const PROJECT_AI_ACCESS: readonly ProjectAiAccess[] = [
  "none",
  "limited",
  "full",
];

const USER_PROJECT_STATUSES: readonly UserProjectStatus[] = [
  "active",
  "removed",
  "left",
  "disabled",
];

export class UserProject {
  private constructor(private readonly props: UserProjectProperties) {
    UserProject.validate(props);
  }

  static create(props: CreateUserProjectProperties): UserProject {
    return new UserProject({
      id: props.id,
      projectId: props.projectId,
      userId: props.userId,
      role: "writer",
      canDelete: true,
      aiAccess: "full",
      status: "active",
      joinedAt: props.now,
      removedAt: null,
      invitedByUserId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: UserProjectProperties): UserProject {
    return new UserProject(props);
  }

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get role(): ProjectRole {
    return this.props.role;
  }

  get canDelete(): boolean {
    return this.props.canDelete;
  }

  get aiAccess(): ProjectAiAccess {
    return this.props.aiAccess;
  }

  get status(): UserProjectStatus {
    return this.props.status;
  }

  get joinedAt(): Date | null {
    return this.props.joinedAt;
  }

  get removedAt(): Date | null {
    return this.props.removedAt;
  }

  get invitedByUserId(): string | null {
    return this.props.invitedByUserId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  changeRole(newRole: ProjectRole, now: Date): void {
    this.ensureActive();

    this.props.role = newRole;
    this.props.updatedAt = now;

    UserProject.validate(this.props);
  }

  toSnapshot(): UserProjectProperties {
    return { ...this.props };
  }

  private ensureActive(): void {
    if (this.props.status !== "active") {
      throw new DomainError(
        DomainErrorCode.MEMBERSHIP_NOT_ACTIVE,
        "Cannot modify an inactive membership",
      );
    }
  }

  private static validate(props: UserProjectProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "User project id is required",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    if (props.userId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "User id is required",
      );
    }

    if (!PROJECT_ROLES.includes(props.role)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid project role",
      );
    }

    if (!PROJECT_AI_ACCESS.includes(props.aiAccess)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid project AI access",
      );
    }

    if (!USER_PROJECT_STATUSES.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid user project status",
      );
    }

    if (props.status === "active" && props.removedAt !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Active membership must not have removedAt",
      );
    }

    if (props.status !== "active" && props.removedAt === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Inactive membership must have removedAt",
      );
    }

    if (props.status === "active" && props.joinedAt === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Active membership must have joinedAt",
      );
    }

    if (props.invitedByUserId !== null) {
      if (props.invitedByUserId.trim() === "") {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Inviter user id must not be empty",
        );
      }

      if (props.invitedByUserId === props.userId) {
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          "Member cannot be invited by themselves",
        );
      }
    }
  }
}
