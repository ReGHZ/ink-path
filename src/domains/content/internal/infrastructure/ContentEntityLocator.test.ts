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

// Which column each aggregate's display name actually lives in. Six types call
// it `name`, three call it `title`, and `locate()` now has to reach the right
// one per type (7.4b: the delete guard's 409 names the blocking entities). A
// descriptor reading `.name` off a chapter compiles fine and answers
// `undefined` — only a stub that carries ONLY the correct column can refuse it.
const NAME_COLUMN_BY_ENTITY_TYPE: Readonly<
  Record<ContentEntityType, "name" | "title">
> = {
  layer: "name",
  map: "name",
  world_element: "name",
  faction: "name",
  character: "name",
  event: "title",
  plot: "name",
  chapter: "title",
  scene: "title",
};

function nameFor(entityType: ContentEntityType): string {
  return `${entityType} display name`;
}

function stubRepository(
  entityType: ContentEntityType,
  projectId: string | undefined,
) {
  return {
    findById: () =>
      Promise.resolve(
        projectId === undefined
          ? null
          : {
            projectId,
            [NAME_COLUMN_BY_ENTITY_TYPE[entityType]]: nameFor(entityType),
          },
      ),
  };
}

function buildLocator(
  projectByEntityType: Partial<Record<ContentEntityType, string>>,
): ContentEntityLocator {
  // One cast for the whole table rather than nine: each field wants a different
  // repository interface, and the stub deliberately implements only the single
  // method the descriptor calls.
  const dependencies = {
    layerRepository: stubRepository("layer", projectByEntityType.layer),
    worldMapRepository: stubRepository("map", projectByEntityType.map),
    worldElementRepository: stubRepository(
      "world_element",
      projectByEntityType.world_element,
    ),
    factionRepository: stubRepository("faction", projectByEntityType.faction),
    characterRepository: stubRepository(
      "character",
      projectByEntityType.character,
    ),
    eventRepository: stubRepository("event", projectByEntityType.event),
    plotRepository: stubRepository("plot", projectByEntityType.plot),
    chapterRepository: stubRepository("chapter", projectByEntityType.chapter),
    sceneRepository: stubRepository("scene", projectByEntityType.scene),
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

  // The other half of the same dispatch, and the one 7.4b depends on: the 409
  // that refuses a delete names the blocking entities, so a chapter whose name
  // is read from the wrong column would answer "undefined" in a user-facing
  // message. Asserted for all nine at once because the failure is per-type.
  it("reports each entity type's display name from its own column", async () => {
    const locator = buildLocator(PROJECT_BY_ENTITY_TYPE);
    const mismatches: string[] = [];

    for (const entityType of ALL_ENTITY_TYPES) {
      const location = await locator.locate({
        entityType,
        entityId: `${entityType}-1`,
      });

      if (location?.entityName !== nameFor(entityType)) {
        mismatches.push(
          `${entityType}: expected ${nameFor(entityType)}, got ${String(location?.entityName)}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  // Scene is the only type whose title is nullable
  // (`prisma/content-story.prisma:169`). The descriptor turns that into "", and
  // the delete guard must be able to tell "" apart from "could not be resolved"
  // — the latter is `null`, and only that one means an orphan row.
  it("reports an untitled scene as an empty name, not as an unresolved entity", async () => {
    const dependencies = {
      sceneRepository: {
        findById: () =>
          Promise.resolve({ projectId: "project-scene", title: null }),
      },
    } as unknown as ContentEntityRepositories;

    const location = await createContentEntityLocator(dependencies).locate({
      entityType: "scene",
      entityId: "scene-1",
    });

    expect(location).toEqual({ projectId: "project-scene", entityName: "" });
  });

  // The port promises a project id and a display name, and nothing else. If the
  // aggregate itself leaked through, callers would start reading fields off it
  // and the narrow port would quietly become a second reader.
  it("exposes the project id and the name alone, not the aggregate", async () => {
    const locator = buildLocator(PROJECT_BY_ENTITY_TYPE);

    const location = await locator.locate({
      entityType: "character",
      entityId: "character-1",
    });

    expect(Object.keys(location ?? {})).toEqual(["projectId", "entityName"]);
  });
});
