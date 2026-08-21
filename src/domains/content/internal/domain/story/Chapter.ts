import { normalizeOptionalText } from "../../../../../shared/domain/normalizeOptionalText.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";

export type ChapterStatus = "outline" | "draft" | "review" | "published";

export type ChapterProperties = {
  id: string;
  version: number;
  projectId: string;
  createdByUserId: string;
  title: string;
  order: number;
  summary: string | null;
  content: string | null;
  status: ChapterStatus;
  publishedAt: Date | null;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateChapterProperties = {
  id: string;
  projectId: string;
  createdByUserId: string;
  title: string;
  order: number;
  summary?: string | null;
  content?: string | null;
  currentRevisionId: string;
  now: Date;
};

export type UpdateChapterDetailsProperties = {
  title?: string;
  order?: number;
  summary?: string | null;
  content?: string | null;
  now: Date;
};

export class Chapter {
  private constructor(private readonly props: ChapterProperties) {
    Chapter.validate(props);
  }

  static create(props: CreateChapterProperties): Chapter {
    return new Chapter({
      id: props.id,
      version: 0,
      projectId: props.projectId,
      createdByUserId: props.createdByUserId,
      title: props.title.trim(),
      order: props.order,
      summary: normalizeOptionalText(props.summary ?? null),
      content: normalizeOptionalText(props.content ?? null),
      status: "outline",
      publishedAt: null,
      currentRevisionId: props.currentRevisionId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ChapterProperties): Chapter {
    return new Chapter(props);
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

  get order(): number {
    return this.props.order;
  }

  get summary(): string | null {
    return this.props.summary;
  }

  get content(): string | null {
    return this.props.content;
  }

  get status(): ChapterStatus {
    return this.props.status;
  }

  get publishedAt(): Date | null {
    return this.props.publishedAt;
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

  // Flow 5 Transition 1 (02-system-design/03_flow_05_chapter_lifecycle.md:40-64):
  // outline -> draft, guard = summary must be present. No side effect.
  startDrafting(now: Date): boolean {
    this.assertOrigin("outline", "draft");

    if (normalizeOptionalText(this.props.summary) === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter summary is required before leaving outline",
      );
    }

    return this.applyTransition({ status: "draft", now });
  }

  // Flow 5 Transition 2 (lines 68-92): draft -> review, guard = content must
  // be present. No side effect.
  submitForReview(now: Date): boolean {
    this.assertOrigin("draft", "review");

    if (normalizeOptionalText(this.props.content) === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter content is required before submitting for review",
      );
    }

    return this.applyTransition({ status: "review", now });
  }

  // Flow 5 Transition 3 (lines 96-120): review -> published, side effect =
  // publishedAt set to now. No additional guard beyond the standing
  // "published requires content" invariant enforced in validate().
  publish(now: Date): boolean {
    this.assertOrigin("review", "published");

    return this.applyTransition({ status: "published", publishedAt: now, now });
  }

  // Flow 5 Transition 4 (lines 124-146): review -> draft (revision request).
  // The doc's "clear review/approval status" side effect has no matching
  // column in the frozen schema (content-story.prisma:128-159 has no
  // approval field) — this is a pure status change.
  requestRevision(now: Date): boolean {
    this.assertOrigin("review", "draft");

    return this.applyTransition({ status: "draft", now });
  }

  // Flow 5 Transition 5 (lines 150-172): published -> draft (unpublish),
  // side effect = publishedAt cleared to null.
  unpublish(now: Date): boolean {
    this.assertOrigin("published", "draft");

    return this.applyTransition({ status: "draft", publishedAt: null, now });
  }

  // Flow 5 "Keputusan Desain" (line 16/188): "Semua editing terjadi di
  // draft. Transisi mundur selalu kembali ke draft." — this is a frozen
  // design decision, not a casual description. review/published are
  // deliberately non-editable directly: the only way back to an editable
  // state is requestRevision()/unpublish(). outline stays editable — it is
  // the only way to fill `summary` before startDrafting() can even run.
  updateDetails(input: UpdateChapterDetailsProperties): boolean {
    if (this.props.status === "review" || this.props.status === "published") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Chapter cannot be edited while status is ${this.props.status}; transition back to draft first`,
      );
    }

    const nextProperties: ChapterProperties = {
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

    if (input.order !== undefined && input.order !== this.props.order) {
      nextProperties.order = input.order;
      changed = true;
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

    if (!changed) {
      return false;
    }

    nextProperties.updatedAt = input.now;

    Chapter.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  toSnapshot(): ChapterProperties {
    return { ...this.props };
  }

  // Transition methods only ever check the ORIGIN status here — validate()
  // has no notion of "previous state", it only ever sees a final snapshot.
  // Any status pair not covered by the five public transition methods above
  // is simply unreachable: there is no generic changeStatus(target) that
  // could jump e.g. outline -> published directly.
  private assertOrigin(expected: ChapterStatus, target: ChapterStatus): void {
    if (this.props.status !== expected) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        `Cannot transition chapter from ${this.props.status} to ${target}: expected ${expected}`,
      );
    }
  }

  private applyTransition(
    changes: Partial<
      Pick<ChapterProperties, "status" | "publishedAt">
    > & { now: Date },
  ): boolean {
    const nextProperties: ChapterProperties = {
      ...this.props,
      ...changes,
      updatedAt: changes.now,
    };

    Chapter.validate(nextProperties);

    Object.assign(this.props, nextProperties);

    return true;
  }

  private static validate(props: ChapterProperties): void {
    if (props.id.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter id is required",
      );
    }

    if (!Number.isInteger(props.version) || props.version < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter version must be a non-negative integer",
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
        "Chapter title is required",
      );
    }

    // `03-database-design/06_content_tables.md:217` only says "integer",
    // no explicit non-negative requirement — but a negative chapter
    // position has no coherent narrative meaning, same reasoning as
    // `version >= 0` below having no doc citation either.
    if (!Number.isInteger(props.order) || props.order < 0) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Chapter order must be a non-negative integer",
      );
    }

    if (props.currentRevisionId.trim() === "") {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Current revision id is required",
      );
    }

    const validStatuses: readonly ChapterStatus[] = [
      "outline",
      "draft",
      "review",
      "published",
    ];

    if (!validStatuses.includes(props.status)) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Invalid chapter status",
      );
    }

    // Standing invariant, not just a transition-time check: content is the
    // deliverable itself once a chapter claims review/published. updateDetails()
    // now blocks edits outside outline/draft, so this can no longer be
    // violated through normal application code — this is defense-in-depth
    // against a corrupted row reaching reconstitute() directly.
    if (
      (props.status === "review" || props.status === "published") &&
      normalizeOptionalText(props.content) === null
    ) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Review or published chapter must have content",
      );
    }

    // publishedAt is a pure side-assertion marker of the published state, not
    // an independent fact — it must be set if and only if status is
    // published. This also closes the reconstitute() gap: a corrupted row
    // (e.g. published with publishedAt null) is rejected here, not just
    // prevented by the transition methods.
    if (props.status === "published" && props.publishedAt === null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Published chapter must have publishedAt set",
      );
    }

    if (props.status !== "published" && props.publishedAt !== null) {
      throw new DomainError(
        DomainErrorCode.DOMAIN_VALIDATION_FAILED,
        "Only a published chapter may have publishedAt set",
      );
    }

    // summary is intentionally NOT a standing invariant here — it is only
    // required at the moment of the outline -> draft transition
    // (startDrafting()). Once past outline, summary is scaffolding the
    // Writer may clear without invalidating the chapter's current state.
  }
}
