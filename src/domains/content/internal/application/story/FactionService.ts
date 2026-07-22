import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Faction, type FactionStatus } from "../../domain/story/Faction.js";
import {
  FactionRepositoryConflictError,
  FactionRepositoryNotFoundError,
  FactionRepositoryReferencedError,
} from "../../domain/story/FactionRepositoryError.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { FactionRepository } from "../../domain/story/FactionRepository.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreateFactionInput = {
  requestingUserId: string;
  projectId: string;
  name: string;
  description?: string | null;
  background?: string | null;
  ideology?: string | null;
  size?: string | null;
  content?: string | null;
};

export type CreateFactionResult = {
  factionId: string;
};

export type FactionDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  background: string | null;
  ideology: string | null;
  size: string | null;
  content: string | null;
  status: FactionStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

// Plain, JSON-serializable mirror of FactionProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(faction: Faction): Record<string, unknown> {
  const snapshot = faction.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    name: snapshot.name,
    description: snapshot.description,
    background: snapshot.background,
    ideology: snapshot.ideology,
    size: snapshot.size,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export type ChangeFactionStatusInput = {
  requestingUserId: string;
  status: FactionStatus;
};

export type UpdateFactionInput = {
  requestingUserId: string;
  name?: string;
  description?: string | null;
  background?: string | null;
  ideology?: string | null;
  size?: string | null;
  content?: string | null;
};

export type DeleteFactionInput = {
  requestingUserId: string;
};

function mapFactionError(error: unknown): never {
  if (error instanceof FactionRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Faction not found");
  }

  if (error instanceof FactionRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Faction was modified concurrently");
  }

  if (error instanceof FactionRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Faction is still referenced and cannot be deleted",
    );
  }

  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class FactionService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly factionRepository: FactionRepository,
    private readonly factionUnitOfWork: ContentUnitOfWork<FactionRepository>,
  ) {}

  async createFaction(input: CreateFactionInput): Promise<CreateFactionResult> {
    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    const faction = Faction.create({
      id: this.idGenerator.generate(),
      projectId: input.projectId,
      createdByUserId: input.requestingUserId,
      name: input.name,
      description: input.description,
      background: input.background,
      ideology: input.ideology,
      size: input.size,
      content: input.content,
      // Pre-generated so the in-memory entity is domain-valid from the
      // start (policy 06 §4 currentRevisionId decision) — the physical row
      // is written without it first; see FactionMapper.toCreatePersistence
      // and FactionRepository.linkRevision for the DB-side half.
      currentRevisionId: revisionId,
      now,
    });

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "faction",
      entityId: faction.id,
      revisionNumber: faction.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(faction),
      now,
    });

    // No error mapping here, deliberately — same as ProjectService.createProject()
    // and WorldElementService.createWorldElement(). Every failure path in this
    // transaction (insert conflict, revision conflict, linkRevision NotFound/
    // Conflict) requires either a UUID collision or another writer touching a
    // row that cannot exist outside this transaction yet — not a normal,
    // user-facing condition, so it surfaces raw as a bug.
    await this.factionUnitOfWork.transaction(
      async (repositories, outboxEvent) => {
        await repositories.entity.insert(faction);
        await repositories.contentRevisions.insert(revision);
        await repositories.entity.linkRevision(
          faction.id,
          revisionId,
          faction.version,
        );
        await outboxEvent.insert({
          id: this.idGenerator.generate(),
          eventType: "content.created",
          eventVersion: 1,
          aggregateType: "faction",
          aggregateId: faction.id,
          projectId: faction.projectId,
          triggeredByUserId: input.requestingUserId,
          payload: {
            projectId: faction.projectId,
            entityType: "faction",
            entityId: faction.id,
            revisionId,
            revisionNumber: faction.version,
            changedByUserId: input.requestingUserId,
          },
          routingKey: "content.created",
          exchange: "saas.events",
        });
      },
    );

    return { factionId: faction.id };
  }

  async getFactionById(
    projectId: string,
    factionId: string,
  ): Promise<FactionDetail> {
    const faction = await this.loadExistingFaction(projectId, factionId);

    return this.toFactionDetail(faction);
  }

  async listFactionByProject(projectId: string): Promise<FactionDetail[]> {
    const factions = await this.factionRepository.findByProjectId(projectId);

    return factions.map((faction) => this.toFactionDetail(faction));
  }

  async changeFactionStatus(
    projectId: string,
    factionId: string,
    input: ChangeFactionStatusInput,
  ): Promise<FactionDetail> {
    const faction = await this.loadExistingFaction(projectId, factionId);
    const oldVersion = faction.version;
    const beforeSnapshot = toRevisionSnapshot(faction);

    let changed: boolean;
    try {
      changed = faction.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapFactionError(error);
    }

    if (!changed) {
      return this.toFactionDetail(faction);
    }

    return this.persistChange(
      faction,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updateFaction(
    projectId: string,
    factionId: string,
    input: UpdateFactionInput,
  ): Promise<FactionDetail> {
    const faction = await this.loadExistingFaction(projectId, factionId);
    const oldVersion = faction.version;
    const beforeSnapshot = toRevisionSnapshot(faction);

    let changed: boolean;
    try {
      changed = faction.updateDetails({
        name: input.name,
        description: input.description,
        background: input.background,
        ideology: input.ideology,
        size: input.size,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapFactionError(error);
    }

    if (!changed) {
      return this.toFactionDetail(faction);
    }

    return this.persistChange(
      faction,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deleteFaction(
    projectId: string,
    factionId: string,
    input: DeleteFactionInput,
  ): Promise<void> {
    const faction = await this.loadExistingFaction(projectId, factionId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "faction",
      entityId: faction.id,
      revisionNumber: faction.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(faction),
      now,
    });

    try {
      await this.factionUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "faction",
            aggregateId: faction.id,
            projectId: faction.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: faction.projectId,
              entityType: "faction",
              entityId: faction.id,
              revisionId,
              revisionNumber: faction.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(faction.id, faction.version);
        },
      );
    } catch (error) {
      mapFactionError(error);
    }
  }

  private async persistChange(
    faction: Faction,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<FactionDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(faction);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: faction.projectId,
      entityType: "faction",
      entityId: faction.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: faction.updatedAt,
    });

    const factionToPersist = Faction.reconstitute({
      ...faction.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.factionUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(factionToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "faction",
            aggregateId: faction.id,
            projectId: faction.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: faction.projectId,
              entityType: "faction",
              entityId: faction.id,
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
      mapFactionError(error);
    }

    return this.toFactionDetail(factionToPersist);
  }

  private async loadExistingFaction(
    projectId: string,
    factionId: string,
  ): Promise<Faction> {
    const faction = await this.factionRepository.findById(factionId);

    if (faction?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Faction not found");
    }

    return faction;
  }

  private toFactionDetail(faction: Faction): FactionDetail {
    return {
      id: faction.id,
      projectId: faction.projectId,
      createdByUserId: faction.createdByUserId,
      name: faction.name,
      description: faction.description,
      background: faction.background,
      ideology: faction.ideology,
      size: faction.size,
      content: faction.content,
      status: faction.status,
      currentRevisionId: faction.currentRevisionId,
      createdAt: faction.createdAt,
      updatedAt: faction.updatedAt,
    };
  }
}

export function createFactionService({
  clock,
  idGenerator,
  factionRepository,
  factionUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  factionRepository: FactionRepository;
  factionUnitOfWork: ContentUnitOfWork<FactionRepository>;
}): FactionService {
  return new FactionService(
    clock,
    idGenerator,
    factionRepository,
    factionUnitOfWork,
  );
}
