import { normalizeOptionalText } from "../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";

export type ProjectVisibility = "private" | "shared" | "public";

export type ProjectStatus = "draft" | "active" | "archived";

export type ProjectProperties = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  genre: string | null;
  tone: string | null;
  style: string | null;
  language: string | null;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CreateProjectProperties = {
  id: string;
  ownerUserId: string;
  createdByUserId: string;
  name: string;
  description?: string;
  genre?: string;
  tone?: string;
  style?: string;
  language?: string;
  now: Date;
};

export type UpdateProjectDetailsProperties = {
  name: string;
  description?: string | null;
  genre?: string | null;
  tone?: string | null;
  style?: string | null;
  language?: string | null;
  now: Date;
};

const PROJECT_VISIBILITIES: readonly ProjectVisibility[] = [
  "private",
  "shared",
  "public",
];

const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "draft",
  "active",
  "archived",
];

export class Project {
  private constructor(private readonly props: ProjectProperties) {
    Project.validate(props);
  }

  static create(props: CreateProjectProperties): Project {
    return new Project({
      id: props.id,
      ownerUserId: props.ownerUserId,
      createdByUserId: props.createdByUserId,
      name: props.name.trim(),
      description: normalizeOptionalText(props.description ?? null),
      genre: normalizeOptionalText(props.genre ?? null),
      tone: normalizeOptionalText(props.tone ?? null),
      style: normalizeOptionalText(props.style ?? null),
      language: normalizeOptionalText(props.language ?? null),
      visibility: "private",
      status: "draft",
      createdAt: props.now,
      updatedAt: props.now,
      archivedAt: null,
    });
  }

  static reconstitute(props: ProjectProperties): Project {
    return new Project(props);
  }

  get id(): string {
    return this.props.id;
  }

  get ownerUserId(): string {
    return this.props.ownerUserId;
  }

  get createdByUserId(): string {
    return this.props.createdByUserId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get genre(): string | null {
    return this.props.genre;
  }

  get tone(): string | null {
    return this.props.tone;
  }

  get style(): string | null {
    return this.props.style;
  }

  get language(): string | null {
    return this.props.language;
  }

  get visibility(): ProjectVisibility {
    return this.props.visibility;
  }

  get status(): ProjectStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get archivedAt(): Date | null {
    return this.props.archivedAt;
  }

  updateDetails(input: UpdateProjectDetailsProperties): void {
    this.ensureNotArchived();

    const name = input.name.trim();

    if (name === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project name cannot be empty",
      );
    }

    this.props.name = name;

    if (input.description !== undefined) {
      this.props.description = normalizeOptionalText(input.description);
    }

    if (input.genre !== undefined) {
      this.props.genre = normalizeOptionalText(input.genre);
    }

    if (input.tone !== undefined) {
      this.props.tone = normalizeOptionalText(input.tone);
    }

    if (input.style !== undefined) {
      this.props.style = normalizeOptionalText(input.style);
    }

    if (input.language !== undefined) {
      this.props.language = normalizeOptionalText(input.language);
    }

    this.props.updatedAt = input.now;

    Project.validate(this.props);
  }

  activate(now: Date): void {
    this.ensureNotArchived();

    this.props.status = "active";
    this.props.updatedAt = now;

    Project.validate(this.props);
  }

  archive(now: Date): void {
    if (this.props.status === "archived") {
      throw new DomainError(
        DomainErrorCode.PROJECT_ALREADY_ARCHIVED,
        "Project is already archived",
      );
    }

    this.props.status = "archived";
    this.props.archivedAt = now;
    this.props.updatedAt = now;

    Project.validate(this.props);
  }

  changeVisibility(input: ProjectVisibility, now: Date): void {
    this.ensureNotArchived();

    this.props.visibility = input;
    this.props.updatedAt = now;

    Project.validate(this.props);
  }

  toSnapshot(): ProjectProperties {
    return { ...this.props };
  }

  private ensureNotArchived(): void {
    if (this.props.status === "archived") {
      throw new DomainError(
        DomainErrorCode.PROJECT_ALREADY_ARCHIVED,
        "Project is archived",
      );
    }
  }

  private static validate(props: ProjectProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    if (props.ownerUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Owner user id is required",
      );
    }

    if (props.createdByUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Created by user id is required",
      );
    }

    if (props.name.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project name is required",
      );
    }

    if (!PROJECT_VISIBILITIES.includes(props.visibility)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid project visibility",
      );
    }

    if (!PROJECT_STATUSES.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid project status",
      );
    }

    if (props.status === "archived" && props.archivedAt === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Archived project must have archivedAt",
      );
    }

    if (props.status !== "archived" && props.archivedAt !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Non-archived project must not have archivedAt",
      );
    }
  }
}
