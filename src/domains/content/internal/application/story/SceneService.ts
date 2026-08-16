import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Scene, type SceneStatus } from "../../domain/story/Scene.js";
import {
  SceneRepositoryChapterNotFoundError,
  SceneRepositoryConflictError,
  SceneRepositoryNotFoundError,
  SceneRepositoryOrderConflictError,
  SceneRepositoryReferencedError,
} from "../../domain/story/SceneRepositoryError.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import {
  assertNoBlockingRelationships,
  mapBlockedByRelationshipsError,
} from "../support/contentRelationshipDeleteGuard.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";
import type { SceneRepository } from "../../domain/story/SceneRepository.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateSceneInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  chapterId: string;
  orderInChapter: number;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
};

export type CreateSceneResult = {
  sceneId: string;
};

export type SceneDetail = {
  id: string;
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

export type ChangeSceneStatusInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  status: SceneStatus;
};

// No `chapterId` here, mirroring Scene.UpdateSceneDetailsProperties and
// SceneMapper.toUpdatePersistence: the domain exposes no re-parent operation,
// so moving a scene to another chapter is not something this input can offer.
export type UpdateSceneInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  orderInChapter?: number;
};

export type DeleteSceneInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

// Read-only view of ChapterRepository — the ONLY method this service is
// allowed to reach on someone else's aggregate. Scene's parent check needs a
// read; it never needs to write `chapters`, and taking the full repository
// would leave nothing stopping a later edit here from doing exactly that,
// bypassing ChapterService's authorization, its revision, and its outbox event
// — a chapter mutated with no audit trail. Narrowing makes that a visible
// change to this line rather than an invisible one inside a method body.
//
// Same instinct already applied one layer down (`SceneDatabase =
// Pick<PrismaClient, "scene">`, PrismaSceneRepository.ts:20) and the same
// argument Phase 5 used when it refused to expose Content repositories through
// the public index and introduced the read-only `ContentEntityReader` port.
export type ChapterOwnershipReader = Pick<ChapterRepository, "findById">;

export function toRevisionSnapshot(scene: Scene): Record<string, unknown> {
  const snapshot = scene.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    chapterId: snapshot.chapterId,
    title: snapshot.title,
    summary: snapshot.summary,
    content: snapshot.content,
    orderInChapter: snapshot.orderInChapter,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot modify scenes");
  }
}

function assertCanDelete(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot delete scenes");
  }

  if (membership.role === "editor" && !membership.canDelete) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Editor without delete permission cannot delete scenes",
    );
  }
}

function mapSceneError(error: unknown): never {
  if (error instanceof SceneRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Scene not found");
  }

  // Before the generic Conflict branch — deterministic (position taken) versus
  // transient (someone else wrote first). Same split as ChapterService.
  if (error instanceof SceneRepositoryOrderConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Another scene in this chapter already uses that order",
    );
  }

  if (error instanceof SceneRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Scene was modified concurrently");
  }

  if (error instanceof SceneRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Scene is still referenced and cannot be deleted",
    );
  }

  // Reached only via the TOCTOU race described at createScene's call site: the
  // pre-check there normally catches a missing/foreign chapter and already
  // throws this same NOT_FOUND. Same treatment as Layer's ParentNotFound.
  if (error instanceof SceneRepositoryChapterNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Chapter not found");
  }

  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class SceneService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly sceneRepository: SceneRepository,
    private readonly chapterRepository: ChapterOwnershipReader,
    private readonly sceneUnitOfWork: ContentUnitOfWork<SceneRepository>,
    // 7.4b: names the entities that block a delete. Only the delete path uses
    // it, and only after the guard has already refused the delete.
    private readonly contentEntityLocator: ContentEntityLocator,
  ) {}

  async createScene(input: CreateSceneInput): Promise<CreateSceneResult> {
    assertCanWrite(input.requestingMembership);

    // The parent pre-check, and the reason SceneService takes a
    // ChapterRepository at all. `scenes.chapter_id` is a plain FK, so the
    // database only ever proves the chapter EXISTS — never that it belongs to
    // this project. Without this read, a caller could hang a scene off another
    // tenant's chapter and the write would succeed. Scene.validate() cannot do
    // it either: `chapterId` is an opaque token there (Scene.ts:229-238),
    // because same-project ownership is a cross-aggregate fact only the
    // chapter's own row can answer. Same class of bug as the Layer/WorldMap
    // cross-project leak found in Phase 4.
    await this.loadExistingChapter(input.projectId, input.chapterId);

    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    // See EventService.createEvent for why construction is wrapped here while
    // Phase 4 leaves it bare.
    let scene: Scene;
    try {
      scene = Scene.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        createdByUserId: input.requestingUserId,
        chapterId: input.chapterId,
        orderInChapter: input.orderInChapter,
        title: input.title,
        summary: input.summary,
        content: input.content,
        currentRevisionId: revisionId,
        now,
      });
    } catch (error) {
      mapSceneError(error);
    }

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "scene",
      entityId: scene.id,
      revisionNumber: scene.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(scene),
      now,
    });

    // Wrapped for two distinct reasons: the composite unique index on
    // (chapter_id, order_in_chapter) can reject the insert, and the chapter
    // read above happens before this transaction opens — nothing holds that
    // row, so a concurrent chapter delete makes the FK fire at commit time.
    // Both map to the same statuses the pre-checks already produce.
    try {
      await this.sceneUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.entity.insert(scene);
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.linkRevision(
            scene.id,
            revisionId,
            scene.version,
          );
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.created",
            eventVersion: 1,
            aggregateType: "scene",
            aggregateId: scene.id,
            projectId: scene.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: scene.projectId,
              entityType: "scene",
              entityId: scene.id,
              revisionId,
              revisionNumber: scene.version,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.created",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapSceneError(error);
    }

    return { sceneId: scene.id };
  }

  async getSceneById(projectId: string, sceneId: string): Promise<SceneDetail> {
    const scene = await this.loadExistingScene(projectId, sceneId);

    return this.toSceneDetail(scene);
  }

  // Nested listing for `/chapters/:chapterId/scenes`. The chapter is loaded
  // first so a chapter that does not exist — or belongs to another project —
  // answers 404 rather than an empty list: an empty array would be
  // indistinguishable from "this chapter genuinely has no scenes yet", which
  // is a different fact. The repository query is tenant-scoped as well, so
  // this pre-check is defence in depth, not the only guard.
  async listScenesByChapter(
    projectId: string,
    chapterId: string,
  ): Promise<SceneDetail[]> {
    await this.loadExistingChapter(projectId, chapterId);

    const scenes = await this.sceneRepository.findByChapterId(
      projectId,
      chapterId,
    );

    return scenes.map((scene) => this.toSceneDetail(scene));
  }

  async changeSceneStatus(
    projectId: string,
    sceneId: string,
    input: ChangeSceneStatusInput,
  ): Promise<SceneDetail> {
    assertCanWrite(input.requestingMembership);

    const scene = await this.loadExistingScene(projectId, sceneId);
    const oldVersion = scene.version;
    const beforeSnapshot = toRevisionSnapshot(scene);

    let changed: boolean;
    try {
      changed = scene.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapSceneError(error);
    }

    if (!changed) {
      return this.toSceneDetail(scene);
    }

    return this.persistChange(
      scene,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateScene(
    projectId: string,
    sceneId: string,
    input: UpdateSceneInput,
  ): Promise<SceneDetail> {
    assertCanWrite(input.requestingMembership);

    const scene = await this.loadExistingScene(projectId, sceneId);
    const oldVersion = scene.version;
    const beforeSnapshot = toRevisionSnapshot(scene);

    let changed: boolean;
    try {
      changed = scene.updateDetails({
        title: input.title,
        summary: input.summary,
        content: input.content,
        orderInChapter: input.orderInChapter,
        now: this.clock.now(),
      });
    } catch (error) {
      mapSceneError(error);
    }

    if (!changed) {
      return this.toSceneDetail(scene);
    }

    return this.persistChange(
      scene,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteScene(
    projectId: string,
    sceneId: string,
    input: DeleteSceneInput,
  ): Promise<void> {
    assertCanDelete(input.requestingMembership);

    const scene = await this.loadExistingScene(projectId, sceneId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "scene",
      entityId: scene.id,
      revisionNumber: scene.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(scene),
      now,
    });

    try {
      await this.sceneUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          // Flow 3 §Delete step 5, M:N half (item 7.4b). First statement in the
          // transaction: it is a read, and everything below it is work a block
          // would throw away. The FK half stays where it always was — inside
          // repository.delete(), as SceneRepositoryReferencedError.
          await assertNoBlockingRelationships(
            repositories.contentRelationships,
            { projectId, entityType: "scene", entityId: scene.id },
          );
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "scene",
            aggregateId: scene.id,
            projectId: scene.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: scene.projectId,
              entityType: "scene",
              entityId: scene.id,
              revisionId,
              revisionNumber: scene.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(scene.id, scene.version);
        },
      );
    } catch (error) {
      // Before mapSceneError: the blocked-delete error carries rows that
      // still need names, which is asynchronous work a `never`-returning
      // mapper cannot do. Returns untouched for every other error.
      await mapBlockedByRelationshipsError(error, {
        contentEntityLocator: this.contentEntityLocator,
        entityLabel: "Scene",
      });
      mapSceneError(error);
    }
  }

  private async persistChange(
    scene: Scene,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<SceneDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(scene);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: scene.projectId,
      entityType: "scene",
      entityId: scene.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: scene.updatedAt,
    });

    const sceneToPersist = Scene.reconstitute({
      ...scene.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.sceneUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(sceneToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "scene",
            aggregateId: scene.id,
            projectId: scene.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: scene.projectId,
              entityType: "scene",
              entityId: scene.id,
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
      mapSceneError(error);
    }

    return this.toSceneDetail(sceneToPersist);
  }

  private async loadExistingScene(
    projectId: string,
    sceneId: string,
  ): Promise<Scene> {
    const scene = await this.sceneRepository.findById(sceneId);

    if (scene?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Scene not found");
    }

    return scene;
  }

  private async loadExistingChapter(
    projectId: string,
    chapterId: string,
  ): Promise<void> {
    const chapter = await this.chapterRepository.findById(chapterId);

    // One signal for "no such chapter" and "not yours", same collapse as every
    // other ownership check in this domain — never confirm that an id exists
    // but belongs to someone else.
    if (chapter?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Chapter not found");
    }
  }

  private toSceneDetail(scene: Scene): SceneDetail {
    return {
      id: scene.id,
      projectId: scene.projectId,
      createdByUserId: scene.createdByUserId,
      chapterId: scene.chapterId,
      title: scene.title,
      summary: scene.summary,
      content: scene.content,
      orderInChapter: scene.orderInChapter,
      status: scene.status,
      currentRevisionId: scene.currentRevisionId,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    };
  }
}

export function createSceneService({
  clock,
  idGenerator,
  sceneRepository,
  chapterRepository,
  sceneUnitOfWork,
  contentEntityLocator,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  sceneRepository: SceneRepository;
  // Awilix resolves the full `chapterRepository` from the cradle; it is
  // narrowed at this boundary, so the extra methods never enter this service.
  chapterRepository: ChapterOwnershipReader;
  sceneUnitOfWork: ContentUnitOfWork<SceneRepository>;
  contentEntityLocator: ContentEntityLocator;
}): SceneService {
  return new SceneService(
    clock,
    idGenerator,
    sceneRepository,
    chapterRepository,
    sceneUnitOfWork,
    contentEntityLocator,
  );
}
