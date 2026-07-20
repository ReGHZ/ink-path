import { ContentRevision } from "../../domain/support/ContentRevision.js";
import { WorldElement } from "../../domain/world/WorldElement.js";

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

// Plain, JSON-serializable mirror of WorldElementProperties for
// ContentRevision.afterSnapshot — Prisma's Json column needs actual
// JSON-compatible values, not Date instances, so dates go through
// toISOString() here rather than being passed as-is from toSnapshot().
function toRevisionSnapshot(worldElement: WorldElement): Record<string, unknown> {
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

export class WorldElementService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly worldElementUnitOfWork: ContentUnitOfWork<WorldElementRepository>,
  ) {}

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
    await this.worldElementUnitOfWork.transaction(async (repositories) => {
      await repositories.entity.insert(worldElement);
      await repositories.contentRevisions.insert(revision);
      await repositories.entity.linkRevision(
        worldElement.id,
        revisionId,
        worldElement.version,
      );
    });

    return { worldElementId: worldElement.id };
  }
}

export function createWorldElementService({
  clock,
  idGenerator,
  worldElementUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  worldElementUnitOfWork: ContentUnitOfWork<WorldElementRepository>;
}): WorldElementService {
  return new WorldElementService(clock, idGenerator, worldElementUnitOfWork);
}
