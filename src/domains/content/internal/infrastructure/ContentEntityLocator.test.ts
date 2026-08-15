import { describe, expect, it } from "vitest";

import { createContentEntityLocator } from "./ContentEntityLocator.js";

import type { ContentEntityRepositories } from "./ContentEntityDescriptors.js";
import type { ContentEntityLocator } from "../application/ports/ContentEntityLocator.js";
import type { ContentEntityType } from "../domain/support/ContentRevision.js";

// The locate half of the descriptor table had no test of its own at the 7.2
// gate: mutating it to report a constant project left all 1441 tests green,
// because RelationshipService's tests drive a FakeContentEntityLocator. That
// left the ONE seam where tenant isolation is decided on the write path
// (`RelationshipService.assertEntityInProject`) resting on a fake.
//
// Each entity type is therefore given a DIFFERENT project id. That single
// arrangement refuses three separate mistakes at once: a hard-coded answer, a
// descriptor wired to the wrong repository (character reading the faction repo
// would report `project-faction`), and a type missing from the table.
//
// The stubs return the minimum `locate()` reads — a `projectId` — rather than
// full aggregates. That is not a shortcut around the contract: extracting
// indexable FIELDS is the reader's half, and it already has its own test over
// all nine types (`ContentEntityReader.test.ts`). What is unproven here, and
// only here, is dispatch plus project extraction.
const PROJECT_BY_ENTITY_TYPE: Readonly<Record<ContentEntityType, string>> = {
  layer: "project-layer",
  map: "project-map",
  world_element: "project-world-element",
  faction: "project-faction",
  character: "project-character",
  event: "project-event",
  plot: "project-plot",
  chapter: "project-chapter",
  scene: "project-scene",
};

const ALL_ENTITY_TYPES = Object.keys(
  PROJECT_BY_ENTITY_TYPE,
) as ContentEntityType[];

function stubRepository(projectId: string | undefined) {
  return {
    findById: () =>
      Promise.resolve(projectId === undefined ? null : { projectId }),
  };
}

function buildLocator(
  projectByEntityType: Partial<Record<ContentEntityType, string>>,
): ContentEntityLocator {
  // One cast for the whole table rather than nine: each field wants a different
  // repository interface, and the stub deliberately implements only the single
  // method the descriptor calls.
  const dependencies = {
    layerRepository: stubRepository(projectByEntityType.layer),
    worldMapRepository: stubRepository(projectByEntityType.map),
    worldElementRepository: stubRepository(projectByEntityType.world_element),
    factionRepository: stubRepository(projectByEntityType.faction),
    characterRepository: stubRepository(projectByEntityType.character),
    eventRepository: stubRepository(projectByEntityType.event),
    plotRepository: stubRepository(projectByEntityType.plot),
    chapterRepository: stubRepository(projectByEntityType.chapter),
    sceneRepository: stubRepository(projectByEntityType.scene),
  } as unknown as ContentEntityRepositories;

  return createContentEntityLocator(dependencies);
}

describe("createContentEntityLocator", () => {
  it("answers each of the nine entity types from its own repository", async () => {
    const locator = buildLocator(PROJECT_BY_ENTITY_TYPE);
    const mismatches: string[] = [];

    for (const entityType of ALL_ENTITY_TYPES) {
      const location = await locator.locate({
        entityType,
        entityId: `${entityType}-1`,
      });

      const expected = PROJECT_BY_ENTITY_TYPE[entityType];

      if (location?.projectId !== expected) {
        mismatches.push(
          `${entityType}: expected ${expected}, got ${String(location?.projectId)}`,
        );
      }
    }

    // Collected and asserted once so a failure names every entity type that
    // drifted, not just the first.
    expect(mismatches).toEqual([]);
  });

  // `null` is what the service turns into 404, and it must be reachable for
  // every type — a descriptor that threw or returned a stale object instead
  // would turn a missing entity into a 500.
  it("answers null for every entity type when the row does not exist", async () => {
    const locator = buildLocator({});
    const unexpected: string[] = [];

    for (const entityType of ALL_ENTITY_TYPES) {
      const location = await locator.locate({
        entityType,
        entityId: "missing",
      });

      if (location !== null) {
        unexpected.push(`${entityType}: ${JSON.stringify(location)}`);
      }
    }

    expect(unexpected).toEqual([]);
  });

  // The port promises a project id and nothing else. If the aggregate itself
  // leaked through, callers would start reading fields off it and the narrow
  // port would quietly become a second reader.
  it("exposes the project id alone, not the aggregate", async () => {
    const locator = buildLocator(PROJECT_BY_ENTITY_TYPE);

    const location = await locator.locate({
      entityType: "character",
      entityId: "character-1",
    });

    expect(Object.keys(location ?? {})).toEqual(["projectId"]);
  });
});
