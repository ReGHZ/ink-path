import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import { WorldMap, type WorldMapStatus } from "../../domain/world/WorldMap.js";
import {
  WorldMapRepositoryConflictError,
  WorldMapRepositoryNotFoundError,
  WorldMapRepositoryParentNotFoundError,
  WorldMapRepositoryReferencedError,
} from "../../domain/world/WorldMapRepositoryError.js";
import {
  assertNoBlockingRelationships,
  mapBlockedByRelationshipsError,
} from "../support/contentRelationshipDeleteGuard.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateWorldMapInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  parentId?: string | null;
  name: string;
  scale?: string | null;
  terrain?: string | null;
  environment?: string | null;
  description?: string | null;
  content?: string | null;
};

export type CreateWorldMapResult = {
  worldMapId: string;
};

export type WorldMapDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  parentId: string | null;
  name: string;
  scale: string | null;
  terrain: string | null;
  environment: string | null;
  description: string | null;
  content: string | null;
  status: WorldMapStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Plain, JSON-serializable mirror of WorldMapProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(worldMap: WorldMap): Record<string, unknown> {
  const snapshot = worldMap.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    parentId: snapshot.parentId,
    name: snapshot.name,
    scale: snapshot.scale,
    terrain: snapshot.terrain,
    environment: snapshot.environment,
    description: snapshot.description,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export type ChangeWorldMapStatusInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  status: WorldMapStatus;
};

export type UpdateWorldMapInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  name?: string;
  scale?: string | null;
  terrain?: string | null;
  environment?: string | null;
  description?: string | null;
  content?: string | null;
};

export type DeleteWorldMapInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

// Flow 3 Preconditions table (02-system-design/03_flow_03_content_crud.md:14-18):
// Writer = full CRUD, Editor = full CRUD except delete is conditional, Reviewer =
// read-only. Mirrors WorldElementService's assertCanWrite/assertCanDelete exactly.
function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot modify world maps",
    );
  }
}

function assertCanDelete(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Reviewer role cannot delete world maps",
    );
  }

  if (membership.role === "editor" && !membership.canDelete) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Editor without delete permission cannot delete world maps",
    );
  }
}

function mapWorldMapError(error: unknown): never {
  if (error instanceof WorldMapRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "World map not found");
  }

  if (error instanceof WorldMapRepositoryConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "World map was modified concurrently",
    );
  }

  if (error instanceof WorldMapRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "World map is still referenced and cannot be deleted",
    );
  }

  // Matches the frozen error table exactly: "404 Parent not found"
  // (02-system-design/03_flow_03_content_crud.md:49), not a 400 — reached
  // only via a TOCTOU race (parent deleted between createWorldMap's
  // synchronous pre-check and this transaction's commit); the pre-check
  // is what normally catches this and already throws this same NOT_FOUND.
  if (error instanceof WorldMapRepositoryParentNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Parent world map not found");
  }

  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class WorldMapService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly worldMapRepository: WorldMapRepository,
    private readonly worldMapUnitOfWork: ContentUnitOfWork<WorldMapRepository>,
    // 7.4b: names the entities that block a delete. Only the delete path uses
    // it, and only after the guard has already refused the delete.
    private readonly contentEntityLocator: ContentEntityLocator,
  ) {}

  async createWorldMap(
    input: CreateWorldMapInput,
  ): Promise<CreateWorldMapResult> {
    // Flow 3 step ordering: Authorization is step 4, Parent validation is
    // step 5 — role is checked BEFORE the parent pre-check below.
    assertCanWrite(input.requestingMembership);

    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    if (input.parentId != null) {
      const parent = await this.worldMapRepository.findById(input.parentId);

      if (parent?.projectId !== input.projectId) {
        throw new AppError(ErrorCode.NOT_FOUND, "Parent world map not found");
      }
    }

    // See LayerService.createLayer for why construction is wrapped (aligned
    // 2026-08-12 with the Phase 6 services).
    let worldMap: WorldMap;
    try {
      worldMap = WorldMap.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        createdByUserId: input.requestingUserId,
        parentId: input.parentId,
        name: input.name,
        scale: input.scale,
        terrain: input.terrain,
        environment: input.environment,
        description: input.description,
        content: input.content,
        currentRevisionId: revisionId,
        now,
      });
    } catch (error) {
      mapWorldMapError(error);
    }

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "map",
      entityId: worldMap.id,
      revisionNumber: worldMap.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(worldMap),
      now,
    });

    try {
      await this.worldMapUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.entity.insert(worldMap);
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.linkRevision(
            worldMap.id,
            revisionId,
            worldMap.version,
          );
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.created",
            eventVersion: 1,
            aggregateType: "map",
            aggregateId: worldMap.id,
            projectId: worldMap.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: worldMap.projectId,
              entityType: "map",
              entityId: worldMap.id,
              revisionId,
              revisionNumber: worldMap.version,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.created",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapWorldMapError(error);
    }

    return { worldMapId: worldMap.id };
  }

  async getWorldMapById(
    projectId: string,
    worldMapId: string,
  ): Promise<WorldMapDetail> {
    const worldMap = await this.loadExistingWorldMap(projectId, worldMapId);

    return this.toWorldMapDetail(worldMap);
  }

  async listWorldMapsByProject(projectId: string): Promise<WorldMapDetail[]> {
    const worldMaps = await this.worldMapRepository.findByProjectId(projectId);

    return worldMaps.map((worldMap) => this.toWorldMapDetail(worldMap));
  }

  async changeWorldMapStatus(
    projectId: string,
    worldMapId: string,
    input: ChangeWorldMapStatusInput,
  ): Promise<WorldMapDetail> {
    assertCanWrite(input.requestingMembership);

    const worldMap = await this.loadExistingWorldMap(projectId, worldMapId);
    const oldVersion = worldMap.version;
    const beforeSnapshot = toRevisionSnapshot(worldMap);

    let changed: boolean;
    try {
      changed = worldMap.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapWorldMapError(error);
    }

    if (!changed) {
      return this.toWorldMapDetail(worldMap);
    }

    return this.persistChange(
      worldMap,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateWorldMap(
    projectId: string,
    worldMapId: string,
    input: UpdateWorldMapInput,
  ): Promise<WorldMapDetail> {
    assertCanWrite(input.requestingMembership);

    const worldMap = await this.loadExistingWorldMap(projectId, worldMapId);
    const oldVersion = worldMap.version;
    const beforeSnapshot = toRevisionSnapshot(worldMap);

    let changed: boolean;
    try {
      changed = worldMap.updateDetails({
        name: input.name,
        scale: input.scale,
        terrain: input.terrain,
        environment: input.environment,
        description: input.description,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapWorldMapError(error);
    }

    if (!changed) {
      return this.toWorldMapDetail(worldMap);
    }

    return this.persistChange(
      worldMap,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteWorldMap(
    projectId: string,
    worldMapId: string,
    input: DeleteWorldMapInput,
  ): Promise<void> {
    assertCanDelete(input.requestingMembership);

    const worldMap = await this.loadExistingWorldMap(projectId, worldMapId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "map",
      entityId: worldMap.id,
      revisionNumber: worldMap.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(worldMap),
      now,
    });

    try {
      await this.worldMapUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          // Flow 3 §Delete step 5, M:N half (item 7.4b). First statement in the
          // transaction: it is a read, and everything below it is work a block
          // would throw away. The FK half stays where it always was — inside
          // repository.delete(), as WorldMapRepositoryReferencedError.
          await assertNoBlockingRelationships(
            repositories.contentRelationships,
            { projectId, entityType: "map", entityId: worldMap.id },
          );
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "map",
            aggregateId: worldMap.id,
            projectId: worldMap.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: worldMap.projectId,
              entityType: "map",
              entityId: worldMap.id,
              revisionId,
              revisionNumber: worldMap.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(worldMap.id, worldMap.version);
        },
      );
    } catch (error) {
      // Before mapWorldMapError: the blocked-delete error carries rows that
      // still need names, which is asynchronous work a `never`-returning
      // mapper cannot do. Returns untouched for every other error.
      await mapBlockedByRelationshipsError(error, {
        contentEntityLocator: this.contentEntityLocator,
        entityLabel: "World map",
      });
      mapWorldMapError(error);
    }
  }

  private async persistChange(
    worldMap: WorldMap,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<WorldMapDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(worldMap);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: worldMap.projectId,
      entityType: "map",
      entityId: worldMap.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: worldMap.updatedAt,
    });

    const worldMapToPersist = WorldMap.reconstitute({
      ...worldMap.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.worldMapUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(worldMapToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "map",
            aggregateId: worldMap.id,
            projectId: worldMap.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: worldMap.projectId,
              entityType: "map",
              entityId: worldMap.id,
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
      mapWorldMapError(error);
    }

    return this.toWorldMapDetail(worldMapToPersist);
  }

  private async loadExistingWorldMap(
    projectId: string,
    worldMapId: string,
  ): Promise<WorldMap> {
    const worldMap = await this.worldMapRepository.findById(worldMapId);

    if (worldMap?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "World map not found");
    }

    return worldMap;
  }

  private toWorldMapDetail(worldMap: WorldMap): WorldMapDetail {
    return {
      id: worldMap.id,
      projectId: worldMap.projectId,
      createdByUserId: worldMap.createdByUserId,
      parentId: worldMap.parentId,
      name: worldMap.name,
      scale: worldMap.scale,
      terrain: worldMap.terrain,
      environment: worldMap.environment,
      description: worldMap.description,
      content: worldMap.content,
      status: worldMap.status,
      currentRevisionId: worldMap.currentRevisionId,
      createdAt: worldMap.createdAt,
      updatedAt: worldMap.updatedAt,
    };
  }
}

export function createWorldMapService({
  clock,
  idGenerator,
  worldMapRepository,
  worldMapUnitOfWork,
  contentEntityLocator,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  worldMapRepository: WorldMapRepository;
  worldMapUnitOfWork: ContentUnitOfWork<WorldMapRepository>;
  contentEntityLocator: ContentEntityLocator;
}): WorldMapService {
  return new WorldMapService(
    clock,
    idGenerator,
    worldMapRepository,
    worldMapUnitOfWork,
    contentEntityLocator,
  );
}
