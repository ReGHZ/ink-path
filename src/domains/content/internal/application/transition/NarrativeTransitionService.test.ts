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
  SEEDED_DEFINITIONS,
  seededDefinition,
} from "../../domain/support/relationshipDefinitionSeed.js";
import {
  Assertion,
  type AssertionProperties,
} from "../../domain/transition/Assertion.js";
import {
  NarrativeTransition,
  type NarrativeTransitionProperties,
} from "../../domain/transition/NarrativeTransition.js";

import type { OutboxEvent } from "../../../../../shared/application/ports/OutboxEventRepository.js";
import type { ProjectMembership } from "../../../../../shared/application/ports/ProjectMembership.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type {
  AssertionClaim,
  AssertionDeletion,
  AssertionRepository,
} from "../../domain/transition/AssertionRepository.js";
import type { NarrativeTransitionRepository } from "../../domain/transition/NarrativeTransitionRepository.js";
import type {
  AppliedAttributeChange,
  ApplyAttributeChangeInput,
  ContentAttributeMutator,
} from "../ports/ContentAttributeMutator.js";
import type { ContentEntityLocator } from "../ports/ContentEntityLocator.js";
import type { NarrativeTransitionUnitOfWork } from "../ports/NarrativeTransitionUnitOfWork.js";
import type { RelationshipDefinitionReader } from "../ports/RelationshipDefinitionReader.js";

// The seeded vocabulary — what a project has from creation. An unknown
// predicate answers null here exactly as the database does.
const seededDefinitionReader: RelationshipDefinitionReader = {
  findByPredicate: (_projectId: string, predicate: string) =>
    Promise.resolve(SEEDED_DEFINITIONS.get(predicate) ?? null),
  findAllByProject: () => Promise.resolve(SEEDED_DEFINITIONS),
};

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

class FakeAssertionRepository implements AssertionRepository {
  rows = new Map<string, AssertionProperties>();
  claimed: string[] = [];
  updated: string[] = [];
  deleted: string[] = [];

  save(assertion: Assertion): void {
    this.rows.set(assertion.id, assertion.toSnapshot());
  }

  findById(id: string): Promise<Assertion | null> {
    const row = this.rows.get(id);

    return Promise.resolve(
      row ? Assertion.reconstitute({ ...row }) : null,
    );
  }

  // Unnarrowed twin of findById, and project-scoped like the adapter: a row from
  // another project must answer null rather than being compared afterwards.
  findAssertionById(
    projectId: string,
    id: string,
  ): Promise<Assertion | null> {
    const row = this.rows.get(id);

    return Promise.resolve(
      row?.projectId === projectId
        ? Assertion.reconstitute({ ...row })
        : null,
    );
  }

  // Step 4b-5. Models the ADAPTER's contract, not a convenience: the claim is
  // refused when `applied_at` is already set, and the assertion handed back on
  // success is the PRE-CLAIM aggregate — so the service still walks
  // `markApplied()` and a test can still see it do so.
  claimForApply(
    projectId: string,
    id: string,
    now: Date,
  ): Promise<AssertionClaim> {
    this.claimed.push(id);

    const row = this.rows.get(id);

    if (row?.projectId !== projectId) {
      return Promise.resolve({ status: "missing" });
    }

    if (row.appliedAt !== null) {
      return Promise.resolve({
        status: "already-applied",
        assertion: Assertion.reconstitute({ ...row }),
      });
    }

    this.rows.set(id, { ...row, appliedAt: now });

    return Promise.resolve({
      status: "claimed",
      assertion: Assertion.reconstitute({
        ...row,
        appliedAt: null,
        contentRevisionId: null,
      }),
    });
  }

  deleteIfPending(
    projectId: string,
    id: string,
  ): Promise<AssertionDeletion> {
    const row = this.rows.get(id);

    if (row?.projectId !== projectId) {
      return Promise.resolve("missing");
    }

    if (row.appliedAt !== null) {
      return Promise.resolve("applied");
    }

    this.deleted.push(id);
    this.rows.delete(id);

    return Promise.resolve("deleted");
  }

  findByTransitionId(transitionId: string): Promise<Assertion[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.narrativeTransitionId === transitionId)
        .map((row) => Assertion.reconstitute({ ...row })),
    );
  }

  insert(assertion: Assertion): Promise<void> {
    this.save(assertion);

    return Promise.resolve();
  }

  update(assertion: Assertion): Promise<void> {
    this.updated.push(assertion.id);
    this.save(assertion);

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
let assertions: FakeAssertionRepository;
let relationships: FakeContentRelationshipRepository;
let mutator: FakeContentAttributeMutator;
let outbox: OutboxEvent[];
let locations: Map<string, string>;
let generated: number;
let clockReads: number;
let service: NarrativeTransitionService;

function locate(entityType: ContentEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

beforeEach(() => {
  clockReads = 0;
  transitions = new FakeNarrativeTransitionRepository();
  assertions = new FakeAssertionRepository();
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
    // Rollback, modelled — and since step 4b-5 that is load-bearing rather than
    // fidelity for its own sake: the apply path now WRITES before it can fail
    // (the claim lands first), so a fake that kept those writes after a throw
    // would let "writes nothing" assertions pass while the row had in fact
    // changed. The real unit of work rolls back; a fake that does not is a
    // control that reports the wrong colour.
    transaction: async (work) => {
      const effectRows = new Map(assertions.rows);
      const transitionRows = new Map(transitions.rows);
      const relationshipRows = [...relationships.rows];
      const outboxLength = outbox.length;

      try {
        return await work(
          {
            narrativeTransitions: transitions,
            assertions,
            contentRelationships: relationships,
            contentAttributes: mutator,
          },
          {
            insert: (event) => {
              outbox.push(event);

              return Promise.resolve();
            },
          },
        );
      } catch (error) {
        assertions.rows = effectRows;
        transitions.rows = transitionRows;
        relationships.rows = relationshipRows;
        outbox.length = outboxLength;

        throw error;
      }
    },
  };

  service = new NarrativeTransitionService(
    // ADVANCING, not constant — the penjaga `const now` owed since G1-P (P-3).
    // A constant clock cannot tell one clock read from two: both stamp the same
    // instant, so an apply that read the clock twice was indistinguishable from
    // one that read it once, and "one clock read per action" was a claim with no
    // test behind it. Here every call returns a later instant, so a second read
    // leaves a DIFFERENT timestamp on the row than on its revision.
    //
    // `later` stays the FIRST value, so every existing assertion expecting
    // `later` keeps its meaning and gains one: that the value came from the
    // action's first and only clock read.
    {
      now: () => {
        const reading = new Date(later.getTime() + clockReads * 1000);

        clockReads += 1;

        return reading;
      },
    },
    {
      generate: () => {
        generated += 1;

        return `generated-${String(generated)}`;
      },
    },
    transitions,
    assertions,
    locator,
    unitOfWork,
    seededDefinitionReader,
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

function seedAssertion(
  overrides: Partial<AssertionProperties> = {},
): Assertion {
  const assertion = Assertion.reconstitute({
    id: "assertion-1",
    narrativeTransitionId: "transition-1",
    projectId,
    operation: "attribute_change",
    targetEntityType: "character",
    targetEntityId: "character-1",
    fieldPath: "archetype",
    newValue: "mentor",
    relationshipType: null,
    relationshipDefinitionId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    anchorEntityType: null,
    anchorEntityId: null,
    targetAssertionId: null,
    targetOperation: null,
    appliedAt: null,
    contentRevisionId: null,
    createdAt: now,
    ...overrides,
  });

  assertions.save(assertion);

  return assertion;
}

// The FACT a `relationship_remove` ends. Since step 4b-3 the remove path reads it —
// applying the removal writes a `terminate` naming this row — so a fixture with a
// projection but no origin assertion is a state the database's foreign key would not
// allow either.
function seedOriginAssertion(
  overrides: Partial<AssertionProperties> = {},
): Assertion {
  return seedAssertion({
    id: "origin-assertion-1",
    operation: "relationship_add",
    fieldPath: null,
    newValue: null,
    relationshipType: "member_of",
    // The REAL definition id, not the placeholder `relationshipEffectFields` uses for
    // declared rows: a termination matches its target's predicate by row when the
    // target names one (`Assertion.terminateFact`), so a fixture with a made-up
    // id would fail for a reason that has nothing to do with the case under test.
    relationshipDefinitionId: seededDefinition("member_of").id,
    relatedEntityType: "faction",
    relatedEntityId: "faction-1",
    appliedAt: now,
    ...overrides,
  });
}

const relationshipEffectFields = {
  operation: "relationship_add" as const,
  fieldPath: null,
  newValue: null,
  relationshipType: "member_of",
  relationshipDefinitionId: "def-member_of",
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

  it("stores a declared transition with no assertions", async () => {
    const detail = await service.declareTransition({
      requestingUserId: userId,
      requestingMembership: writer,
      projectId,
      sourceEntityType: "scene",
      sourceEntityId: "scene-1",
      title: "  Raja Terbunuh  ",
    });

    expect(detail.status).toBe("declared");
    expect(detail.assertions).toEqual([]);
    expect(detail.title).toBe("Raja Terbunuh");
    expect(transitions.rows.size).toBe(1);
  });

  // Flow 10 §Declare step 6: reversing a transition that never happened records
  // the undoing of nothing.
  it("refuses to reverse a transition that is only declared", async () => {
    seedTransition();
    seedAssertion();

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
    seedAssertion();
    seedAssertion({ id: "assertion-2", appliedAt: later, contentRevisionId: "rev-1" });

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

  it("derives the status from the assertions it loads", async () => {
    seedTransition();
    seedAssertion();
    seedAssertion({ id: "assertion-2", appliedAt: later, contentRevisionId: "rev-1" });

    const detail = await service.getTransitionById(projectId, "transition-1");

    expect(detail.status).toBe("partially_applied");
    expect(detail.assertions).toHaveLength(2);
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
    seedAssertion();

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
    expect(detail.assertions).toHaveLength(1);
  });
});

describe("list endpoints", () => {
  it("returns only this project's transitions, each with its derived status", async () => {
    seedTransition();
    seedAssertion({ appliedAt: later, contentRevisionId: "rev-1" });
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

describe("addAssertion", () => {
  beforeEach(() => {
    seedTransition();
  });

  // The aggregate-root lock. Without it, `deleteTransition` cannot trust that the
  // set of children it inspected is the set its blanket delete removes — a child
  // inserted in that window could be applied by a third request and then
  // destroyed as an applied fact.
  // Step 4b-5 removed the aggregate-root lock this used to assert, and the port
  // no longer has the method — so what is left to pin here is that the child does
  // get inserted. What used to be claimed for the lock is now held by the FK and
  // by the INSERT's own key-share lock on the parent row, neither of which a fake
  // can observe; the invariant itself lives in the three-party integration test
  // (`test/integration/apply-delete-serialization.integration.test.ts`, T7). This
  // unit suite never bound it — mutant M2 proved that by surviving.
  it("inserts the child after reading its parent", async () => {
    await service.addAssertion(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
      operation: "attribute_change",
      targetEntityType: "character",
      targetEntityId: "character-1",
      fieldPath: "archetype",
      newValue: "mentor",
    });

    expect(assertions.rows.size).toBe(1);
  });

  it("refuses a reviewer", async () => {
    await expect(
      service.addAssertion(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
        operation: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it("answers 404 for an unknown target entity", async () => {
    await expect(
      service.addAssertion(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        operation: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-missing",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("answers 404 for an unknown related entity", async () => {
    await expect(
      service.addAssertion(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        operation: "relationship_add",
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
      service.addAssertion(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        operation: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "status",
        newValue: "archived",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("stores a pending assertion", async () => {
    const detail = await service.addAssertion(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
      operation: "attribute_change",
      targetEntityType: "character",
      targetEntityId: "character-1",
      fieldPath: "archetype",
      newValue: "mentor",
    });

    expect(detail.appliedAt).toBeNull();
    expect(detail.narrativeTransitionId).toBe("transition-1");
    expect(assertions.rows.size).toBe(1);
  });

  it("answers 404 when the transition belongs to another project", async () => {
    transitions.rows.clear();
    seedTransition({ projectId: otherProjectId });

    await expect(
      service.addAssertion(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
        operation: "attribute_change",
        targetEntityType: "character",
        targetEntityId: "character-1",
        fieldPath: "archetype",
        newValue: "mentor",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("deleteAssertion", () => {
  it("refuses to delete an applied assertion", async () => {
    seedTransition();
    seedAssertion({ appliedAt: later, contentRevisionId: "rev-1" });

    await expect(
      service.deleteAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(assertions.deleted).toEqual([]);
  });

  // The guard reads the row under a lock, not with a plain SELECT: a concurrent
  // apply must not be able to commit between the check and the delete.
  // Step 4b-5: one predicate-carrying statement instead of lock-then-check, so
  // the guard cannot be separated from the delete even in principle. The 409 twin
  // below is what proves the predicate is there.
  it("removes a pending assertion with a single guarded statement", async () => {
    seedTransition();
    seedAssertion();

    await service.deleteAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(assertions.deleted).toEqual(["assertion-1"]);
  });

  it("answers 404 for an assertion in another project", async () => {
    seedTransition();
    seedAssertion({ projectId: otherProjectId });

    await expect(
      service.deleteAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("deleteTransition", () => {
  it("refuses when any assertion is applied, and deletes nothing", async () => {
    seedTransition();
    seedAssertion();
    seedAssertion({ id: "assertion-2", appliedAt: later, contentRevisionId: "rev-1" });

    await expect(
      service.deleteTransition(projectId, "transition-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    // Asserted as STATE, not as a call log: since step 4b-5 the pending sibling
    // IS deleted before the applied one is reached, and what makes "deletes
    // nothing" true is the rollback that follows the 409 — which a call log
    // cannot see and a row count can.
    expect(assertions.rows.size).toBe(2);
    expect(transitions.deleted).toEqual([]);
  });

  it("deletes children before the parent when everything is pending", async () => {
    seedTransition();
    seedAssertion();
    seedAssertion({ id: "assertion-2" });

    await service.deleteTransition(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    // Step 4b-5: every child removed by its OWN guarded statement, in the list's
    // order, then the parent. The order is the property, not a side effect —
    // bulk apply claims rows in exactly this sequence, so the two paths take row
    // locks in the same order and cannot deadlock. The blanket
    // `deleteByTransitionId` was removed from the port rather than merely left
    // unused: it locks in scan order, so reintroducing it has to be a visible
    // act rather than a convenient call.
    expect(assertions.deleted).toEqual(["assertion-1", "assertion-2"]);
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

describe("applyAssertion — attribute_change", () => {
  beforeEach(() => {
    seedTransition();
    seedAssertion();
  });

  it("resolves the wire field name to the aggregate property before writing", async () => {
    await service.applyAssertion(projectId, "assertion-1", {
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

  it("stamps the assertion with the revision the mutation produced", async () => {
    const detail = await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    const revisionId = mutator.calls[0]?.revisionId;

    expect(detail.appliedAt).toEqual(later);
    expect(detail.contentRevisionId).toBe(revisionId);
    // Persisted, not merely mutated in memory: the fake reconstitutes on read,
    // so a missing `update()` call would leave the stored row pending.
    expect(assertions.updated).toEqual(["assertion-1"]);
    expect(assertions.rows.get("assertion-1")?.appliedAt).toEqual(later);
  });

  it("emits the existing content event so the embedding worker sees it", async () => {
    await service.applyAssertion(projectId, "assertion-1", {
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

  // The penjaga `const now` itself (G1-P syarat P-3). One action, ONE clock read:
  // the instant that stamps `applied_at` must be the same instant the entity
  // mutation and its revision carry, or an apply can straddle a tick and produce a
  // fact whose provenance is dated after the fact itself.
  //
  // Asserted two ways on purpose. The COUNT catches a second read even when both
  // readings happen to be equal; the EQUALITY catches a second read whose value
  // reached a different column. Either alone would leave a hole the other closes.
  it("reads the clock exactly once per apply, and stamps that one instant everywhere", async () => {
    await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(clockReads).toBe(1);

    const stamped = assertions.rows.get("assertion-1")?.appliedAt;

    expect(stamped).toEqual(later);
    expect(mutator.calls[0]?.now).toEqual(stamped);
  });

  // Step 4b-5: the claim is the first statement, and "first" is the invariant —
  // the entity must not be touched by a caller that did not win the claim.
  // Asserted in both directions: the winner claims and then mutates, and the
  // loser (below, already-applied) never reaches the mutator at all.
  it("claims the assertion before touching the entity", async () => {
    await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(assertions.claimed).toEqual(["assertion-1"]);
    expect(mutator.calls).toHaveLength(1);
  });

  // Decision D5 for attributes: the world already holds the intended value.
  it("answers 409 and writes nothing when the value is already in place", async () => {
    mutator.result = { projectId, revisionNumber: 4, changed: false };

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(outbox).toEqual([]);
    expect(assertions.rows.get("assertion-1")?.appliedAt).toBeNull();
  });

  it("answers 404 when the target entity is gone", async () => {
    mutator.result = null;

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  // Idempotent, not a conflict: the caller asked for a state that holds. What
  // must not happen is a second ContentRevision.
  it("is a no-op when the assertion is already applied", async () => {
    seedAssertion({ appliedAt: later, contentRevisionId: "rev-1" });

    const detail = await service.applyAssertion(projectId, "assertion-1", {
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
    seedAssertion({ fieldPath: "status" });

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(mutator.calls).toEqual([]);
  });

  it("refuses a reviewer", async () => {
    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: reviewer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });
});

describe("applyAssertion — relationship assertions", () => {
  beforeEach(() => {
    seedTransition();
  });

  it("writes the relationship through the domain, canonicalising the endpoints", async () => {
    // Declared faction-first with a NON-directional type: the stored row must
    // come back character-first, because canonical orientation is the row's
    // identity and this path must produce the same row the manual endpoint does.
    seedAssertion({
      ...relationshipEffectFields,
      relationshipType: "ally_of",
      relationshipDefinitionId: "def-ally_of",
      targetEntityType: "faction",
      targetEntityId: "faction-1",
      relatedEntityType: "character",
      relatedEntityId: "character-1",
    });

    await service.applyAssertion(projectId, "assertion-1", {
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
    seedAssertion(relationshipEffectFields);

    const detail = await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(detail.appliedAt).toEqual(later);
    expect(detail.contentRevisionId).toBeNull();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      eventType: "narrative.assertion.applied",
      aggregateType: "narrative_transition",
      aggregateId: "transition-1",
      routingKey: "narrative.assertion.applied",
      payload: {
        effectId: "assertion-1",
        operation: "relationship_add",
        relationshipType: "member_of",
      },
    });
  });

  // Decision D5: the link exists already, created by hand. Marking the assertion
  // applied would attribute someone else's edit to this transition.
  it("answers 409 when the relationship it would add already exists", async () => {
    seedAssertion(relationshipEffectFields);
    relationships.duplicateOnInsert = true;

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(assertions.rows.get("assertion-1")?.appliedAt).toBeNull();
    expect(outbox).toEqual([]);
  });

  it("removes the row that matches the assertion's natural identity", async () => {
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });
    seedOriginAssertion();

    const existing = ContentRelationship.create({
      id: "relationship-1",
      projectId,
      relationType: "member_of",
      definition: seededDefinition("member_of"),
      source: { entityType: "character", entityId: "character-1" },
      target: { entityType: "faction", entityId: "faction-1" },
      sourceAssertionId: "origin-assertion-1",
      createdByUserId: userId,
      now,
    });
    relationships.rows.push(
      ContentRelationship.reconstitute({ ...existing.toSnapshot(), version: 3 }),
    );

    await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    // The version comes from the row read inside this transaction and is spent
    // inside it — that interleaving is exactly what the guarded delete protects.
    expect(relationships.deleted).toEqual([
      { id: "relationship-1", expectedVersion: 3 },
    ]);
  });

  // ── STEP 4b-3 ───────────────────────────────────────────────────────────────
  // Before this, applying a removal deleted the projection row and wrote NOTHING to
  // the log: the `relationship_add` stayed applied and unwithdrawn while its fold
  // vanished, so rebuilding the projection from the log would resurrect the
  // relationship (gerbang G1, T-6). These are the claims that close that window.
  it("writes a terminate that names the assertion it ends and the story moment it ends at", async () => {
    seedTransition({ sourceEntityType: "scene", sourceEntityId: "scene-7" });
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });
    const origin = seedOriginAssertion();

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-1",
        projectId,
        relationType: "member_of",
        definition: seededDefinition("member_of"),
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        sourceAssertionId: origin.id,
        createdByUserId: userId,
        now,
      }),
    );

    await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    const written = [...assertions.rows.values()].filter(
      (row) => row.operation === "terminate",
    );

    expect(written).toHaveLength(1);
    const [termination] = written;

    expect(termination?.id).toBeDefined();

    // `terminate`, NOT `retract`: a narrated removal means the fact stopped holding
    // at a point in the story, not that it was never true (premis §8.3).
    expect(termination?.targetAssertionId).toBe("origin-assertion-1");
    expect(termination?.targetOperation).toBe("relationship_add");
    // VALID time, taken from the parent transition's source entity — the beat the
    // author declared this removal on. This is the assertion that would fail if the
    // anchor were left null to "keep it simple".
    expect(termination?.anchorEntityType).toBe("scene");
    expect(termination?.anchorEntityId).toBe("scene-7");
    expect(termination?.narrativeTransitionId).toBe("transition-1");
    // APPLY time, not the declared row's creation time: `later` is what the service
    // clock returns, and one apply is one instant for every row it writes.
    expect(termination?.appliedAt).toEqual(later);
    expect(termination?.createdAt).toEqual(later);

    // The claim SURVIVES, untouched — that is what makes this a log and not a
    // mutation. Asserting it here catches a future edit that "cleans up" the
    // assertion along with the projection.
    expect(assertions.rows.get("origin-assertion-1")?.operation).toBe("relationship_add");
    expect(assertions.rows.get("origin-assertion-1")?.appliedAt).toEqual(now);
    // And the fold is gone, so the CRUD surface stops showing it.
    expect(relationships.deleted).toEqual([
      { id: "relationship-1", expectedVersion: 0 },
    ]);

    // F-1 (gerbang 4b-3): the causality event reports the row WRITTEN, not just the
    // intent declared. Without this the event says `relationship_remove` and a
    // consumer cannot learn the `terminate` row exists — nor the story moment it
    // carries, which is the only "when" a valid-time fold has.
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.payload).toMatchObject({
      operation: "relationship_remove",
      terminationId: termination?.id,
      targetAssertionId: "origin-assertion-1",
      anchorEntityType: "scene",
      anchorEntityId: "scene-7",
      assertionId: null,
    });
  });

  // THE CROSS-PATH DIRECTION (A-3, decided 2026-08-19): a narrative removal may end
  // a fact the CRUD endpoint asserted. Its origin assertion is PARENTLESS, which is
  // the shape `findById` cannot see — so this also pins that the remove path reads
  // the log unnarrowed.
  it("terminates a fact that CRUD asserted, not only one a transition wrote", async () => {
    seedTransition({ sourceEntityType: "chapter", sourceEntityId: "chapter-3" });
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });
    seedOriginAssertion({ narrativeTransitionId: null });

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-1",
        projectId,
        relationType: "member_of",
        definition: seededDefinition("member_of"),
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        sourceAssertionId: "origin-assertion-1",
        createdByUserId: userId,
        now,
      }),
    );

    await service.applyAssertion(projectId, "assertion-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    const termination = [...assertions.rows.values()].find(
      (row) => row.operation === "terminate",
    );

    expect(termination?.targetAssertionId).toBe("origin-assertion-1");
    // The termination belongs to the transition that narrated it, even though the
    // fact it ends belongs to no transition at all.
    expect(termination?.narrativeTransitionId).toBe("transition-1");
    expect(termination?.anchorEntityId).toBe("chapter-3");
  });

  // The same world-fact as the pre-check below, discovered one step later
  // because the row vanished mid-transaction. One fact, one answer — and the
  // message must not name the transition, which exists.
  it("answers the same 409 when the relationship vanishes mid-delete", async () => {
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });
    seedOriginAssertion();

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-1",
        projectId,
        relationType: "member_of",
        definition: seededDefinition("member_of"),
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        sourceAssertionId: "origin-assertion-1",
        createdByUserId: userId,
        now,
      }),
    );
    relationships.notFoundOnDelete = true;

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
      message: "The relationship this assertion would remove does not exist",
    });
  });

  it("answers 409 when the relationship it would remove is not there", async () => {
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  // Discrimination, not just "something was found": two entities can be joined
  // by several relation types at once, and removing the wrong one would be a
  // silent data loss the writer never asked for.
  it("does not remove a row of a different relation type between the same pair", async () => {
    seedAssertion({
      ...relationshipEffectFields,
      operation: "relationship_remove",
    });

    relationships.rows.push(
      ContentRelationship.create({
        id: "relationship-other",
        projectId,
        relationType: "ally_of",
        definition: seededDefinition("ally_of"),
        source: { entityType: "character", entityId: "character-1" },
        target: { entityType: "faction", entityId: "faction-1" },
        sourceAssertionId: "origin-assertion-1",
        createdByUserId: userId,
        now,
      }),
    );

    await expect(
      service.applyAssertion(projectId, "assertion-1", {
        requestingUserId: userId,
        requestingMembership: writer,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    expect(relationships.deleted).toEqual([]);
  });
});

describe("applyTransition", () => {
  it("applies every pending assertion and leaves the applied ones alone", async () => {
    seedTransition();
    seedAssertion();
    seedAssertion({
      id: "assertion-2",
      ...relationshipEffectFields,
    });
    seedAssertion({
      id: "assertion-3",
      appliedAt: now,
      contentRevisionId: "rev-old",
    });

    const detail = await service.applyTransition(projectId, "transition-1", {
      requestingUserId: userId,
      requestingMembership: writer,
    });

    expect(detail.status).toBe("fully_applied");
    expect(assertions.updated).toEqual(["assertion-1", "assertion-2"]);
    expect(assertions.rows.get("assertion-3")?.contentRevisionId).toBe("rev-old");
    // One content event and one causality event — the already-applied assertion
    // must not be re-announced.
    expect(outbox.map((event) => event.eventType)).toEqual([
      "content.updated",
      "narrative.assertion.applied",
    ]);
  });

  // All-or-nothing (decision D9). The fake unit of work has no rollback to
  // simulate, so what is asserted is the contract the real one relies on: the
  // failure propagates out of the transaction callback instead of being
  // swallowed into a partial success.
  it("propagates a failing assertion instead of reporting partial success", async () => {
    seedTransition();
    seedAssertion();
    seedAssertion({
      id: "assertion-2",
      ...relationshipEffectFields,
      operation: "relationship_remove",
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
