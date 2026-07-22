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

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateWorldMapInput = {
  requestingUserId: string;
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
  status: WorldMapStatus;
};

export type UpdateWorldMapInput = {
  requestingUserId: string;
  name?: string;
  scale?: string | null;
  terrain?: string | null;
  environment?: string | null;
  description?: string | null;
  content?: string | null;
};

export type DeleteWorldMapInput = {
  requestingUserId: string;
};

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
  ) {}

  async createWorldMap(
    input: CreateWorldMapInput,
  ): Promise<CreateWorldMapResult> {
    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    if (input.parentId != null) {
      const parent = await this.worldMapRepository.findById(input.parentId);

      if (parent?.projectId !== input.projectId) {
        throw new AppError(ErrorCode.NOT_FOUND, "Parent world map not found");
      }
    }

    const worldMap = WorldMap.create({
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

  async listWorldMapByProject(projectId: string): Promise<WorldMapDetail[]> {
    const worldMaps = await this.worldMapRepository.findByProjectId(projectId);

    return worldMaps.map((worldMap) => this.toWorldMapDetail(worldMap));
  }

  async changeWorldMapStatus(
    projectId: string,
    worldMapId: string,
    input: ChangeWorldMapStatusInput,
  ): Promise<WorldMapDetail> {
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
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  worldMapRepository: WorldMapRepository;
  worldMapUnitOfWork: ContentUnitOfWork<WorldMapRepository>;
}): WorldMapService {
  return new WorldMapService(
    clock,
    idGenerator,
    worldMapRepository,
    worldMapUnitOfWork,
  );
}
