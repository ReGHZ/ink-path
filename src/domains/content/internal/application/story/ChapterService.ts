import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../../shared/errors/DomainErrorCode.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Chapter, type ChapterStatus } from "../../domain/story/Chapter.js";
import {
  ChapterRepositoryConflictError,
  ChapterRepositoryNotFoundError,
  ChapterRepositoryOrderConflictError,
  ChapterRepositoryReferencedError,
} from "../../domain/story/ChapterRepositoryError.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import {
  assertNoBlockingRelationships,
  mapBlockedByRelationshipsError,
} from "../support/contentRelationshipDeleteGuard.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateChapterInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  title: string;
  order: number;
  summary?: string | null;
  content?: string | null;
};

export type CreateChapterResult = {
  chapterId: string;
};

export type ChapterDetail = {
  id: string;
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

export type ChangeChapterStatusInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  status: ChapterStatus;
};

export type UpdateChapterInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  title?: string;
  order?: number;
  summary?: string | null;
  content?: string | null;
};

export type DeleteChapterInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

export function toRevisionSnapshot(chapter: Chapter): Record<string, unknown> {
  const snapshot = chapter.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    title: snapshot.title,
    order: snapshot.order,
    summary: snapshot.summary,
    content: snapshot.content,
    status: snapshot.status,
    publishedAt: snapshot.publishedAt?.toISOString() ?? null,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

// Flow 5 "Permission per Transisi" (03_flow_05_chapter_lifecycle.md:30-36):
// Writer and Editor may perform ALL FIVE transitions, Reviewer none. There is
// no per-transition permission split, so status changes use the same
// assertCanWrite as ordinary edits rather than a separate check.
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot modify chapters",
    );
  }
}

function assertCanDelete(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot delete chapters",
    );
  }

  if (membership.role === "editor" && !membership.canDelete) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Editor without delete permission cannot delete chapters",
    );
  }
}

// The five edges of Flow 5's state machine, one entry per row of its
// "Transisi Valid" table (03_flow_05_chapter_lifecycle.md:20-26), keyed
// (origin -> target). A table rather than nested ifs for one reason: the
// target status ALONE cannot identify a transition, because two different
// edges land on `draft` (review->draft = revision request, published->draft =
// unpublish). The single `/chapters/:id/status` endpoint (implementation order
// 6.5) therefore has to resolve the PAIR, and doing it as data keeps the
// mapping visibly 1:1 with the frozen table instead of buried in control flow.
//
// Anything absent from this table — including a same-status "transition" like
// draft -> draft — is an invalid transition per Flow 5, which requires a
// specific origin for every edge (steps 5 of each transition: "Status harus =
// X"). That is deliberately NOT treated as the harmless no-op that
// Event/Plot/Scene's changeStatus() returns: those entities have free
// transitions, Chapter does not.
const CHAPTER_TRANSITIONS: Readonly<
  Partial<
    Record<
      ChapterStatus,
      Partial<Record<ChapterStatus, (chapter: Chapter, now: Date) => boolean>>
    >
  >
> = {
  outline: {
    draft: (chapter, now) => chapter.startDrafting(now),
  },
  draft: {
    review: (chapter, now) => chapter.submitForReview(now),
  },
  review: {
    published: (chapter, now) => chapter.publish(now),
    draft: (chapter, now) => chapter.requestRevision(now),
  },
  published: {
    draft: (chapter, now) => chapter.unpublish(now),
  },
};

function applyTransition(
  chapter: Chapter,
  target: ChapterStatus,
  now: Date,
): boolean {
  const transition = CHAPTER_TRANSITIONS[chapter.status]?.[target];

  if (!transition) {
    throw new DomainError(
      DomainErrorCode.DOMAIN_VALIDATION_FAILED,
      `Cannot transition chapter from ${chapter.status} to ${target}`,
    );
  }

  return transition(chapter, now);
}

function mapChapterError(error: unknown): never {
  if (error instanceof ChapterRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Chapter not found");
  }

  // Ordered before the generic Conflict branch below because
  // OrderConflictError is NOT a subclass — it is a sibling with a different
  // meaning: deterministic and user-fixable (pick another position) versus
  // transient and retry-fixable (someone else wrote first). Collapsing them
  // would tell the caller to retry a write that can never succeed unchanged.
  if (error instanceof ChapterRepositoryOrderConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Another chapter in this project already uses that order",
    );
  }

  if (error instanceof ChapterRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Chapter was modified concurrently");
  }

  if (error instanceof ChapterRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Chapter still has scenes and cannot be deleted",
    );
  }

  // Covers both the transition guards (summary before draft, content before
  // review), the invalid-transition error raised by applyTransition, and
  // updateDetails()'s refusal to edit in review/published — all Flow 5 "400
  // Invalid transition / Guard failed" conditions.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class ChapterService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly chapterRepository: ChapterRepository,
    private readonly chapterUnitOfWork: ContentUnitOfWork<ChapterRepository>,
    // 7.4b: names the entities that block a delete. Only the delete path uses
    // it, and only after the guard has already refused the delete.
    private readonly contentEntityLocator: ContentEntityLocator,
  ) {}

  async createChapter(input: CreateChapterInput): Promise<CreateChapterResult> {
    assertCanWrite(input.requestingMembership);

    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    // See EventService.createEvent for why construction is wrapped here while
    // Phase 4 leaves it bare.
    let chapter: Chapter;
    try {
      chapter = Chapter.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        createdByUserId: input.requestingUserId,
        title: input.title,
        order: input.order,
        summary: input.summary,
        content: input.content,
        currentRevisionId: revisionId,
        now,
      });
    } catch (error) {
      mapChapterError(error);
    }

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "chapter",
      entityId: chapter.id,
      revisionNumber: chapter.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(chapter),
      now,
    });

    // Unlike Event/Plot, this transaction IS wrapped: `chapters` carries a
    // composite unique index on (project_id, order), so an insert can fail
    // with a genuine caller-facing condition (position already taken) that
    // must not surface as a raw 500.
    try {
      await this.chapterUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.entity.insert(chapter);
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.linkRevision(
            chapter.id,
            revisionId,
            chapter.version,
          );
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.created",
            eventVersion: 1,
            aggregateType: "chapter",
            aggregateId: chapter.id,
            projectId: chapter.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: chapter.projectId,
              entityType: "chapter",
              entityId: chapter.id,
              revisionId,
              revisionNumber: chapter.version,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.created",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapChapterError(error);
    }

    return { chapterId: chapter.id };
  }

  async getChapterById(
    projectId: string,
    chapterId: string,
  ): Promise<ChapterDetail> {
    const chapter = await this.loadExistingChapter(projectId, chapterId);

    return this.toChapterDetail(chapter);
  }

  async listChaptersByProject(projectId: string): Promise<ChapterDetail[]> {
    const chapters = await this.chapterRepository.findByProjectId(projectId);

    return chapters.map((chapter) => this.toChapterDetail(chapter));
  }

  // Flow 5 as a whole: one endpoint, five edges, resolved by (origin, target).
  async changeChapterStatus(
    projectId: string,
    chapterId: string,
    input: ChangeChapterStatusInput,
  ): Promise<ChapterDetail> {
    assertCanWrite(input.requestingMembership);

    const chapter = await this.loadExistingChapter(projectId, chapterId);
    const oldVersion = chapter.version;
    const beforeSnapshot = toRevisionSnapshot(chapter);

    // A transition is a real change to durable state, so it produces a
    // revision + outbox event exactly like an edit does — Flow 3's "Revision &
    // Indexing Side Effect" is about every persisted change, not only field
    // edits, and Phase 4's changeStatus paths already work this way.
    try {
      applyTransition(chapter, input.status, this.clock.now());
    } catch (error) {
      mapChapterError(error);
    }

    return this.persistChange(
      chapter,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateChapter(
    projectId: string,
    chapterId: string,
    input: UpdateChapterInput,
  ): Promise<ChapterDetail> {
    assertCanWrite(input.requestingMembership);

    const chapter = await this.loadExistingChapter(projectId, chapterId);
    const oldVersion = chapter.version;
    const beforeSnapshot = toRevisionSnapshot(chapter);

    let changed: boolean;
    try {
      // Throws when status is review/published — the entity, not this service,
      // owns "all editing happens in draft" (Flow 5 Keputusan Desain).
      changed = chapter.updateDetails({
        title: input.title,
        order: input.order,
        summary: input.summary,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapChapterError(error);
    }

    if (!changed) {
      return this.toChapterDetail(chapter);
    }

    return this.persistChange(
      chapter,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteChapter(
    projectId: string,
    chapterId: string,
    input: DeleteChapterInput,
  ): Promise<void> {
    assertCanDelete(input.requestingMembership);

    const chapter = await this.loadExistingChapter(projectId, chapterId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "chapter",
      entityId: chapter.id,
      revisionNumber: chapter.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(chapter),
      now,
    });

    try {
      await this.chapterUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          // Flow 3 §Delete step 5, M:N half (item 7.4b). First statement in the
          // transaction: it is a read, and everything below it is work a block
          // would throw away. The FK half stays where it always was — inside
          // repository.delete(), as ChapterRepositoryReferencedError.
          await assertNoBlockingRelationships(
            repositories.contentRelationships,
            { projectId, entityType: "chapter", entityId: chapter.id },
          );
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "chapter",
            aggregateId: chapter.id,
            projectId: chapter.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: chapter.projectId,
              entityType: "chapter",
              entityId: chapter.id,
              revisionId,
              revisionNumber: chapter.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          // Fails with ReferencedError while scenes still point here — the
          // caller must delete or move them first. Deliberately not cascaded:
          // scenes are first-class content entities with their own revisions
          // and Qdrant points, so silently destroying them would skip both.
          await repositories.entity.delete(chapter.id, chapter.version);
        },
      );
    } catch (error) {
      // Before mapChapterError: the blocked-delete error carries rows that
      // still need names, which is asynchronous work a `never`-returning
      // mapper cannot do. Returns untouched for every other error.
      await mapBlockedByRelationshipsError(error, {
        contentEntityLocator: this.contentEntityLocator,
        entityLabel: "Chapter",
      });
      mapChapterError(error);
    }
  }

  private async persistChange(
    chapter: Chapter,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<ChapterDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(chapter);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: chapter.projectId,
      entityType: "chapter",
      entityId: chapter.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: chapter.updatedAt,
    });

    const chapterToPersist = Chapter.reconstitute({
      ...chapter.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.chapterUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(chapterToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "chapter",
            aggregateId: chapter.id,
            projectId: chapter.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: chapter.projectId,
              entityType: "chapter",
              entityId: chapter.id,
              revisionId,
              revisionNumber: oldVersion + 1,
              changedByUserId: requestingUserId,
            },
            routingKey: "content.updated",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapChapterError(error);
    }

    return this.toChapterDetail(chapterToPersist);
  }

  private async loadExistingChapter(
    projectId: string,
    chapterId: string,
  ): Promise<Chapter> {
    const chapter = await this.chapterRepository.findById(chapterId);

    if (chapter?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Chapter not found");
    }

    return chapter;
  }

  private toChapterDetail(chapter: Chapter): ChapterDetail {
    return {
      id: chapter.id,
      projectId: chapter.projectId,
      createdByUserId: chapter.createdByUserId,
      title: chapter.title,
      order: chapter.order,
      summary: chapter.summary,
      content: chapter.content,
      status: chapter.status,
      publishedAt: chapter.publishedAt,
      currentRevisionId: chapter.currentRevisionId,
      createdAt: chapter.createdAt,
      updatedAt: chapter.updatedAt,
    };
  }
}

export function createChapterService({
  clock,
  idGenerator,
  chapterRepository,
  chapterUnitOfWork,
  contentEntityLocator,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  chapterRepository: ChapterRepository;
  chapterUnitOfWork: ContentUnitOfWork<ChapterRepository>;
  contentEntityLocator: ContentEntityLocator;
}): ChapterService {
  return new ChapterService(
    clock,
    idGenerator,
    chapterRepository,
    chapterUnitOfWork,
    contentEntityLocator,
  );
}
