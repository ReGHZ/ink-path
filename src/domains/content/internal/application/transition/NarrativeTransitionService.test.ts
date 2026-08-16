import { beforeEach, describe, expect, it } from "vitest";

import { NarrativeTransitionService } from "./NarrativeTransitionService.js";
import { AppError } from "../../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../../shared/errors/ErrorCode.js";
import { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import {
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";
import {
  NarrativeTransition,
  type NarrativeTransitionProperties,
} from "../../domain/transition/NarrativeTransition.js";
import {
  TransitionEffect,
  type TransitionEffectProperties,
} from "../../domain/transition/TransitionEffect.js";

import type { OutboxEvent } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";
import type { TransitionEffectRepository } from "../../domain/transition/TransitionEffectRepository.js";
import type {
  AppliedAttributeChange,
  ApplyAttributeChangeInput,
  ContentAttributeMutator,
} from "../ports/ContentAttributeMutator.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { NarrativeTransitionUnitOfWork } from "../ports/NarrativeTransitionUnitOfWork.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const projectId = "project-1";
const otherProjectId = "project-2";
const userId = "user-1";

const writer: ProjectMembership = { role: "writer", canDelete: true };
const reviewer: ProjectMembership = { role: "reviewer", canDelete: false };

// Repositories store SNAPSHOTS and reconstitute on every read, exactly as a real
// adapter does. That is not fussiness: if a fake handed back the same mutable
// instance it holds, `markApplied()` would appear to persist itself and a
// service that forgot to call `update()` would still pass every test here.
class FakeNarrativeTransitionRepository
  implements NarrativeTransitionRepository
{
  rows = new Map<string, NarrativeTransitionProperties>();
  locked: string[] = [];
  deleted: string[] = [];

  save(transition: NarrativeTransition): void {
    this.rows.set(transition.id, transition.toSnapshot());
  }

  findById(id: string): Promise<NarrativeTransition | null> {
    const row = this.rows.get(id);

    return Promise.resolve(
      row ? NarrativeTransition.reconstitute({ ...row }) : null,
    );
  }

  findByIdForUpdate(id: string): Promise<NarrativeTransition | null> {
    this.locked.push(id);

    return this.findById(id);
  }

  findByProjectId(searchProjectId: string): Promise<NarrativeTransition[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.projectId === searchProjectId)
        .map((row) => NarrativeTransition.reconstitute({ ...row })),
    );
  }

  findBySourceEntity(
    searchProjectId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<NarrativeTransition[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter(
          (row) =>
            row.projectId === searchProjectId &&
            row.sourceEntityType === sourceEntityType &&
            row.sourceEntityId === sourceEntityId,
        )
        .map((row) => NarrativeTransition.reconstitute({ ...row })),
    );
  }

  insert(transition: NarrativeTransition): Promise<void> {
    this.save(transition);

    return Promise.resolve();
  }

  update(transition: NarrativeTransition): Promise<void> {
    this.save(transition);

    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.deleted.push(id);
    this.rows.delete(id);

    return Promise.resolve();
  }
}

class FakeTransitionEffectRepository implements TransitionEffectRepository {
  rows = new Map<string, TransitionEffectProperties>();
  locked: string[] = [];
  updated: string[] = [];
  deleted: string[] = [];
  deletedByTransition: string[] = [];

  save(effect: TransitionEffect): void {
    this.rows.set(effect.id, effect.toSnapshot());
  }

  findById(id: string): Promise<TransitionEffect | null> {
    const row = this.rows.get(id);

    return Promise.resolve(
      row ? TransitionEffect.reconstitute({ ...row }) : null,
    );
  }

  findByIdForUpdate(id: string): Promise<TransitionEffect | null> {
    this.locked.push(id);

    return this.findById(id);
  }

  findByTransitionId(transitionId: string): Promise<TransitionEffect[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.narrativeTransitionId === transitionId)
        .map((row) => TransitionEffect.reconstitute({ ...row })),
    );
  }

  insert(effect: TransitionEffect): Promise<void> {
    this.save(effect);

    return Promise.resolve();
  }

  update(effect: TransitionEffect): Promise<void> {
    this.updated.push(effect.id);
    this.save(effect);

    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.deleted.push(id);
    this.rows.delete(id);

    return Promise.resolve();
  }

  deleteByTransitionId(transitionId: string): Promise<void> {
    this.deletedByTransition.push(transitionId);

    for (const [id, row] of this.rows) {
      if (row.narrativeTransitionId === transitionId) {
        this.rows.delete(id);
      }
    }

    return Promise.resolve();
  }
}

class FakeContentRelationshipRepository
  implements ContentRelationshipRepository
{
  rows: ContentRelationship[] = [];
  inserted: ContentRelationship[] = [];
  deleted: Array<{ id: string; expectedVersion: number }> = [];
  duplicateOnInsert = false;
  notFoundOnDelete = false;

  findById(): Promise<ContentRelationship | null> {
    return Promise.resolve(null);
  }

  findByEntity(
    searchProjectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    return Promise.resolve(
      this.rows.filter(
        (row) =>
          row.projectId === searchProjectId &&
          ((row.sourceEntityType === entityType &&
            row.sourceEntityId === entityId) ||
            (row.targetEntityType === entityType &&
              row.targetEntityId === entityId)),
      ),
    );
  }

  insert(relationship: ContentRelationship): Promise<void> {
    if (this.duplicateOnInsert) {
      return Promise.reject(new ContentRelationshipRepositoryDuplicateError());
    }

    this.inserted.push(relationship);
    this.rows.push(relationship);

    return Promise.resolve();
  }

  update(): Promise<void> {
    return Promise.resolve();
  }

  delete(id: string, expectedVersion: number): Promise<void> {
    if (this.notFoundOnDelete) {
      return Promise.reject(new ContentRelationshipRepositoryNotFoundError());
    }

    this.deleted.push({ id, expectedVersion });
    this.rows = this.rows.filter((row) => row.id !== id);

    return Promise.resolve();
  }
}

class FakeContentAttributeMutator implements ContentAttributeMutator {
  calls: ApplyAttributeChangeInput[] = [];
  result: AppliedAttributeChange | null = {
    projectId,
    revisionNumber: 4,
    changed: true,
  };

  applyAttributeChange(
    input: ApplyAttributeChangeInput,
  ): Promise<AppliedAttributeChange | null> {
    this.calls.push(input);

    return Promise.resolve(this.result);
  }
}

let transitions: FakeNarrativeTransitionRepository;
let effects: FakeTransitionEffectRepository;
let relationships: FakeContentRelationshipRepository;
let mutator: FakeContentAttributeMutator;
let outbox: OutboxEvent[];
let locations: Map<string, string>;
let generated: number;
let service: NarrativeTransitionService;

function locate(entityType: ContentEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

beforeEach(() => {
  transitions = new FakeNarrativeTransitionRepository();
  effects = new FakeTransitionEffectRepository();
  relationships = new FakeContentRelationshipRepository();
  mutator = new FakeContentAttributeMutator();
  outbox = [];
  generated = 0;

  locations = new Map([
    [locate("scene", "scene-1"), projectId],
    [locate("character", "character-1"), projectId],
    [locate("character", "character-2"), projectId],
    [locate("faction", "faction-1"), projectId],
    [locate("scene", "scene-foreign"), otherProjectId],
  ]);

  const locator: ContentEntityLocator = {
    locate: ({ entityType, entityId }) => {
      const found = locations.get(locate(entityType, entityId));

      return Promise.resolve(
        found === undefined ? null : { projectId: found, entityName: entityId },
      );
    },
  };

  const unitOfWork: NarrativeTransitionUnitOfWork = {
    transaction: (work) =>
      work(
        {
          narrativeTransitions: transitions,
          transitionEffects: effects,
          contentRelationships: relationships,
          contentAttributes: mutator,
        },
        {
          insert: (event) => {
            outbox.push(event);

            return Promise.resolve();
          },
        },
      ),
  };

  service = new NarrativeTransitionService(
    { now: () => later },
    {
      generate: () => {
        generated += 1;

        return `generated-${String(generated)}`;
      },
    },
    transitions,
    effects,
    locator,
    unitOfWork,
  );
});

function seedTransition(
  overrides: Partial<NarrativeTransitionProperties> = {},
): NarrativeTransition {
  const transition = NarrativeTransition.reconstitute({
    id: "transition-1",
    projectId,
    sourceEntityType: "scene",
    sourceEntityId: "scene-1",
    title: "Raja Terbunuh",
    description: null,
    declaredByUserId: userId,
    reversesTransitionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  transitions.save(transition);

  return transition;
}

function seedEffect(
  overrides: Partial<TransitionEffectProperties> = {},
): TransitionEffect {
  const effect = TransitionEffect.reconstitute({
    id: "effect-1",
    narrativeTransitionId: "transition-1",
    projectId,
    effectType: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "archetype",
    newValue: "mentor",
    relationshipType: null,
    relatedEntityType: null,
    relatedEntityId: null,
    appliedAt: null,
    contentRevisionId: null,
    createdAt: now,
    ...overrides,
  });

  effects.save(effect);

  return effect;
}

const relationshipEffectFields = {
  effectType: "relationship_add" as const,
  fieldPath: null,
  newValue: null,
  relationshipType: "member_of",
  relatedEntityType: "faction" as ContentEntityType,
  relatedEntityId: "faction-1",
};

describe("declareTransition", () => {
  it("refuses a reviewer", async () => {
    await expect(
      service.declareTransition({
        requestingUserId: userId,
        requestingMembership: reviewer,
        projectId,
        sourceEntityType: "scene",
        sourceEntityId: "scene-1",
        title: "Raja Terbunuh",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("answers 404 for a source entity in another project", async () => {
    await expect(
      service.declareTransition({
        requestingUserId: userId,
        requestingMembership: writer,
        projectId,
        sourceEntityType: "scene",
        sourceEntityId: "scene-foreign",
        title: "Raja Terbunuh",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("stores a declared transition with no effects", async () => {
    const detail = await service.declareTransition({
      requestingUserId: userId,
      requestingMembership: writer,
      projectId,
      sourceEntityType: "scene",
      sourceEntityId: "scene-1",
      title: "  Raja Terbunuh  ",
    });

    expect(detail.status).toBe("declared");
    expect(detail.effects).toEqual([]);
    expect(detail.title).toBe("Raja Terbunuh");
    expect(transitions.rows.size).toBe(1);
  });

  // Flow 10 §Declare step 6: reversing a transition that never happened records
  // the undoing of nothing.
  it("refuses to reverse a transition that is only declared", async () => {
    seedTransition();
    seedEffect();

    await expect(
      service.declareTransition({
        requestingUserId: userId,
        requestingMembership: writer,
        projectId,
        sourceEntityType: "scene",
        sourceEntityId: "scene-1",
        title: "Pembalasan",
        reversesTransitionId: "transition-1",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("accepts a reversal of a partially applied transition", async () => {
    seedTransition();
    seedEffect();
    seedEffect({ id: "effect-2", appliedAt: later, contentRevisionId: "rev-1" });

    const detail = await service.declareTransition({
      requestingUserId: userId,
      requestingMembership: writer,
      projectId,
      sourceEntityType: "scene",
      sourceEntityId: "scene-1",
      title: "Pembalasan",
      reversesTransitionId: "transition-1",
    });

    expect(detail.reversesTransitionId).toBe("transition-1");
  });

  it("answers 404 when the reversed transition belongs to another project", async () => {
    seedTransition({ projectId: otherProjectId });

    await expect(
      service.declareTransition({
        requestingUserId: userId,
        requestingMembership: writer,
        projectId,
        sourceEntityType: "scene",
        sourceEntityId: "scene-1",
        title: "Pembalasan",
        reversesTransitionId: "transition-1",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("getTransitionById", () => {
  it("answers 404 for a transition in another project", async () => {
    seedTransition({ projectId: otherProjectId });

    await expect(
      service.getTransitionById(projectId, "transition-1"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("derives the status from the effects it loads", async () => {
    seedTransition();
    seedEffect();
    seedEffect({ id: "effect-2", appliedAt: later, contentRevisionId: "rev-1" });

    const detail = await service.getTransitionById(projectId, "transition-1");

    expect(detail.status).toBe("partially_applied");
    expect(detail.effects).toHaveLength(2);
  });
});

describe("updateTransitionDetails", () => {
  beforeEach(() => {
    seedTransition();
  });

  it("refuses a reviewer", async () => {
    await expect(
      service.updateTransitionDetails(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
        title: "Judul Lain",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    expect(transitions.rows.get("transition-1")?.title).toBe("Raja Terbunuh");
  });

  it("answers 404 for a transition in another project", async () => {
    transitions.rows.clear();
    seedTransition({ projectId: otherProjectId });

    await expect(
      service.updateTransitionDetails(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        title: "Judul Lain",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("stores the new labels and stamps the update time", async () => {
    const detail = await service.updateTransitionDetails(
      projectId,
      "transition-1",
      {
        requestingUserId: userId,
        requestingMembership: writer,
        title: "Raja Terbunuh di Tangga Istana",
        description: "Dua penjaga ikut tewas.",
      },
    );

    expect(detail.title).toBe("Raja Terbunuh di Tangga Istana");
    expect(transitions.rows.get("transition-1")?.description).toBe(
      "Dua penjaga ikut tewas.",
    );
    expect(transitions.rows.get("transition-1")?.updatedAt).toEqual(later);
  });

  it("skips the write when nothing changed", async () => {
    const detail = await service.updateTransitionDetails(
      projectId,
      "transition-1",
      {
        requestingUserId: userId,
        requestingMembership: writer,
        title: "Raja Terbunuh",
      },
    );

    expect(detail.title).toBe("Raja Terbunuh");
    // A no-op PATCH must not bump `updated_at` — the same contract every Phase
    // 4-6 update carries.
    expect(transitions.rows.get("transition-1")?.updatedAt).toEqual(now);
  });

  it("reports the derived status alongside the new labels", async () => {
    seedEffect();

    const detail = await service.updateTransitionDetails(
      projectId,
      "transition-1",
      {
        requestingUserId: userId,
        requestingMembership: writer,
        title: "Judul Lain",
      },
    );

    expect(detail.status).toBe("declared");
    expect(detail.effects).toHaveLength(1);
  });
});

describe("list endpoints", () => {
  it("returns only this project's transitions, each with its derived status", async () => {
    seedTransition();
    seedEffect({ appliedAt: later, contentRevisionId: "rev-1" });
    seedTransition({ id: "transition-2", projectId: otherProjectId });

    const details = await service.listTransitionsByProject(projectId);

    expect(details).toHaveLength(1);
    expect(details[0]?.status).toBe("fully_applied");
  });

  // The entity is validated before its transitions are listed: an id from
  // another project must answer 404, not an empty list that looks plausible.
  it("answers 404 when the source entity belongs to another project", async () => {
    await expect(
      service.listTransitionsBySourceEntity(projectId, "scene", "scene-foreign"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("answers 404 when the source entity does not exist at all", async () => {
    await expect(
      service.listTransitionsBySourceEntity(projectId, "scene", "scene-missing"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("returns the transitions declared from one source entity", async () => {
    seedTransition();
    seedTransition({ id: "transition-2", sourceEntityId: "scene-other" });

    const details = await service.listTransitionsBySourceEntity(
      projectId,
      "scene",
      "scene-1",
    );

    expect(details.map((detail) => detail.id)).toEqual(["transition-1"]);
  });
});

describe("addEffect", () => {
  beforeEach(() => {
    seedTransition();
  });

  // The aggregate-root lock. Without it, `deleteTransition` cannot trust that the
  // set of children it inspected is the set its blanket delete removes — a child
  // inserted in that window could be applied by a third request and then
  // destroyed as an applied fact.
  it("holds the aggregate root lock while inserting the child", async () => {
    await service.addEffect(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
      effectType: "attribute_change",
      targetEntityType: "character",
      targetEntityId: "character-1",
      fieldPath: "archetype",
      newValue: "mentor",
    });

    expect(transitions.locked).toEqual(["transition-1"]);
  });

  it("refuses a reviewer", async () => {
    await expect(
      service.addEffect(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("answers 404 for an unknown target entity", async () => {
    await expect(
      service.addEffect(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-missing",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("answers 404 for an unknown related entity", async () => {
    await expect(
      service.addEffect(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        effectType: "relationship_add",
        targetEntityType: "character",
        targetEntityId: "character-1",
        relationshipType: "member_of",
        relatedEntityType: "faction",
        relatedEntityId: "faction-missing",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("turns a field the allowlist refuses into a 400", async () => {
    await expect(
      service.addEffect(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "status",
        newValue: "archived",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("stores a pending effect", async () => {
    const detail = await service.addEffect(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
      effectType: "attribute_change",
      targetEntityType: "character",
      targetEntityId: "character-1",
      fieldPath: "archetype",
      newValue: "mentor",
    });

    expect(detail.appliedAt).toBeNull();
    expect(detail.narrativeTransitionId).toBe("transition-1");
    expect(effects.rows.size).toBe(1);
  });

  it("answers 404 when the transition belongs to another project", async () => {
    transitions.rows.clear();
    seedTransition({ projectId: otherProjectId });

    await expect(
      service.addEffect(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        effectType: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("deleteEffect", () => {
  it("refuses to delete an applied effect", async () => {
    seedTransition();
    seedEffect({ appliedAt: later, contentRevisionId: "rev-1" });

    await expect(
      service.deleteEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(effects.deleted).toEqual([]);
  });

  // The guard reads the row under a lock, not with a plain SELECT: a concurrent
  // apply must not be able to commit between the check and the delete.
  it("locks the row before deleting a pending effect", async () => {
    seedTransition();
    seedEffect();

    await service.deleteEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(effects.locked).toEqual(["effect-1"]);
    expect(effects.deleted).toEqual(["effect-1"]);
  });

  it("answers 404 for an effect in another project", async () => {
    seedTransition();
    seedEffect({ projectId: otherProjectId });

    await expect(
      service.deleteEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("deleteTransition", () => {
  it("refuses when any effect is applied, and deletes nothing", async () => {
    seedTransition();
    seedEffect();
    seedEffect({ id: "effect-2", appliedAt: later, contentRevisionId: "rev-1" });

    await expect(
      service.deleteTransition(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(effects.deletedByTransition).toEqual([]);
    expect(transitions.deleted).toEqual([]);
  });

  it("deletes children before the parent when everything is pending", async () => {
    seedTransition();
    seedEffect();
    seedEffect({ id: "effect-2" });

    await service.deleteTransition(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    // Root first, then every child, then one cascade statement, then the parent.
    // The root lock is what keeps a concurrent addEffect out of the window; the
    // child locks are what make a concurrent apply visible; the FK is Restrict,
    // so the delete order cannot be reversed.
    expect(transitions.locked).toEqual(["transition-1"]);
    expect(effects.locked).toEqual(["effect-1", "effect-2"]);
    expect(effects.deletedByTransition).toEqual(["transition-1"]);
    expect(transitions.deleted).toEqual(["transition-1"]);
  });

  it("refuses a reviewer", async () => {
    seedTransition();

    await expect(
      service.deleteTransition(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("applyEffect — attribute_change", () => {
  beforeEach(() => {
    seedTransition();
    seedEffect();
  });

  it("resolves the wire field name to the aggregate property before writing", async () => {
    await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(mutator.calls).toHaveLength(1);
    expect(mutator.calls[0]).toMatchObject({
      entityType: "character",
      entityId: "character-1",
      domainField: "archetype",
      newValue: "mentor",
      changedByUserId: userId,
    });
  });

  it("stamps the effect with the revision the mutation produced", async () => {
    const detail = await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    const revisionId = mutator.calls[0]?.revisionId;

    expect(detail.appliedAt).toEqual(later);
    expect(detail.contentRevisionId).toBe(revisionId);
    // Persisted, not merely mutated in memory: the fake reconstitutes on read,
    // so a missing `update()` call would leave the stored row pending.
    expect(effects.updated).toEqual(["effect-1"]);
    expect(effects.rows.get("effect-1")?.appliedAt).toEqual(later);
  });

  it("emits the existing content event so the embedding worker sees it", async () => {
    await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      eventType: "content.updated",
      aggregateType: "character",
      aggregateId: "character-1",
      projectId,
      routingKey: "content.updated",
      exchange: "saas.events",
      payload: {
        entityType: "character",
        entityId: "character-1",
        revisionNumber: 4,
        changedByUserId: userId,
      },
    });
  });

  it("locks the effect row before touching the entity", async () => {
    await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(effects.locked).toEqual(["effect-1"]);
  });

  // Decision D5 for attributes: the world already holds the intended value.
  it("answers 409 and writes nothing when the value is already in place", async () => {
    mutator.result = { projectId, revisionNumber: 4, changed: false };

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(outbox).toEqual([]);
    expect(effects.rows.get("effect-1")?.appliedAt).toBeNull();
  });

  it("answers 404 when the target entity is gone", async () => {
    mutator.result = null;

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  // Idempotent, not a conflict: the caller asked for a state that holds. What
  // must not happen is a second ContentRevision.
  it("is a no-op when the effect is already applied", async () => {
    seedEffect({ appliedAt: later, contentRevisionId: "rev-1" });

    const detail = await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(detail.contentRevisionId).toBe("rev-1");
    expect(mutator.calls).toEqual([]);
    expect(outbox).toEqual([]);
  });

  // Decision D3's second half. `status` could never pass create(), so this row
  // could only exist because the allowlist was narrowed after it was declared —
  // it stays readable and deletable, but it must not apply.
  it("refuses a field the allowlist no longer covers", async () => {
    seedEffect({ fieldPath: "status" });

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(mutator.calls).toEqual([]);
  });

  it("refuses a reviewer", async () => {
    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("applyEffect — relationship effects", () => {
  beforeEach(() => {
    seedTransition();
  });

  it("writes the relationship through the domain, canonicalising the endpoints", async () => {
    // Declared faction-first with a NON-directional type: the stored row must
    // come back character-first, because canonical orientation is the row's
    // identity and this path must produce the same row the manual endpoint does.
    seedEffect({
      ...relationshipEffectFields,
      relationshipType: "ally_of",
      targetEntityType: "faction",
      targetEntityId: "faction-1",
      relatedEntityType: "character",
      relatedEntityId: "character-1",
    });

    await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(relationships.inserted).toHaveLength(1);
    expect(relationships.inserted[0]).toMatchObject({
      sourceEntityType: "character",
      sourceEntityId: "character-1",
      targetEntityType: "faction",
      targetEntityId: "faction-1",
      relationType: "ally_of",
      createdByUserId: userId,
    });
  });

  it("applies without a revision pointer and emits the causality event", async () => {
    seedEffect(relationshipEffectFields);

    const detail = await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(detail.appliedAt).toEqual(later);
    expect(detail.contentRevisionId).toBeNull();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      eventType: "narrative.effect.applied",
      aggregateType: "narrative_transition",
      aggregateId: "transition-1",
      routingKey: "narrative.effect.applied",
      payload: {
        effectId: "effect-1",
        effectType: "relationship_add",
        relationshipType: "member_of",
      },
    });
  });

  // Decision D5: the link exists already, created by hand. Marking the effect
  // applied would attribute someone else's edit to this transition.
  it("answers 409 when the relationship it would add already exists", async () => {
    seedEffect(relationshipEffectFields);
    relationships.duplicateOnInsert = true;

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(effects.rows.get("effect-1")?.appliedAt).toBeNull();
    expect(outbox).toEqual([]);
  });

  it("removes the row that matches the effect's natural identity", async () => {
    seedEffect({
      ...relationshipEffectFields,
      effectType: "relationship_remove",
    });

    const existing = ContentRelationship.create({
      id: "relationship-1",
      projectId,
      relationType: "member_of",
      source: { entityType: "character", entityId: "character-1" },
      target: { entityType: "faction", entityId: "faction-1" },
      createdByUserId: userId,
      now,
    });
    relationships.rows.push(
      ContentRelationship.reconstitute({ ...existing.toSnapshot(), version: 3 }),
    );

    await service.applyEffect(projectId, "effect-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    // The version comes from the row read inside this transaction and is spent
    // inside it — that interleaving is exactly what the guarded delete protects.
    expect(relationships.deleted).toEqual([
      { id: "relationship-1", expectedVersion: 3 },
    ]);
  });

  // The same world-fact as the pre-check below, discovered one step later
  // because the row vanished mid-transaction. One fact, one answer — and the
  // message must not name the transition, which exists.
  it("answers the same 409 when the relationship vanishes mid-delete", async () => {
    seedEffect({
      ...relationshipEffectFields,
      effectType: "relationship_remove",
    });

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-1",
        projectId,
        relationType: "member_of",
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        createdByUserId: userId,
        now,
      }),
    );
    relationships.notFoundOnDelete = true;

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "The relationship this effect would remove does not exist",
    });
  });

  it("answers 409 when the relationship it would remove is not there", async () => {
    seedEffect({
      ...relationshipEffectFields,
      effectType: "relationship_remove",
    });

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  // Discrimination, not just "something was found": two entities can be joined
  // by several relation types at once, and removing the wrong one would be a
  // silent data loss the writer never asked for.
  it("does not remove a row of a different relation type between the same pair", async () => {
    seedEffect({
      ...relationshipEffectFields,
      effectType: "relationship_remove",
    });

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-other",
        projectId,
        relationType: "ally_of",
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        createdByUserId: userId,
        now,
      }),
    );

    await expect(
      service.applyEffect(projectId, "effect-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(relationships.deleted).toEqual([]);
  });
});

describe("applyTransition", () => {
  it("applies every pending effect and leaves the applied ones alone", async () => {
    seedTransition();
    seedEffect();
    seedEffect({
      id: "effect-2",
      ...relationshipEffectFields,
    });
    seedEffect({
      id: "effect-3",
      appliedAt: now,
      contentRevisionId: "rev-old",
    });

    const detail = await service.applyTransition(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(detail.status).toBe("fully_applied");
    expect(effects.updated).toEqual(["effect-1", "effect-2"]);
    expect(effects.rows.get("effect-3")?.contentRevisionId).toBe("rev-old");
    // One content event and one causality event — the already-applied effect
    // must not be re-announced.
    expect(outbox.map((event) => event.eventType)).toEqual([
      "content.updated",
      "narrative.effect.applied",
    ]);
  });

  // All-or-nothing (decision D9). The fake unit of work has no rollback to
  // simulate, so what is asserted is the contract the real one relies on: the
  // failure propagates out of the transaction callback instead of being
  // swallowed into a partial success.
  it("propagates a failing effect instead of reporting partial success", async () => {
    seedTransition();
    seedEffect();
    seedEffect({
      id: "effect-2",
      ...relationshipEffectFields,
      effectType: "relationship_remove",
    });

    await expect(
      service.applyTransition(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it("refuses a reviewer", async () => {
    seedTransition();

    await expect(
      service.applyTransition(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
