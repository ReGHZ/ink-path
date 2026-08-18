import { describe, expect, it } from "vitest";

import { PlotService } from "./PlotService.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { Plot } from "../../domain/story/Plot.js";
import {
  PlotRepositoryConflictError,
  PlotRepositoryNotFoundError,
  PlotRepositoryReferencedError,
} from "../../domain/story/PlotRepositoryError.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import { seededDefinition } from "../../domain/support/relationshipDefinitionSeed.js";

import type { Clock } from "../../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../../shared/application/ports/IdGenerator.js";
import type {
  OutboxEvent,
  OutboxEventRepository,
} from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { PlotRepository } from "../../domain/story/PlotRepository.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType, ContentRevision } from "../../domain/support/ContentRevision.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type {
  ContentEntityLocation,
  ContentEntityLocator,
} from "../ports/ContentEntityLocator.js";
import type {
  ContentRepositories,
  ContentUnitOfWork,
} from "../ports/ContentUnitOfWork.js";

const now = new Date("2026-08-12T00:00:00.000Z");

const writer: ProjectMembership = { role: "writer", canDelete: true };
const editorNoDelete: ProjectMembership = { role: "editor", canDelete: false };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

class FakePlotRepository implements PlotRepository {
  readonly plots = new Map<string, Plot>();
  referencedOnDelete = false;
  conflictOnUpdate = false;

  findById(id: string): Promise<Plot | null> {
    return Promise.resolve(this.plots.get(id) ?? null);
  }

  findByProjectId(projectId: string): Promise<Plot[]> {
    return Promise.resolve(
      [...this.plots.values()].filter((p) => p.projectId === projectId),
    );
  }

  insert(plot: Plot): Promise<void> {
    if (this.plots.has(plot.id)) {
      return Promise.reject(new PlotRepositoryConflictError());
    }
    this.plots.set(plot.id, plot);
    return Promise.resolve();
  }

  update(plot: Plot): Promise<void> {
    if (this.conflictOnUpdate) {
      return Promise.reject(new PlotRepositoryConflictError());
    }
    this.plots.set(
      plot.id,
      Plot.reconstitute({ ...plot.toSnapshot(), version: plot.version + 1 }),
    );
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    if (this.referencedOnDelete) {
      return Promise.reject(new PlotRepositoryReferencedError());
    }

    const existing = this.plots.get(id);

    if (!existing) {
      return Promise.reject(new PlotRepositoryNotFoundError());
    }

    if (existing.version !== expectedVersion) {
      return Promise.reject(new PlotRepositoryConflictError());
    }

    this.plots.delete(id);
    return Promise.resolve();
  }

  linkRevision(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeContentRevisionRepository implements ContentRevisionRepository {
  readonly revisions = new Map<string, ContentRevision>();

  findById(id: string): Promise<ContentRevision | null> {
    return Promise.resolve(this.revisions.get(id) ?? null);
  }

  findByEntity(): Promise<ContentRevision[]> {
    return Promise.resolve([...this.revisions.values()]);
  }

  insert(contentRevision: ContentRevision): Promise<void> {
    this.revisions.set(contentRevision.id, contentRevision);
    return Promise.resolve();
  }
}

class FakeOutboxEventRepository implements OutboxEventRepository {
  readonly events: OutboxEvent[] = [];

  insert(event: OutboxEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

// 7.4b: what the M:N delete guard reads, handed to the service through the unit
// of work. Only findByEntity() is implemented with behaviour — the other four
// methods belong to RelationshipService, and answering them here would invent
// conduct no test asserts. Both orientations are matched, exactly like
// PrismaContentRelationshipRepository's OR: the entity under test can sit on
// either end of the row.
class FakeContentRelationshipRepository implements ContentRelationshipRepository {
  readonly relationships: ContentRelationship[] = [];

  findById(): Promise<ContentRelationship | null> {
    return Promise.reject(new Error("findById is not part of the delete guard"));
  }

  findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    return Promise.resolve(
      this.relationships.filter(
        (relationship) =>
          relationship.projectId === projectId &&
          ((relationship.sourceEntityType === entityType &&
            relationship.sourceEntityId === entityId) ||
            (relationship.targetEntityType === entityType &&
              relationship.targetEntityId === entityId)),
      ),
    );
  }

  insert(): Promise<void> {
    return Promise.reject(new Error("insert is not part of the delete guard"));
  }

  update(): Promise<void> {
    return Promise.reject(new Error("update is not part of the delete guard"));
  }

  delete(): Promise<void> {
    return Promise.reject(new Error("delete is not part of the delete guard"));
  }
}

class FakeContentEntityLocator implements ContentEntityLocator {
  private readonly entities = new Map<string, ContentEntityLocation>();

  seed(
    entityType: ContentEntityType,
    entityId: string,
    location: ContentEntityLocation,
  ): this {
    this.entities.set(`${entityType}:${entityId}`, location);
    return this;
  }

  locate({
    entityType,
    entityId,
  }: {
    entityType: ContentEntityType;
    entityId: string;
  }): Promise<ContentEntityLocation | null> {
    return Promise.resolve(
      this.entities.get(`${entityType}:${entityId}`) ?? null,
    );
  }
}

class FakeContentUnitOfWork implements ContentUnitOfWork<PlotRepository> {
  constructor(
    private readonly entity: PlotRepository,
    private readonly contentRevisions: ContentRevisionRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly contentRelationships: ContentRelationshipRepository,
  ) {}

  async transaction<T>(
    work: (
      repositories: ContentRepositories<PlotRepository>,
      outboxEvents: OutboxEventRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return work(
      {
        entity: this.entity,
        contentRevisions: this.contentRevisions,
        contentRelationships: this.contentRelationships,
      },
      this.outboxEvents,
    );
  }
}

class FakeIdGenerator implements IdGenerator {
  private nextId = 1;

  generate(): string {
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, "0")}`;
    this.nextId += 1;
    return id;
  }
}

const clock: Clock = { now: () => now };

function createService() {
  const plots = new FakePlotRepository();
  const contentRevisions = new FakeContentRevisionRepository();
  const outboxEvents = new FakeOutboxEventRepository();
  const relationships = new FakeContentRelationshipRepository();
  const locator = new FakeContentEntityLocator();
  const uow = new FakeContentUnitOfWork(
    plots,
    contentRevisions,
    outboxEvents,
    relationships,
  );

  return {
    plots,
    contentRevisions,
    outboxEvents,
    relationships,
    locator,
    service: new PlotService(clock, new FakeIdGenerator(), plots, uow, locator),
  };
}

async function seedPlot(
  plots: FakePlotRepository,
  overrides: Partial<{ content: string | null; resolution: string | null }> = {},
): Promise<Plot> {
  const plot = Plot.create({
    id: "plot-1",
    projectId: "proj-1",
    createdByUserId: "user-1",
    name: "The Hollow Core Rebellion",
    theme: "scarcity as doctrine",
    conflict: "the qi tithe cannot be paid",
    resolution: overrides.resolution ?? null,
    content: overrides.content ?? null,
    currentRevisionId: "rev-0",
    now,
  });
  await plots.insert(plot);
  return plot;
}

describe("PlotService", () => {
  describe("createPlot", () => {
    it("creates the entity, its create revision, and emits content.created", async () => {
      const { plots, contentRevisions, outboxEvents, service } = createService();

      const result = await service.createPlot({
        requestingUserId: "user-1",
        requestingMembership: writer,
        projectId: "proj-1",
        name: "Rise of the Outer Disciple",
      });

      expect(plots.plots.size).toBe(1);
      expect([...contentRevisions.revisions.values()][0]?.changeType).toBe(
        "create",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.created");
      expect(outboxEvents.events[0]?.aggregateType).toBe("plot");
      expect(outboxEvents.events[0]?.aggregateId).toBe(result.plotId);
    });

    it("rejects a reviewer", async () => {
      const { plots, service } = createService();

      await expect(
        service.createPlot({
          requestingUserId: "user-1",
          requestingMembership: reviewer,
          projectId: "proj-1",
          name: "Forbidden Arc",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(plots.plots.size).toBe(0);
    });
  });

  describe("reads", () => {
    it("hides a plot belonging to another project behind 404", async () => {
      const { plots, service } = createService();
      await seedPlot(plots);

      await expect(
        service.getPlotById("other-project", "plot-1"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("changePlotStatus", () => {
    it("activates a plot that has content", async () => {
      const { plots, service } = createService();
      await seedPlot(plots, { content: "Arc body." });

      const detail = await service.changePlotStatus("proj-1", "plot-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "active",
      });

      expect(detail.status).toBe("active");
    });

    it("maps the active-needs-content guard to a 400", async () => {
      const { plots, service } = createService();
      await seedPlot(plots, { content: null });

      await expect(
        service.changePlotStatus("proj-1", "plot-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "active",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    // The guard specific to Plot: `completed` is a claim about the conflict
    // being resolved, so an empty `resolution` invalidates it.
    it("maps the completed-needs-resolution guard to a 400", async () => {
      const { plots, contentRevisions, service } = createService();
      await seedPlot(plots, { content: "Arc body.", resolution: null });

      await expect(
        service.changePlotStatus("proj-1", "plot-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          status: "completed",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

      expect(contentRevisions.revisions.size).toBe(0);
    });

    it("completes a plot that has both content and resolution", async () => {
      const { plots, service } = createService();
      await seedPlot(plots, {
        content: "Arc body.",
        resolution: "The tithe ledger is burned.",
      });

      const detail = await service.changePlotStatus("proj-1", "plot-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        status: "completed",
      });

      expect(detail.status).toBe("completed");
    });
  });

  describe("updatePlot", () => {
    it("writes an update revision and swaps currentRevisionId", async () => {
      const { plots, contentRevisions, service } = createService();
      await seedPlot(plots);

      const detail = await service.updatePlot("proj-1", "plot-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        theme: "the price of ascension",
      });

      expect(detail.theme).toBe("the price of ascension");
      expect(detail.currentRevisionId).not.toBe("rev-0");
      expect([...contentRevisions.revisions.values()][0]?.revisionNumber).toBe(1);
    });

    it("is a no-op when nothing changes", async () => {
      const { plots, contentRevisions, outboxEvents, service } = createService();
      await seedPlot(plots);

      await service.updatePlot("proj-1", "plot-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
        theme: "scarcity as doctrine",
      });

      expect(contentRevisions.revisions.size).toBe(0);
      expect(outboxEvents.events).toHaveLength(0);
    });

    it("maps a repository version conflict to a 409", async () => {
      const { plots, service } = createService();
      await seedPlot(plots);
      plots.conflictOnUpdate = true;

      await expect(
        service.updatePlot("proj-1", "plot-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
          name: "Renamed",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });
  });

  describe("deletePlot", () => {
    // Item 7.4b — Flow 3 §Delete step 5, M:N half. This blocker is invisible to
    // the database: `content_relationships` names its endpoints polymorphically,
    // with no foreign key, so nothing here can come from a P2003.
    it("refuses the delete while a content relationship still points at the plot, and names the blocker", async () => {
      const {
        plots,
        contentRevisions,
        outboxEvents,
        relationships,
        locator,
        service,
      } = createService();
      await seedPlot(plots);

      relationships.relationships.push(
        ContentRelationship.create({
          id: "rel-1",
          projectId: "proj-1",
          relationType: "appears_in",
          definition: seededDefinition("appears_in"),
          source: { entityType: "character", entityId: "char-9" },
          target: { entityType: "plot", entityId: "plot-1" },
          sourceAssertionId: "assertion-1",
          createdByUserId: "user-1",
          now,
        }),
      );
      locator.seed("character", "char-9", {
        projectId: "proj-1",
        entityName: "Kael of Vael",
      });

      const revisionsBefore = contentRevisions.revisions.size;
      const outboxBefore = outboxEvents.events.length;

      await expect(
        service.deletePlot("proj-1", "plot-1", {
          requestingUserId: "user-1",
          requestingMembership: writer,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
        details: {
          blockingRelationshipCount: 1,
          truncated: false,
          blockingRelationships: [
            {
              id: "rel-1",
              relationType: "appears_in",
              entityType: "character",
              entityId: "char-9",
              entityName: "Kael of Vael",
            },
          ],
        },
      });

      // The guard runs BEFORE the revision and the outbox insert. A delete
      // revision written for an entity that still exists would be worse than no
      // guard at all — the audit trail would claim a deletion that never
      // happened, and the embedding worker would drop a live entity's vectors.
      expect(await plots.findById("plot-1")).not.toBeNull();
      expect(contentRevisions.revisions.size).toBe(revisionsBefore);
      expect(outboxEvents.events).toHaveLength(outboxBefore);
    });

    it("writes the delete revision and event, then removes the row", async () => {
      const { plots, contentRevisions, outboxEvents, service } = createService();
      await seedPlot(plots);

      await service.deletePlot("proj-1", "plot-1", {
        requestingUserId: "user-1",
        requestingMembership: writer,
      });

      expect(plots.plots.size).toBe(0);
      expect([...contentRevisions.revisions.values()][0]?.changeType).toBe(
        "delete",
      );
      expect(outboxEvents.events[0]?.eventType).toBe("content.deleted");
    });

    it("rejects an editor without delete permission", async () => {
      const { plots, service } = createService();
      await seedPlot(plots);

      await expect(
        service.deletePlot("proj-1", "plot-1", {
          requestingUserId: "user-1",
          requestingMembership: editorNoDelete,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

      expect(plots.plots.size).toBe(1);
    });
  });
});
