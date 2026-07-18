import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type CharacterStatus = "draft" | "active" | "archived";

export type CharacterProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  name: string;
  archetype: string | null;
  background: string | null;
  personality: string | null;
  goal: string | null;
  description: string | null;
  content: string | null;
  status: CharacterStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateCharacterProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  archetype?: string | null;
  background?: string | null;
  personality?: string | null;
  goal?: string | null;
  description?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdateCharacterDetailsProperties = {
  name?: string;
  archetype?: string | null;
  background?: string | null;
  personality?: string | null;
  goal?: string | null;
  description?: string | null;
  content?: string | null;
  now: Date;
};

export class Character {
  private constructor(private readonly props: CharacterProperties) {
    Character.validate(props);
  }

  static create(props: CreateCharacterProperties): Character {
    return new Character({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      name: props.name.trim(),
      archetype: normalizeOptionalText(props.archetype ?? null),
      background: normalizeOptionalText(props.background ?? null),
      personality: normalizeOptionalText(props.personality ?? null),
      goal: normalizeOptionalText(props.goal ?? null),
      description: normalizeOptionalText(props.description ?? null),
      content: normalizeOptionalText(props.content ?? null),
      status: "draft",
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: CharacterProperties): Character {
    return new Character(props);
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

  get archetype(): string | null {
    return this.props.archetype;
  }
  get background(): string | null {
    return this.props.background;
  }
  get personality(): string | null {
    return this.props.personality;
  }
  get goal(): string | null {
    return this.props.goal;
  }
  get description(): string | null {
    return this.props.description;
  }

  get content(): string | null {
    return this.props.content;
  }

  get status(): CharacterStatus {
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

  changeStatus(status: CharacterStatus, now: Date): boolean {
    if (this.props.status === status) {
      return false;
    }

    const nextProperties: CharacterProperties = {
      ...this.props,
      status,
      updatedAt: now,
    };

    Character.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  updateDetails(input: UpdateCharacterDetailsProperties): boolean {
    const nextProperties: CharacterProperties = {
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

    if (input.archetype !== undefined) {
      const archetype = normalizeOptionalText(input.archetype);

      if (archetype !== this.props.archetype) {
        nextProperties.archetype = archetype;
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

    if (input.personality !== undefined) {
      const personality = normalizeOptionalText(input.personality);

      if (personality !== this.props.personality) {
        nextProperties.personality = personality;
        changed = true;
      }
    }

    if (input.goal !== undefined) {
      const goal = normalizeOptionalText(input.goal);

      if (goal !== this.props.goal) {
        nextProperties.goal = goal;
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

    Character.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): CharacterProperties {
    return { ...this.props };
  }

  private static validate(props: CharacterProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Character id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Character version must be a non-negative integer",
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
        "Character name is required",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    const validStatuses: readonly CharacterStatus[] = [
      "draft",
      "active",
      "archived",
    ];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid character status",
      );
    }

    if (props.status === "active") {
      const requiredFields = [
        ["archetype", props.archetype],
        ["background", props.background],
        ["personality", props.personality],
        ["description", props.description],
      ] as const;

      for (const [field, value] of requiredFields) {
        if (normalizeOptionalText(value) === null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            `Active character must have ${field}`,
          );
        }
      }
    }
  }
}
