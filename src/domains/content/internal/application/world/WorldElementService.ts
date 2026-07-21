import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import {
  WorldElement,
  type WorldElementStatus,
} from "../../domain/world/WorldElement.js";
import {
  WorldElementRepositoryConflictError,
  WorldElementRepositoryNotFoundError,
  WorldElementRepositoryReferencedError,
} from "../../domain/world/WorldElementRepositoryError.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { WorldElementRepository } from "../../domain/world/WorldElementRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateWorldElementInput = {
  requestingUserId: string;
  projectId: string;
  name: string;
  description?: string | null;
  category: string;
  content?: string | null;
};

export type CreateWorldElementResult = {
  worldElementId: string;
};

export type WorldElementDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  category: string;
  content: string | null;
  status: WorldElementStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Plain, JSON-serializable mirror of WorldElementProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(
  worldElement: WorldElement,
): Record<string, unknown> {
  const snapshot = worldElement.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    name: snapshot.name,
    description: snapshot.description,
    category: snapshot.category,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export type ChangeWorldElementStatusInput = {
  requestingUserId: string;
  status: WorldElementStatus;
};

export type UpdateWorldElementInput = {
  requestingUserId: string;
  name?: string;
  description?: string | null;
  category?: string;
  content?: string | null;
};

export type DeleteWorldElementInput = {
  requestingUserId: string;
};

function mapWorldElementError(error: unknown): never {
  if (error instanceof WorldElementRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "World element not found");
  }

  if (error instanceof WorldElementRepositoryConflictError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "World element was modified concurrently",
    );
  }

  if (error instanceof WorldElementRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "World element is still referenced and cannot be deleted",
    );
  }

  // Generic catch, not a specific DomainErrorCode branch like ProjectService's
  // mapProjectError — every DomainError from WorldElement.validate() (via
  // updateDetails()/changeStatus()) is a Flow 3 "400 Domain validation error"
  // by definition, regardless of which invariant it names. Without this,
  // errorHandler.ts only special-cases AppError, so a DomainError falls
  // through to a raw 500 — indistinguishable from a real bug to the caller.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class WorldElementService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly worldElementRepository: WorldElementRepository,
    private readonly worldElementUnitOfWork: ContentUnitOfWork<WorldElementRepository>,
  ) { }

  async createWorldElement(
    input: CreateWorldElementInput,
  ): Promise<CreateWorldElementResult> {
    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    const worldElement = WorldElement.create({
      id: this.idGenerator.generate(),
      projectId: input.projectId,
      createdByUserId: input.requestingUserId,
      name: input.name,
      description: input.description,
      category: input.category,
      content: input.content,
      // Pre-generated so the in-memory entity is domain-valid from the
      // start (policy 06 §4 currentRevisionId decision) — the physical row
      // is written without it first; see WorldElementMapper.toCreatePersistence
      // and WorldElementRepository.linkRevision for the DB-side half.
      currentRevisionId: revisionId,
      now,
    });

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "world_element",
      entityId: worldElement.id,
      revisionNumber: worldElement.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(worldElement),
      now,
    });

    // No error mapping here, deliberately — same as ProjectService.createProject().
    // Every failure path in this transaction (insert conflict, revision conflict,
    // linkRevision NotFound/Conflict) requires either a UUID collision or another
    // writer touching a row that cannot exist outside this transaction yet.
    // None of that is a normal, user-facing condition — it surfaces raw as a bug.
    await this.worldElementUnitOfWork.transaction(
      async (repositories, outboxEvents) => {
        await repositories.entity.insert(worldElement);
        await repositories.contentRevisions.insert(revision);
        await repositories.entity.linkRevision(
          worldElement.id,
          revisionId,
          worldElement.version,
        );
        await outboxEvents.insert({
          id: this.idGenerator.generate(),
          eventType: "content.created",
          eventVersion: 1,
          aggregateType: "world_element",
          aggregateId: worldElement.id,
          projectId: worldElement.projectId,
          triggeredByUserId: input.requestingUserId,
          payload: {
            projectId: worldElement.projectId,
            entityType: "world_element",
            entityId: worldElement.id,
            revisionId,
            revisionNumber: worldElement.version,
            changedByUserId: input.requestingUserId,
          },
          routingKey: "content.created",
          exchange: "saas.events",
        });
      },
    );

    return { worldElementId: worldElement.id };
  }

  async getWorldElementById(
    projectId: string,
    worldElementId: string,
  ): Promise<WorldElementDetail> {
    const worldElement = await this.loadExistingWorldElement(
      projectId,
      worldElementId,
    );

    return this.toWorldElementDetail(worldElement);
  }

  async listWorldElementsByProject(
    projectId: string,
  ): Promise<WorldElementDetail[]> {
    const worldElements =
      await this.worldElementRepository.findByProjectId(projectId);

    return worldElements.map((worldElement) =>
      this.toWorldElementDetail(worldElement),
    );
  }

  // Policy 06 §4 (Chapter lifecycle note, applied the same way here): status
  // transition uses the SAME version-check + revision + outbox machinery as
  // a regular field update, not a separate mechanism — it's still just an
  // "update" from content_revisions' point of view (changeType stays
  // "update", not a fourth changeType). Kept as its own Service method
  // rather than folded into updateWorldElement's input, mirroring
  // ProjectService.activateProject()/archiveProject() being separate from
  // updateProjectDetails() — a status transition is a distinct action with
  // its own invariant (WorldElement.validate(): published requires content),
  // not an optional field on a generic edit.
  async changeWorldElementStatus(
    projectId: string,
    worldElementId: string,
    input: ChangeWorldElementStatusInput,
  ): Promise<WorldElementDetail> {
    const worldElement = await this.loadExistingWorldElement(
      projectId,
      worldElementId,
    );
    const oldVersion = worldElement.version;
    const beforeSnapshot = toRevisionSnapshot(worldElement);

    let changed: boolean;
    try {
      changed = worldElement.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapWorldElementError(error);
    }

    if (!changed) {
      return this.toWorldElementDetail(worldElement);
    }

    return this.persistChange(
      worldElement,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateWorldElement(
    projectId: string,
    worldElementId: string,
    input: UpdateWorldElementInput,
  ): Promise<WorldElementDetail> {
    const worldElement = await this.loadExistingWorldElement(
      projectId,
      worldElementId,
    );
    const oldVersion = worldElement.version;
    const beforeSnapshot = toRevisionSnapshot(worldElement);

    let changed: boolean;
    try {
      changed = worldElement.updateDetails({
        name: input.name,
        description: input.description,
        category: input.category,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapWorldElementError(error);
    }

    // No-op — policy 06 §3: no real change means no revision, no outbox, no
    // write at all. Same rule that already governs changeStatus/updateDetails
    // on the domain entity itself.
    if (!changed) {
      return this.toWorldElementDetail(worldElement);
    }

    return this.persistChange(
      worldElement,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteWorldElement(
    projectId: string,
    worldElementId: string,
    input: DeleteWorldElementInput,
  ): Promise<void> {
    const worldElement = await this.loadExistingWorldElement(
      projectId,
      worldElementId,
    );
    const now = this.clock.now();

    // Constraint validation (Flow 3 Delete step 5 — active M:N relationship
    // check via ContentRelationship) is NOT done here: ContentRelationship
    // has no domain/repository yet in this codebase (checked — only a
    // frozen table design exists). The only guard currently enforced is the
    // DB-level FK check already inside repository.delete() (comments still
    // targeting this world element -> WorldElementRepositoryReferencedError).
    // Revisit once ContentRelationship exists.
    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "world_element",
      entityId: worldElement.id,
      // See updateWorldElement's comment on revisionNumber — same reasoning:
      // this is the next revision slot after the entity's current version,
      // not the (unchanged) version value at the moment of this insert.
      revisionNumber: worldElement.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(worldElement),
      now,
    });

    try {
      await this.worldElementUnitOfWork.transaction(
        async (repositories, outboxEvents) => {
          // Persist revision and outbox event before the hard delete.
          // The snapshot was already captured before entering this transaction;
          // all writes are committed atomically together.
          await repositories.contentRevisions.insert(revision);
          await outboxEvents.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "world_element",
            aggregateId: worldElement.id,
            projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId,
              entityType: "world_element",
              entityId: worldElement.id,
              revisionId,
              revisionNumber: worldElement.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(
            worldElement.id,
            worldElement.version,
          );
        },
      );
    } catch (error) {
      mapWorldElementError(error);
    }
  }

  // Shared by updateWorldElement and changeWorldElementStatus: both already
  // mutated `worldElement` in-memory (via updateDetails()/changeStatus()) and
  // confirmed it was a real change before calling this. From here the
  // persistence mechanics are identical regardless of which domain mutator
  // produced the change — insert the new revision first (content_revisions.entity_id
  // has no FK, see updateWorldElement's original comment), then one update()
  // call carries the field/status change, the new currentRevisionId, and the
  // version bump together, then the outbox event.
  private async persistChange(
    worldElement: WorldElement,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<WorldElementDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(worldElement);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: worldElement.projectId,
      entityType: "world_element",
      entityId: worldElement.id,
      // The version this entity will have once this whole operation
      // completes (oldVersion + 1) — not a snapshot of the column at the
      // exact insert statement below, since that statement runs BEFORE the
      // entity write. Using the pre-write value here would collide with the
      // previous revision's own revisionNumber on the very next write for
      // this entity (unique constraint on projectId+entityType+entityId+revisionNumber).
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: worldElement.updatedAt,
    });

    const worldElementToPersist = WorldElement.reconstitute({
      ...worldElement.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.worldElementUnitOfWork.transaction(
        async (repositories, outboxEvents) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(worldElementToPersist);
          await outboxEvents.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "world_element",
            aggregateId: worldElement.id,
            projectId: worldElement.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: worldElement.projectId,
              entityType: "world_element",
              entityId: worldElement.id,
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
      mapWorldElementError(error);
    }

    return this.toWorldElementDetail(worldElementToPersist);
  }

  private async loadExistingWorldElement(
    projectId: string,
    worldElementId: string,
  ): Promise<WorldElement> {
    const worldElement =
      await this.worldElementRepository.findById(worldElementId);

    // Same NOT_FOUND for "doesn't exist" and "exists but belongs to another
    // project" — distinguishing the two would leak to an unauthorized caller
    // that the id is valid, just not theirs. No membership check happens
    // here (that's ProjectMemberMiddleware's job, at the route layer) — this
    // is the entity-level half: given a project the caller is already
    // authorized for, does THIS specific row actually belong to it.
    if (worldElement?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "World element not found");
    }

    return worldElement;
  }

  private toWorldElementDetail(worldElement: WorldElement): WorldElementDetail {
    return {
      id: worldElement.id,
      projectId: worldElement.projectId,
      createdByUserId: worldElement.createdByUserId,
      name: worldElement.name,
      description: worldElement.description,
      category: worldElement.category,
      content: worldElement.content,
      status: worldElement.status,
      currentRevisionId: worldElement.currentRevisionId,
      createdAt: worldElement.createdAt,
      updatedAt: worldElement.updatedAt,
    };
  }
}

export function createWorldElementService({
  clock,
  idGenerator,
  worldElementRepository,
  worldElementUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  worldElementRepository: WorldElementRepository;
  worldElementUnitOfWork: ContentUnitOfWork<WorldElementRepository>;
}): WorldElementService {
  return new WorldElementService(
    clock,
    idGenerator,
    worldElementRepository,
    worldElementUnitOfWork,
  );
}
