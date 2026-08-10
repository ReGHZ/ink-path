import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type EventStatus = "draft" | "published";

export type EventProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  title: string;
  era: string | null;
  timelineOrder: number | null;
  eventType: string | null;
  significance: string | null;
  description: string | null;
  content: string | null;
  status: EventStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateEventProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  title: string;
  era?: string | null;
  timelineOrder?: number | null;
  eventType?: string | null;
  significance?: string | null;
  description?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdateEventDetailsProperties = {
  title?: string;
  era?: string | null;
  timelineOrder?: number | null;
  eventType?: string | null;
  significance?: string | null;
  description?: string | null;
  content?: string | null;
  now: Date;
};

export class Event {
  private constructor(private readonly props: EventProperties) {
    Event.validate(props);
  }

  static create(props: CreateEventProperties): Event {
    return new Event({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      title: props.title.trim(),
      era: normalizeOptionalText(props.era ?? null),
      timelineOrder: props.timelineOrder ?? null,
      eventType: normalizeOptionalText(props.eventType ?? null),
      significance: normalizeOptionalText(props.significance ?? null),
      description: normalizeOptionalText(props.description ?? null),
      content: normalizeOptionalText(props.content ?? null),
      status: "draft",
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: EventProperties): Event {
    return new Event(props);
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

  get title(): string {
    return this.props.title;
  }

  get era(): string | null {
    return this.props.era;
  }

  get timelineOrder(): number | null {
    return this.props.timelineOrder;
  }

  get eventType(): string | null {
    return this.props.eventType;
  }

  get significance(): string | null {
    return this.props.significance;
  }

  get description(): string | null {
    return this.props.description;
  }

  get content(): string | null {
    return this.props.content;
  }

  get status(): EventStatus {
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

  changeStatus(status: EventStatus, now: Date): boolean {
    if (this.props.status === status) {
      return false;
    }

    const nextProperties: EventProperties = {
      ...this.props,
      status,
      updatedAt: now,
    };

    Event.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  updateDetails(input: UpdateEventDetailsProperties): boolean {
    const nextProperties: EventProperties = {
      ...this.props,
    };

    let changed = false;

    if (input.title !== undefined) {
      const title = input.title.trim();

      if (title !== this.props.title) {
        nextProperties.title = title;
        changed = true;
      }
    }

    if (input.era !== undefined) {
      const era = normalizeOptionalText(input.era);

      if (era !== this.props.era) {
        nextProperties.era = era;
        changed = true;
      }
    }

    if (input.timelineOrder !== undefined) {
      if (input.timelineOrder !== this.props.timelineOrder) {
        nextProperties.timelineOrder = input.timelineOrder;
        changed = true;
      }
    }

    if (input.eventType !== undefined) {
      const eventType = normalizeOptionalText(input.eventType);

      if (eventType !== this.props.eventType) {
        nextProperties.eventType = eventType;
        changed = true;
      }
    }

    if (input.significance !== undefined) {
      const significance = normalizeOptionalText(input.significance);

      if (significance !== this.props.significance) {
        nextProperties.significance = significance;
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

    Event.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): EventProperties {
    return { ...this.props };
  }

  private static validate(props: EventProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Event id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Event version must be a non-negative integer",
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

    if (props.title.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Event title is required",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    if (
      props.timelineOrder !== null &&
      !Number.isInteger(props.timelineOrder)
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Event timeline order must be an integer",
      );
    }

    const validStatuses: readonly EventStatus[] = ["draft", "published"];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid event status",
      );
    }

    if (
      props.status === "published" &&
      normalizeOptionalText(props.content) === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Published event must have content",
      );
    }
  }
}
