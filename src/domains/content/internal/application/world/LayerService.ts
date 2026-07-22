import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import { Layer, type LayerExposure, type LayerStatus } from "../../domain/world/Layer.js";
import {
  LayerRepositoryConflictError,
  LayerRepositoryNotFoundError,
  LayerRepositoryParentNotFoundError,
  LayerRepositoryReferencedError,
} from "../../domain/world/LayerRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { LayerRepository } from "../../domain/world/LayerRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateLayerInput = {
  requestingUserId: string;
  projectId: string;
  parentId?: string | null;
  name: string;
  level: number;
  exposure: LayerExposure;
  description?: string | null;
  content?: string | null;
};

export type CreateLayerResult = {
  layerId: string;
};

export type LayerDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  parentId: string | null;
  name: string;
  level: number;
  exposure: LayerExposure;
  description: string | null;
  content: string | null;
  status: LayerStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Plain, JSON-serializable mirror of LayerProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(layer: Layer): Record<string, unknown> {
  const snapshot = layer.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    parentId: snapshot.parentId,
    name: snapshot.name,
    level: snapshot.level,
    exposure: snapshot.exposure,
    description: snapshot.description,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export type ChangeLayerStatusInput = {
  requestingUserId: string;
  status: LayerStatus;
};

// No `parentId` here, deliberately mirroring Layer.UpdateLayerDetailProperties
// — the domain entity itself does not expose a way to re-parent after
// creation (see Layer.ts updateDetails()), so the Service input can't offer
// it either. Re-parenting would need its own method with its own invariant
// (cycle check across the whole hierarchy, not just direct self-parent),
// which does not exist yet.
export type UpdateLayerInput = {
  requestingUserId: string;
  name?: string;
  level?: number;
  exposure?: LayerExposure;
  description?: string | null;
  content?: string | null;
};

export type DeleteLayerInput = {
  requestingUserId: string;
};

function mapLayerError(error: unknown): never {
  if (error instanceof LayerRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Layer not found");
  }

  if (error instanceof LayerRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Layer was modified concurrently");
  }

  if (error instanceof LayerRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Layer is still referenced and cannot be deleted",
    );
  }

  // Matches the frozen error table exactly: "404 Parent not found"
  // (02-system-design/03_flow_03_content_crud.md:49), not a 400 — reached
  // only via the TOCTOU race described at createLayer's call site (the
  // synchronous pre-check there is what normally catches this and already
  // throws this same NOT_FOUND).
  if (error instanceof LayerRepositoryParentNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Parent layer not found");
  }

  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class LayerService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly layerRepository: LayerRepository,
    private readonly layerUnitOfWork: ContentUnitOfWork<LayerRepository>,
  ) {}

  async createLayer(input: CreateLayerInput): Promise<CreateLayerResult> {
    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    // Flow 3 Create step 5 (02-system-design/03_flow_03_content_crud.md:36) is its
    // OWN step, separate from step 6's self-contained domain validation — parent
    // existence, same-project membership, and level ordering vs the parent are all
    // cross-aggregate facts that only the parent's own row can answer, so
    // Layer.create()'s validate() (which only ever sees parentId as an opaque
    // string) structurally cannot check them. Done here, before constructing the
    // child entity, via the plain repository read already used for get/list — no
    // transaction needed for a read.
    if (input.parentId != null) {
      const parent = await this.layerRepository.findById(input.parentId);

      // Same NOT_FOUND for "doesn't exist" and "exists but belongs to another
      // project" as loadExistingLayer's own ownership check below — collapsing
      // the two avoids telling an unauthorized caller that a given id is valid,
      // just not theirs. Matches the frozen error table's own single row for
      // this case: "404 Parent not found: parent_id diberikan tapi parent tidak
      // ada / beda project" (03_flow_03_content_crud.md:49) — one signal, not two.
      if (parent?.projectId !== input.projectId) {
        throw new AppError(ErrorCode.NOT_FOUND, "Parent layer not found");
      }

      // 03-database-design/06_content_tables.md:369 — "Application layer menjaga
      // jika layer punya parent, maka child level harus lebih besar dari parent
      // level." Strictly greater, not just non-negative — Layer.validate()'s own
      // `level > 0` is an absolute check with no knowledge of any parent.
      //
      // Accepted risk, not fixed here (06_concurrency_control_policy.md's own
      // governance rule: a known race must be written down as a conscious
      // decision, not left as a silent gap) — this read happens before the
      // transaction opens, and `level` is a mutable field (updateLayer can
      // change a parent's level at any time). A concurrent updateLayer() on
      // this same parent between this check and the transaction's commit can
      // still land a child whose level is no longer greater than its parent's
      // — unlike the existence/ownership check above, there is no DB-level
      // backstop for this (schema only enforces `level > 0` absolute, per
      // 06_content_tables.md:368; the relative ordering is Application-layer
      // only, and parentId's FK has no composite on level). Judged acceptable:
      // this is a display/ordering invariant, not a security or data-loss
      // issue, and the window requires a specific parent to be re-leveled at
      // the exact moment a new child is being created under it — rare enough
      // that a pessimistic lock (SELECT ... FOR UPDATE on the parent for
      // every single create) would be disproportionate per the policy's own
      // decision matrix (§2: pessimistic lock reserved for apply-once/critical
      // operations, not routine, high-frequency writes like this one).
      if (input.level <= parent.level) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Layer level must be greater than its parent's level",
        );
      }
    }

    const layer = Layer.create({
      id: this.idGenerator.generate(),
      projectId: input.projectId,
      createdByUserId: input.requestingUserId,
      parentId: input.parentId,
      name: input.name,
      level: input.level,
      exposure: input.exposure,
      description: input.description,
      content: input.content,
      // Pre-generated so the in-memory entity is domain-valid from the
      // start (policy 06 §4 currentRevisionId decision) — the physical row
      // is written without it first; see LayerMapper.toCreatePersistence
      // and LayerRepository.linkRevision for the DB-side half.
      currentRevisionId: revisionId,
      now,
    });

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "layer",
      entityId: layer.id,
      revisionNumber: layer.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(layer),
      now,
    });

    // Unlike createFaction/createWorldElement/createCharacter, THIS create flow
    // DOES need error mapping around the transaction. The parent check above
    // already covers the normal case, but it reads the parent BEFORE this
    // transaction opens — nothing locks that row across the gap, so the parent
    // can legitimately be deleted by a concurrent request in between (it has no
    // children yet from this layer's point of view, so LayerRepositoryReferencedError
    // wouldn't block that delete). `repositories.entity.insert()` re-checks the
    // same FK at commit time and throws LayerRepositoryParentNotFoundError if it
    // lost that race — mapLayerError below maps it to the same NOT_FOUND as the
    // pre-check, so this is a backstop, not a second code path a caller needs to
    // reason about differently.
    try {
      await this.layerUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.entity.insert(layer);
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.linkRevision(
            layer.id,
            revisionId,
            layer.version,
          );
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.created",
            eventVersion: 1,
            aggregateType: "layer",
            aggregateId: layer.id,
            projectId: layer.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: layer.projectId,
              entityType: "layer",
              entityId: layer.id,
              revisionId,
              revisionNumber: layer.version,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.created",
            exchange: "saas.events",
          });
        },
      );
    } catch (error) {
      mapLayerError(error);
    }

    return { layerId: layer.id };
  }

  async getLayerById(projectId: string, layerId: string): Promise<LayerDetail> {
    const layer = await this.loadExistingLayer(projectId, layerId);

    return this.toLayerDetail(layer);
  }

  async listLayersByProject(projectId: string): Promise<LayerDetail[]> {
    const layers = await this.layerRepository.findByProjectId(projectId);

    return layers.map((layer) => this.toLayerDetail(layer));
  }

  async changeLayerStatus(
    projectId: string,
    layerId: string,
    input: ChangeLayerStatusInput,
  ): Promise<LayerDetail> {
    const layer = await this.loadExistingLayer(projectId, layerId);
    const oldVersion = layer.version;
    const beforeSnapshot = toRevisionSnapshot(layer);

    let changed: boolean;
    try {
      changed = layer.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapLayerError(error);
    }

    if (!changed) {
      return this.toLayerDetail(layer);
    }

    return this.persistChange(layer, oldVersion, beforeSnapshot, input.requestingUserId);
  }

  async updateLayer(
    projectId: string,
    layerId: string,
    input: UpdateLayerInput,
  ): Promise<LayerDetail> {
    const layer = await this.loadExistingLayer(projectId, layerId);
    const oldVersion = layer.version;
    const beforeSnapshot = toRevisionSnapshot(layer);

    let changed: boolean;
    try {
      changed = layer.updateDetails({
        name: input.name,
        level: input.level,
        exposure: input.exposure,
        description: input.description,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapLayerError(error);
    }

    if (!changed) {
      return this.toLayerDetail(layer);
    }

    return this.persistChange(layer, oldVersion, beforeSnapshot, input.requestingUserId);
  }

  async deleteLayer(
    projectId: string,
    layerId: string,
    input: DeleteLayerInput,
  ): Promise<void> {
    const layer = await this.loadExistingLayer(projectId, layerId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "layer",
      entityId: layer.id,
      revisionNumber: layer.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(layer),
      now,
    });

    try {
      await this.layerUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "layer",
            aggregateId: layer.id,
            projectId: layer.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: layer.projectId,
              entityType: "layer",
              entityId: layer.id,
              revisionId,
              revisionNumber: layer.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(layer.id, layer.version);
        },
      );
    } catch (error) {
      mapLayerError(error);
    }
  }

  private async persistChange(
    layer: Layer,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<LayerDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(layer);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: layer.projectId,
      entityType: "layer",
      entityId: layer.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: layer.updatedAt,
    });

    const layerToPersist = Layer.reconstitute({
      ...layer.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.layerUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(layerToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "layer",
            aggregateId: layer.id,
            projectId: layer.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: layer.projectId,
              entityType: "layer",
              entityId: layer.id,
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
      mapLayerError(error);
    }

    return this.toLayerDetail(layerToPersist);
  }

  private async loadExistingLayer(
    projectId: string,
    layerId: string,
  ): Promise<Layer> {
    const layer = await this.layerRepository.findById(layerId);

    if (layer?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Layer not found");
    }

    return layer;
  }

  private toLayerDetail(layer: Layer): LayerDetail {
    return {
      id: layer.id,
      projectId: layer.projectId,
      createdByUserId: layer.createdByUserId,
      parentId: layer.parentId,
      name: layer.name,
      level: layer.level,
      exposure: layer.exposure,
      description: layer.description,
      content: layer.content,
      status: layer.status,
      currentRevisionId: layer.currentRevisionId,
      createdAt: layer.createdAt,
      updatedAt: layer.updatedAt,
    };
  }
}

export function createLayerService({
  clock,
  idGenerator,
  layerRepository,
  layerUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  layerRepository: LayerRepository;
  layerUnitOfWork: ContentUnitOfWork<LayerRepository>;
}): LayerService {
  return new LayerService(clock, idGenerator, layerRepository, layerUnitOfWork);
}
