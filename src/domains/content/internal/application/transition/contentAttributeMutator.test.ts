import { describe, expect, it } from "vitest";

import {
  createContentAttributeMutator,
  settableDomainFieldsOf,
  type ContentAttributeMutatorDependencies,
} from "./contentAttributeMutator.js";
import { Character } from "../../domain/story/Character.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
} from "../../domain/story/CharacterRepositoryError.js";
import {
  CONTENT_ENTITY_TYPES,
  type ContentEntityType,
  type ContentRevision,
} from "../../domain/support/ContentRevision.js";
import {
  domainAttributeFieldOf,
  writableAttributeFieldsOf,
} from "../../domain/transition/attributeFieldRegistry.js";
import { ContentAttributeConflictError } from "../ports/ContentAttributeMutatorError.js";

import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";

const now = new Date("2026-08-16T00:00:00.000Z");
const later = new Date("2026-08-17T00:00:00.000Z");

const projectId = "project-1";

function buildCharacter(): Character {
  return Character.create({
    id: "character-1",
    projectId,
    createdByUserId: "user-1",
    name: "The Prince",
    archetype: "trickster",
    currentRevisionId: "revision-0",
    now,
  });
}

type Writes = {
  revisions: ContentRevision[];
  updates: Character[];
};

function buildMutator(options: {
  character?: Character | null;
  updateError?: Error;
}) {
  const writes: Writes = { revisions: [], updates: [] };

  const characterRepository = {
    findById: () =>
      Promise.resolve(
        options.character === undefined ? buildCharacter() : options.character,
      ),
    update: (character: Character) => {
      if (options.updateError) {
        return Promise.reject(options.updateError);
      }

      writes.updates.push(character);

      return Promise.resolve();
    },
  } as unknown as CharacterRepository;

  const contentRevisionRepository = {
    insert: (revision: ContentRevision) => {
      writes.revisions.push(revision);

      return Promise.resolve();
    },
  } as unknown as ContentRevisionRepository;

  // Only the character slot is exercised; the other eight are present because
  // the table is keyed by the full union and would not construct without them.
  const dependencies = {
    layerRepository: {},
    worldMapRepository: {},
    worldElementRepository: {},
    factionRepository: {},
    characterRepository,
    eventRepository: {},
    plotRepository: {},
    chapterRepository: {},
    sceneRepository: {},
    contentRevisionRepository,
  } as unknown as ContentAttributeMutatorDependencies;

  return { mutator: createContentAttributeMutator(dependencies), writes };
}

function applyInput(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "character" as ContentEntityType,
    entityId: "character-1",
    domainField: "archetype",
    newValue: "mentor",
    revisionId: "revision-1",
    changedByUserId: "user-2",
    now: later,
    ...overrides,
  };
}

// The half of decision D1 the compiler cannot reach. The registry's RIGHT column
// is checked at build time by the setters' return types; that every field the
// registry ALLOWS actually has a setter is a relationship between two tables,
// and only this can hold it. Without it, a field could pass the allowlist at
// declare time and blow up with a raw 500 at apply time — after the writer
// believed the assertion was accepted.
describe("attribute allowlist vs write dispatch", () => {
  it("has a setter for every writable field of every entity type", () => {
    const missing: string[] = [];

    for (const entityType of CONTENT_ENTITY_TYPES) {
      const settable = settableDomainFieldsOf(entityType);

      for (const fieldPath of writableAttributeFieldsOf(entityType)) {
        const domainField = domainAttributeFieldOf(entityType, fieldPath);

        if (domainField === null || !settable.includes(domainField)) {
          missing.push(`${entityType}.${fieldPath}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  // The reverse direction: a setter nobody can reach is dead weight that reads
  // like a capability. It would also be the shape of a quiet mistake — a field
  // deliberately excluded from the allowlist (`status`, `content`) but still
  // writable here, one line away from being re-enabled by accident.
  it("has no setter for a field the allowlist does not expose", () => {
    const unreachable: string[] = [];

    for (const entityType of CONTENT_ENTITY_TYPES) {
      const exposed = writableAttributeFieldsOf(entityType)
        .map((fieldPath) => domainAttributeFieldOf(entityType, fieldPath))
        .filter((domainField): domainField is string => domainField !== null);

      for (const domainField of settableDomainFieldsOf(entityType)) {
        if (!exposed.includes(domainField)) {
          unreachable.push(`${entityType}.${domainField}`);
        }
      }
    }

    expect(unreachable).toEqual([]);
  });
});

describe("createContentAttributeMutator", () => {
  it("writes the revision before the entity and points the entity at it", async () => {
    const { mutator, writes } = buildMutator({});

    const applied = await mutator.applyAttributeChange(applyInput());

    expect(applied).toEqual({
      projectId,
      revisionNumber: 1,
      changed: true,
    });

    // Order is not cosmetic: `current_revision_id` is an FK to
    // `content_revisions`, so the reverse order fails on the constraint.
    expect(writes.revisions).toHaveLength(1);
    expect(writes.updates).toHaveLength(1);
    expect(writes.updates[0]?.currentRevisionId).toBe("revision-1");
  });

  it("records the actual before and after state, not the declared intent", async () => {
    const { mutator, writes } = buildMutator({});

    await mutator.applyAttributeChange(applyInput());

    const revision = writes.revisions[0];

    expect(revision?.changeType).toBe("update");
    expect(revision?.entityType).toBe("character");
    expect(revision?.changedByUserId).toBe("user-2");
    expect(revision?.beforeSnapshot?.archetype).toBe("trickster");
    expect(revision?.afterSnapshot?.archetype).toBe("mentor");
  });

  it("derives the revision number from the version it read", async () => {
    const character = Character.reconstitute({
      ...buildCharacter().toSnapshot(),
      version: 7,
    });
    const { mutator, writes } = buildMutator({ character });

    const applied = await mutator.applyAttributeChange(applyInput());

    expect(applied?.revisionNumber).toBe(8);
    expect(writes.revisions[0]?.revisionNumber).toBe(8);
  });

  // Decision D5 for attributes. Nothing may be written, because there is no
  // revision for the assertion to point at and an applied attribute change without
  // one is a row the domain refuses to build.
  it("writes nothing when the entity already holds the intended value", async () => {
    const { mutator, writes } = buildMutator({});

    const applied = await mutator.applyAttributeChange(
      applyInput({ newValue: "trickster" }),
    );

    expect(applied?.changed).toBe(false);
    expect(writes.revisions).toEqual([]);
    expect(writes.updates).toEqual([]);
  });

  it("answers null when the target row is gone", async () => {
    const { mutator } = buildMutator({ character: null });

    expect(await mutator.applyAttributeChange(applyInput())).toBeNull();
  });

  // The row vanished between the read and the guarded write. Same 404 as a
  // missing row, deliberately — the caller cannot act on the distinction.
  it("answers null when the entity disappears mid-transaction", async () => {
    const { mutator } = buildMutator({
      updateError: new CharacterRepositoryNotFoundError(),
    });

    expect(await mutator.applyAttributeChange(applyInput())).toBeNull();
  });

  // Nine per-entity conflict errors collapse into one the service understands.
  it("translates a version conflict into one conflict error", async () => {
    const { mutator } = buildMutator({
      updateError: new CharacterRepositoryConflictError(),
    });

    await expect(
      mutator.applyAttributeChange(applyInput()),
    ).rejects.toBeInstanceOf(ContentAttributeConflictError);
  });

  it("lets the target aggregate refuse a value it does not accept", async () => {
    const { mutator, writes } = buildMutator({});

    await expect(
      mutator.applyAttributeChange(
        applyInput({ domainField: "name", newValue: "   " }),
      ),
    ).rejects.toThrow();

    expect(writes.revisions).toEqual([]);
  });

  // A wiring bug, not a user error: the caller resolved this name through the
  // registry, so reaching it means the two tables disagree — which is exactly
  // what the coverage test above prevents.
  it("refuses a domain field it has no setter for", async () => {
    const { mutator } = buildMutator({});

    await expect(
      mutator.applyAttributeChange(applyInput({ domainField: "status" })),
    ).rejects.toThrow(/No attribute setter for character.status/);
  });
});
