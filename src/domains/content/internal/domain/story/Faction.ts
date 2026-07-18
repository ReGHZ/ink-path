import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type FactionStatus = "draft" | "active" | "archived";

export type FactionProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  background: string | null;
  ideology: string | null;
  size: string | null;
  content: string | null;
  status: FactionStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateFactionProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  description?: string | null;
  background?: string | null;
  ideology?: string | null;
  size?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdateFactionDetailsProperties = {
  name?: string;
  description?: string | null;
  background?: string | null;
  ideology?: string | null;
  size?: string | null;
  content?: string | null;
  now: Date;
};

export class Faction {
  private constructor(private readonly props: FactionProperties) {
    Faction.validate(props);
  }

  static create(props: CreateFactionProperties): Faction {
    return new Faction({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      name: props.name.trim(),
      background: normalizeOptionalText(props.background ?? null),
      ideology: normalizeOptionalText(props.ideology ?? null),
      size: normalizeOptionalText(props.size ?? null),
      description: normalizeOptionalText(props.description ?? null),
      content: normalizeOptionalText(props.content ?? null),
      status: "draft",
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: FactionProperties): Faction {
    return new Faction(props);
  }

  get id(): string {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get createdByUserId(): string {
    return this.props.createdByUserId;
  }

  get name(): string {
    return this.props.name;
  }

  get background(): string | null {
    return this.props.background;
  }

  get ideology(): string | null {
    return this.props.ideology;
  }

  get size(): string | null {
    return this.props.size;
  }

  get description(): string | null {
    return this.props.description;
  }

  get content(): string | null {
    return this.props.content;
  }

  get status(): FactionStatus {
    return this.props.status;
  }

  get currentRevisionId(): string {
    return this.props.currentRevisionId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  changeStatus(status: FactionStatus, now: Date): boolean {
    if (this.props.status === status) {
      return false;
    }

    const nextProperties: FactionProperties = {
      ...this.props,
      status,
      updatedAt: now,
    };

    Faction.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  updateDetails(input: UpdateFactionDetailsProperties): boolean {
    const nextProperties: FactionProperties = {
      ...this.props,
    };

    let changed = false;

    if (input.name !== undefined) {
      const name = input.name.trim();

      if (name !== this.props.name) {
        nextProperties.name = name;
        changed = true;
      }
    }

    if (input.background !== undefined) {
      const background = normalizeOptionalText(input.background);

      if (background !== this.props.background) {
        nextProperties.background = background;
        changed = true;
      }
    }

    if (input.ideology !== undefined) {
      const ideology = normalizeOptionalText(input.ideology);

      if (ideology !== this.props.ideology) {
        nextProperties.ideology = ideology;
        changed = true;
      }
    }

    if (input.size !== undefined) {
      const size = normalizeOptionalText(input.size);

      if (size !== this.props.size) {
        nextProperties.size = size;
        changed = true;
      }
    }

    if (input.description !== undefined) {
      const description = normalizeOptionalText(input.description);

      if (description !== this.props.description) {
        nextProperties.description = description;
        changed = true;
      }
    }

    if (input.content !== undefined) {
      const content = normalizeOptionalText(input.content);

      if (content !== this.props.content) {
        nextProperties.content = content;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    nextProperties.updatedAt = input.now;

    Faction.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): FactionProperties {
    return { ...this.props };
  }

  private static validate(props: FactionProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Faction id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Faction version must be a non-negative integer",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
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
        "Faction name is required",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    const validStatuses: readonly FactionStatus[] = [
      "draft",
      "active",
      "archived",
    ];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid faction status",
      );
    }

    if (props.status === "active") {
      const requiredFields = [
        ["description", props.description],
        ["background", props.background],
      ] as const;

      for (const [field, value] of requiredFields) {
        if (normalizeOptionalText(value) === null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            `Active faction must have ${field}`,
          );
        }
      }
    }
  }
}
