import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type ContentEntityType =
  | "layer"
  | "map"
  | "character"
  | "faction"
  | "world_element"
  | "event"
  | "plot"
  | "chapter"
  | "scene";

export type ContentRevisionChangeType = "create" | "update" | "delete";

export type ContentRevisionProperties = {
  id: string;
  projectId: string;
  entityType: ContentEntityType;
  entityId: string;
  revisionNumber: number;
  changedByUserId: string;
  changeType: ContentRevisionChangeType;
  summary: string | null;
  reason: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  createdAt: Date;
};

type BaseCreateContentRevisionProperties = {
  id: string;
  projectId: string;
  entityType: ContentEntityType;
  entityId: string;
  revisionNumber: number;
  changedByUserId: string;
  summary?: string | null;
  reason?: string | null;
  now: Date;
};

export type CreateContentRevisionProperties =
  | (BaseCreateContentRevisionProperties & {
      changeType: "create";
      afterSnapshot: Record<string, unknown>;
    })
  | (BaseCreateContentRevisionProperties & {
      changeType: "update";
      beforeSnapshot: Record<string, unknown>;
      afterSnapshot: Record<string, unknown>;
    })
  | (BaseCreateContentRevisionProperties & {
      changeType: "delete";
      beforeSnapshot: Record<string, unknown>;
    });

export class ContentRevision {
  private constructor(private readonly props: ContentRevisionProperties) {
    ContentRevision.validate(props);
  }

  static create(props: CreateContentRevisionProperties): ContentRevision {
    return new ContentRevision({
      id: props.id,
      projectId: props.projectId,
      entityType: props.entityType,
      entityId: props.entityId,
      revisionNumber: props.revisionNumber,
      changedByUserId: props.changedByUserId,
      changeType: props.changeType,
      summary: normalizeOptionalText(props.summary ?? null),
      reason: normalizeOptionalText(props.reason ?? null),
      beforeSnapshot:
        props.changeType === "create" ? null : props.beforeSnapshot,
      afterSnapshot: props.changeType === "delete" ? null : props.afterSnapshot,
      createdAt: props.now,
    });
  }

  static reconstitute(props: ContentRevisionProperties): ContentRevision {
    return new ContentRevision(props);
  }

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get entityType(): ContentEntityType {
    return this.props.entityType;
  }

  get entityId(): string {
    return this.props.entityId;
  }

  get revisionNumber(): number {
    return this.props.revisionNumber;
  }

  get changedByUserId(): string {
    return this.props.changedByUserId;
  }

  get changeType(): ContentRevisionChangeType {
    return this.props.changeType;
  }

  get summary(): string | null {
    return this.props.summary;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get beforeSnapshot(): Record<string, unknown> | null {
    return this.props.beforeSnapshot;
  }

  get afterSnapshot(): Record<string, unknown> | null {
    return this.props.afterSnapshot;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  toSnapshot(): ContentRevisionProperties {
    return { ...this.props };
  }

  private static validate(props: ContentRevisionProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Content revision id is required",
      );
    }

    if (props.projectId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Project id is required",
      );
    }

    if (props.entityId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Entity id is required",
      );
    }

    const validEntityTypes: readonly ContentEntityType[] = [
      "layer",
      "map",
      "character",
      "faction",
      "world_element",
      "event",
      "plot",
      "chapter",
      "scene",
    ];

    if (!validEntityTypes.includes(props.entityType)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid content entity type",
      );
    }

    if (props.changedByUserId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Changed by user id is required",
      );
    }

    if (!Number.isInteger(props.revisionNumber) || props.revisionNumber < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Revision number must be a non-negative integer",
      );
    }

    switch (props.changeType) {
      case "create":
        if (props.beforeSnapshot !== null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            "Create revision must not have before snapshot",
          );
        }

        if (props.afterSnapshot === null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            "Create revision must have after snapshot",
          );
        }

        break;

      case "update":
        if (props.beforeSnapshot === null || props.afterSnapshot === null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            "Update revision must have both before and after snapshots",
          );
        }

        break;

      case "delete":
        if (props.beforeSnapshot === null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            "Delete revision must have before snapshot",
          );
        }

        if (props.afterSnapshot !== null) {
          throw new DomainError(
            DomainErrorCode.DOMAIN_VALIDATION_FAILED,
            "Delete revision must not have after snapshot",
          );
        }

        break;

      default: {
        const exhaustiveCheck: never = props.changeType;
        throw new DomainError(
          DomainErrorCode.DOMAIN_VALIDATION_FAILED,
          `Invalid content revision change type: ${String(exhaustiveCheck)}`,
        );
      }
    }
  }
}
