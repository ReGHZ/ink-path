import { AppError } from "../../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../../shared/errors/DomainError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Plot, type PlotStatus } from "../../domain/story/Plot.js";
import {
  PlotRepositoryConflictError,
  PlotRepositoryNotFoundError,
  PlotRepositoryReferencedError,
} from "../../domain/story/PlotRepositoryError.js";
import { ContentRevision } from "../../domain/support/ContentRevision.js";
import {
  assertNoBlockingRelationships,
  mapBlockedByRelationshipsError,
} from "../support/contentRelationshipDeleteGuard.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { PlotRepository } from "../../domain/story/PlotRepository.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { ContentUnitOfWork } from "../ports/ContentUnitOfWork.js";

export type CreatePlotInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  projectId: string;
  name: string;
  description?: string | null;
  theme?: string | null;
  conflict?: string | null;
  resolution?: string | null;
  content?: string | null;
};

export type CreatePlotResult = {
  plotId: string;
};

export type PlotDetail = {
  id: string;
  projectId: string;
  createdByUserId: string;
  name: string;
  description: string | null;
  theme: string | null;
  conflict: string | null;
  resolution: string | null;
  content: string | null;
  status: PlotStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChangePlotStatusInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  status: PlotStatus;
};

export type UpdatePlotInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
  name?: string;
  description?: string | null;
  theme?: string | null;
  conflict?: string | null;
  resolution?: string | null;
  content?: string | null;
};

export type DeletePlotInput = {
  requestingUserId: string;
  requestingMembership: ProjectMembership;
};

export function toRevisionSnapshot(plot: Plot): Record<string, unknown> {
  const snapshot = plot.toSnapshot();

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    createdByUserId: snapshot.createdByUserId,
    name: snapshot.name,
    description: snapshot.description,
    theme: snapshot.theme,
    conflict: snapshot.conflict,
    resolution: snapshot.resolution,
    content: snapshot.content,
    status: snapshot.status,
    currentRevisionId: snapshot.currentRevisionId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function assertCanWrite(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot modify plots");
  }
}

function assertCanDelete(membership: ProjectMembership): void {
  if (membership.role === "reviewer") {
    throw new AppError(ErrorCode.FORBIDDEN, "Reviewer role cannot delete plots");
  }

  if (membership.role === "editor" && !membership.canDelete) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      "Editor without delete permission cannot delete plots",
    );
  }
}

function mapPlotError(error: unknown): never {
  if (error instanceof PlotRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Plot not found");
  }

  if (error instanceof PlotRepositoryConflictError) {
    throw new AppError(ErrorCode.CONFLICT, "Plot was modified concurrently");
  }

  if (error instanceof PlotRepositoryReferencedError) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Plot is still referenced and cannot be deleted",
    );
  }

  // Covers both status guards the entity enforces: "active/completed needs
  // content" and "completed needs resolution" — both are Flow 3 400-class
  // domain validation failures, not transport or concurrency conditions.
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class PlotService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly plotRepository: PlotRepository,
    private readonly plotUnitOfWork: ContentUnitOfWork<PlotRepository>,
    // 7.4b: names the entities that block a delete. Only the delete path uses
    // it, and only after the guard has already refused the delete.
    private readonly contentEntityLocator: ContentEntityLocator,
  ) {}

  async createPlot(input: CreatePlotInput): Promise<CreatePlotResult> {
    assertCanWrite(input.requestingMembership);

    const now = this.clock.now();
    const revisionId = this.idGenerator.generate();

    // See EventService.createEvent for why construction is wrapped here while
    // Phase 4 leaves it bare.
    let plot: Plot;
    try {
      plot = Plot.create({
        id: this.idGenerator.generate(),
        projectId: input.projectId,
        createdByUserId: input.requestingUserId,
        name: input.name,
        description: input.description,
        theme: input.theme,
        conflict: input.conflict,
        resolution: input.resolution,
        content: input.content,
        currentRevisionId: revisionId,
        now,
      });
    } catch (error) {
      mapPlotError(error);
    }

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: input.projectId,
      entityType: "plot",
      entityId: plot.id,
      revisionNumber: plot.version,
      changedByUserId: input.requestingUserId,
      changeType: "create",
      afterSnapshot: toRevisionSnapshot(plot),
      now,
    });

    await this.plotUnitOfWork.transaction(async (repositories, outboxEvent) => {
      await repositories.entity.insert(plot);
      await repositories.contentRevisions.insert(revision);
      await repositories.entity.linkRevision(plot.id, revisionId, plot.version);
      await outboxEvent.insert({
        id: this.idGenerator.generate(),
        eventType: "content.created",
        eventVersion: 1,
        aggregateType: "plot",
        aggregateId: plot.id,
        projectId: plot.projectId,
        triggeredByUserId: input.requestingUserId,
        payload: {
          projectId: plot.projectId,
          entityType: "plot",
          entityId: plot.id,
          revisionId,
          revisionNumber: plot.version,
          changedByUserId: input.requestingUserId,
        },
        routingKey: "content.created",
        exchange: "saas.events",
      });
    });

    return { plotId: plot.id };
  }

  async getPlotById(projectId: string, plotId: string): Promise<PlotDetail> {
    const plot = await this.loadExistingPlot(projectId, plotId);

    return this.toPlotDetail(plot);
  }

  async listPlotsByProject(projectId: string): Promise<PlotDetail[]> {
    const plots = await this.plotRepository.findByProjectId(projectId);

    return plots.map((plot) => this.toPlotDetail(plot));
  }

  async changePlotStatus(
    projectId: string,
    plotId: string,
    input: ChangePlotStatusInput,
  ): Promise<PlotDetail> {
    assertCanWrite(input.requestingMembership);

    const plot = await this.loadExistingPlot(projectId, plotId);
    const oldVersion = plot.version;
    const beforeSnapshot = toRevisionSnapshot(plot);

    let changed: boolean;
    try {
      changed = plot.changeStatus(input.status, this.clock.now());
    } catch (error) {
      mapPlotError(error);
    }

    if (!changed) {
      return this.toPlotDetail(plot);
    }

    return this.persistChange(
      plot,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async updatePlot(
    projectId: string,
    plotId: string,
    input: UpdatePlotInput,
  ): Promise<PlotDetail> {
    assertCanWrite(input.requestingMembership);

    const plot = await this.loadExistingPlot(projectId, plotId);
    const oldVersion = plot.version;
    const beforeSnapshot = toRevisionSnapshot(plot);

    let changed: boolean;
    try {
      changed = plot.updateDetails({
        name: input.name,
        description: input.description,
        theme: input.theme,
        conflict: input.conflict,
        resolution: input.resolution,
        content: input.content,
        now: this.clock.now(),
      });
    } catch (error) {
      mapPlotError(error);
    }

    if (!changed) {
      return this.toPlotDetail(plot);
    }

    return this.persistChange(
      plot,
      oldVersion,
      beforeSnapshot,
      input.requestingUserId,
    );
  }

  async deletePlot(
    projectId: string,
    plotId: string,
    input: DeletePlotInput,
  ): Promise<void> {
    assertCanDelete(input.requestingMembership);

    const plot = await this.loadExistingPlot(projectId, plotId);
    const now = this.clock.now();

    const revisionId = this.idGenerator.generate();
    const revision = ContentRevision.create({
      id: revisionId,
      projectId,
      entityType: "plot",
      entityId: plot.id,
      revisionNumber: plot.version + 1,
      changedByUserId: input.requestingUserId,
      changeType: "delete",
      beforeSnapshot: toRevisionSnapshot(plot),
      now,
    });

    try {
      await this.plotUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          // Flow 3 §Delete step 5, M:N half (item 7.4b). First statement in the
          // transaction: it is a read, and everything below it is work a block
          // would throw away. The FK half stays where it always was — inside
          // repository.delete(), as PlotRepositoryReferencedError.
          await assertNoBlockingRelationships(
            repositories.contentRelationships,
            { projectId, entityType: "plot", entityId: plot.id },
          );
          await repositories.contentRevisions.insert(revision);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.deleted",
            eventVersion: 1,
            aggregateType: "plot",
            aggregateId: plot.id,
            projectId: plot.projectId,
            triggeredByUserId: input.requestingUserId,
            payload: {
              projectId: plot.projectId,
              entityType: "plot",
              entityId: plot.id,
              revisionId,
              revisionNumber: plot.version + 1,
              changedByUserId: input.requestingUserId,
            },
            routingKey: "content.deleted",
            exchange: "saas.events",
          });
          await repositories.entity.delete(plot.id, plot.version);
        },
      );
    } catch (error) {
      // Before mapPlotError: the blocked-delete error carries rows that
      // still need names, which is asynchronous work a `never`-returning
      // mapper cannot do. Returns untouched for every other error.
      await mapBlockedByRelationshipsError(error, {
        contentEntityLocator: this.contentEntityLocator,
        entityLabel: "Plot",
      });
      mapPlotError(error);
    }
  }

  private async persistChange(
    plot: Plot,
    oldVersion: number,
    beforeSnapshot: Record<string, unknown>,
    requestingUserId: string,
  ): Promise<PlotDetail> {
    const revisionId = this.idGenerator.generate();
    const afterSnapshot = toRevisionSnapshot(plot);

    const revision = ContentRevision.create({
      id: revisionId,
      projectId: plot.projectId,
      entityType: "plot",
      entityId: plot.id,
      revisionNumber: oldVersion + 1,
      changedByUserId: requestingUserId,
      changeType: "update",
      beforeSnapshot,
      afterSnapshot,
      now: plot.updatedAt,
    });

    const plotToPersist = Plot.reconstitute({
      ...plot.toSnapshot(),
      currentRevisionId: revisionId,
    });

    try {
      await this.plotUnitOfWork.transaction(
        async (repositories, outboxEvent) => {
          await repositories.contentRevisions.insert(revision);
          await repositories.entity.update(plotToPersist);
          await outboxEvent.insert({
            id: this.idGenerator.generate(),
            eventType: "content.updated",
            eventVersion: 1,
            aggregateType: "plot",
            aggregateId: plot.id,
            projectId: plot.projectId,
            triggeredByUserId: requestingUserId,
            payload: {
              projectId: plot.projectId,
              entityType: "plot",
              entityId: plot.id,
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
      mapPlotError(error);
    }

    return this.toPlotDetail(plotToPersist);
  }

  private async loadExistingPlot(
    projectId: string,
    plotId: string,
  ): Promise<Plot> {
    const plot = await this.plotRepository.findById(plotId);

    if (plot?.projectId !== projectId) {
      throw new AppError(ErrorCode.NOT_FOUND, "Plot not found");
    }

    return plot;
  }

  private toPlotDetail(plot: Plot): PlotDetail {
    return {
      id: plot.id,
      projectId: plot.projectId,
      createdByUserId: plot.createdByUserId,
      name: plot.name,
      description: plot.description,
      theme: plot.theme,
      conflict: plot.conflict,
      resolution: plot.resolution,
      content: plot.content,
      status: plot.status,
      currentRevisionId: plot.currentRevisionId,
      createdAt: plot.createdAt,
      updatedAt: plot.updatedAt,
    };
  }
}

export function createPlotService({
  clock,
  idGenerator,
  plotRepository,
  plotUnitOfWork,
  contentEntityLocator,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  plotRepository: PlotRepository;
  plotUnitOfWork: ContentUnitOfWork<PlotRepository>;
  contentEntityLocator: ContentEntityLocator;
}): PlotService {
  return new PlotService(
    clock,
    idGenerator,
    plotRepository,
    plotUnitOfWork,
    contentEntityLocator,
  );
}
