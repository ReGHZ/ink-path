import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type SceneStatus = "draft" | "published";

export type SceneProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  chapterId: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  orderInChapter: number;
  status: SceneStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSceneProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  chapterId: string;
  orderInChapter: number;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdateSceneDetailsProperties = {
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  orderInChapter?: number;
  now: Date;
};

export class Scene {
  private constructor(private readonly props: SceneProperties) {
    Scene.validate(props);
  }

  static create(props: CreateSceneProperties): Scene {
    return new Scene({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      chapterId: props.chapterId,
      title: normalizeOptionalText(props.title ?? null),
      summary: normalizeOptionalText(props.summary ?? null),
      content: normalizeOptionalText(props.content ?? null),
      orderInChapter: props.orderInChapter,
      status: "draft",
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: SceneProperties): Scene {
    return new Scene(props);
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

  get chapterId(): string {
    return this.props.chapterId;
  }

  get title(): string | null {
    return this.props.title;
  }

  get summary(): string | null {
    return this.props.summary;
  }

  get content(): string | null {
    return this.props.content;
  }

  get orderInChapter(): number {
    return this.props.orderInChapter;
  }

  get status(): SceneStatus {
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

  changeStatus(status: SceneStatus, now: Date): boolean {
    if (this.props.status === status) {
      return false;
    }

    const nextProperties: SceneProperties = {
      ...this.props,
      status,
      updatedAt: now,
    };

    Scene.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  updateDetails(input: UpdateSceneDetailsProperties): boolean {
    const nextProperties: SceneProperties = {
      ...this.props,
    };

    let changed = false;

    if (input.title !== undefined) {
      const title = normalizeOptionalText(input.title);

      if (title !== this.props.title) {
        nextProperties.title = title;
        changed = true;
      }
    }

    if (input.summary !== undefined) {
      const summary = normalizeOptionalText(input.summary);

      if (summary !== this.props.summary) {
        nextProperties.summary = summary;
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

    if (
      input.orderInChapter !== undefined &&
      input.orderInChapter !== this.props.orderInChapter
    ) {
      nextProperties.orderInChapter = input.orderInChapter;
      changed = true;
    }

    if (!changed) {
      return false;
    }

    nextProperties.updatedAt = input.now;

    Scene.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): SceneProperties {
    return { ...this.props };
  }

  private static validate(props: SceneProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Scene id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Scene version must be a non-negative integer",
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

    // chapterId is an opaque established-aggregate token, same treatment as
    // currentRevisionId below — parent existence and same-project ownership
    // are cross-aggregate facts only Chapter's own row can answer, checked
    // in SceneService before Scene.create() is ever called, not here.
    if (props.chapterId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter id is required",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    // Uniqueness of orderInChapter per chapter is a DB constraint
    // (`@@unique([chapterId, orderInChapter])`), not a domain invariant —
    // same reasoning as Chapter.order: a single entity instance cannot see
    // its siblings, only its own field shape.
    if (!Number.isInteger(props.orderInChapter) || props.orderInChapter < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Scene order in chapter must be a non-negative integer",
      );
    }

    const validStatuses: readonly SceneStatus[] = ["draft", "published"];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid scene status",
      );
    }

    if (
      props.status === "published" &&
      normalizeOptionalText(props.content) === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Published scene must have content",
      );
    }
  }
}
