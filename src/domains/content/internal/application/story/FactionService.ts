import { Faction } from "../../domain/story/Faction.js";
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

export class FactionService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
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
    await this.factionUnitOfWork.transaction(async (repositories) => {
      await repositories.entity.insert(faction);
      await repositories.contentRevisions.insert(revision);
      await repositories.entity.linkRevision(
        faction.id,
        revisionId,
        faction.version,
      );
    });

    return { factionId: faction.id };
  }
}

export function createFactionService({
  clock,
  idGenerator,
  factionUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  factionUnitOfWork: ContentUnitOfWork<FactionRepository>;
}): FactionService {
  return new FactionService(clock, idGenerator, factionUnitOfWork);
}
