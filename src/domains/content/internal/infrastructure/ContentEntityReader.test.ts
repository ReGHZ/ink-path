import { describe, expect, it } from "vitest";

import { createContentEntityReader } from "./ContentEntityReader.js";
import { Character } from "../domain/story/Character.js";
import { Faction } from "../domain/story/Faction.js";
import { Layer } from "../domain/world/Layer.js";
import { WorldElement } from "../domain/world/WorldElement.js";
import { WorldMap } from "../domain/world/WorldMap.js";

import type { CharacterRepository } from "../domain/story/CharacterRepository.js";
import type { FactionRepository } from "../domain/story/FactionRepository.js";
import type { LayerRepository } from "../domain/world/LayerRepository.js";
import type { WorldElementRepository } from "../domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "../domain/world/WorldMapRepository.js";

// Every dependency is a hand-written stub, not Prisma/Postgres — proving the
// standard mentor set for this port: worker logic (and this reader itself)
// must be testable without a real database.
const NOW = new Date("2026-01-01T00:00:00Z");

function stubLayerRepository(layer: Layer | null): LayerRepository {
  return {
    findById: () => Promise.resolve(layer),
  } as unknown as LayerRepository;
}

function stubWorldMapRepository(worldMap: WorldMap | null): WorldMapRepository {
  return {
    findById: () => Promise.resolve(worldMap),
  } as unknown as WorldMapRepository;
}

function stubWorldElementRepository(
  worldElement: WorldElement | null,
): WorldElementRepository {
  return {
    findById: () => Promise.resolve(worldElement),
  } as unknown as WorldElementRepository;
}

function stubFactionRepository(faction: Faction | null): FactionRepository {
  return {
    findById: () => Promise.resolve(faction),
  } as unknown as FactionRepository;
}

function stubCharacterRepository(
  character: Character | null,
): CharacterRepository {
  return {
    findById: () => Promise.resolve(character),
  } as unknown as CharacterRepository;
}

function buildReader(overrides: {
  layer?: Layer | null;
  worldMap?: WorldMap | null;
  worldElement?: WorldElement | null;
  faction?: Faction | null;
  character?: Character | null;
}) {
  return createContentEntityReader({
    layerRepository: stubLayerRepository(overrides.layer ?? null),
    worldMapRepository: stubWorldMapRepository(overrides.worldMap ?? null),
    worldElementRepository: stubWorldElementRepository(
      overrides.worldElement ?? null,
    ),
    factionRepository: stubFactionRepository(overrides.faction ?? null),
    characterRepository: stubCharacterRepository(overrides.character ?? null),
  });
}

describe("createContentEntityReader", () => {
  it("reads a layer with its indexable fields classified per §13", async () => {
    const layer = Layer.reconstitute({
      id: "layer-1",
      version: 1,
      projectId: "project-1",
      createdByUserId: "user-1",
      parentId: null,
      name: "The Sunken Archive",
      level: 1,
      exposure: "reader_visible",
      description: "A drowned library.",
      content: "Long narrative content about the archive.",
      status: "published",
      currentRevisionId: "revision-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const reader = buildReader({ layer });
    const result = await reader.read({
      entityType: "layer",
      entityId: "layer-1",
    });

    expect(result).toEqual({
      projectId: "project-1",
      entityName: "The Sunken Archive",
      currentRevisionId: "revision-1",
      content: "Long narrative content about the archive.",
      fields: {
        name: { value: "The Sunken Archive", classification: "short" },
        exposure: { value: "reader_visible", classification: "short" },
        description: { value: "A drowned library.", classification: "medium" },
      },
    });
  });

  it("reads a world map with its indexable fields classified per §13", async () => {
    const worldMap = WorldMap.reconstitute({
      id: "map-1",
      version: 1,
      projectId: "project-1",
      createdByUserId: "user-1",
      parentId: null,
      name: "Continent of Ashvale",
      scale: "continental",
      terrain: "mountains and ash plains",
      environment: "post-volcanic",
      description: "A scarred continent.",
      content: "Long narrative content about the map.",
      status: "published",
      currentRevisionId: "revision-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const reader = buildReader({ worldMap });
    const result = await reader.read({ entityType: "map", entityId: "map-1" });

    expect(result).toEqual({
      projectId: "project-1",
      entityName: "Continent of Ashvale",
      currentRevisionId: "revision-1",
      content: "Long narrative content about the map.",
      fields: {
        name: { value: "Continent of Ashvale", classification: "short" },
        scale: { value: "continental", classification: "short" },
        terrain: {
          value: "mountains and ash plains",
          classification: "medium",
        },
        environment: { value: "post-volcanic", classification: "medium" },
        description: {
          value: "A scarred continent.",
          classification: "medium",
        },
      },
    });
  });

  it("reads a world element with its indexable fields classified per §13", async () => {
    const worldElement = WorldElement.reconstitute({
      id: "element-1",
      version: 1,
      projectId: "project-1",
      createdByUserId: "user-1",
      name: "Spirit Qi",
      description: "The ambient energy cultivators draw upon.",
      category: "cultivation-system",
      content: "Long narrative content about spirit qi.",
      status: "published",
      currentRevisionId: "revision-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const reader = buildReader({ worldElement });
    const result = await reader.read({
      entityType: "world_element",
      entityId: "element-1",
    });

    expect(result).toEqual({
      projectId: "project-1",
      entityName: "Spirit Qi",
      currentRevisionId: "revision-1",
      content: "Long narrative content about spirit qi.",
      fields: {
        name: { value: "Spirit Qi", classification: "short" },
        category: { value: "cultivation-system", classification: "short" },
        description: {
          value: "The ambient energy cultivators draw upon.",
          classification: "medium",
        },
      },
    });
  });

  it("reads a faction with its indexable fields classified per §13", async () => {
    const faction = Faction.reconstitute({
      id: "faction-1",
      version: 1,
      projectId: "project-1",
      createdByUserId: "user-1",
      name: "The Azure Sect",
      background: "Founded a thousand years ago.",
      ideology: "harmony through discipline",
      size: "roughly 3000 disciples",
      description: "A prominent cultivation sect.",
      content: "Long narrative content about the sect.",
      status: "active",
      currentRevisionId: "revision-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const reader = buildReader({ faction });
    const result = await reader.read({
      entityType: "faction",
      entityId: "faction-1",
    });

    expect(result).toEqual({
      projectId: "project-1",
      entityName: "The Azure Sect",
      currentRevisionId: "revision-1",
      content: "Long narrative content about the sect.",
      fields: {
        name: { value: "The Azure Sect", classification: "short" },
        description: {
          value: "A prominent cultivation sect.",
          classification: "medium",
        },
        background: {
          value: "Founded a thousand years ago.",
          classification: "medium",
        },
        ideology: {
          value: "harmony through discipline",
          classification: "short",
        },
        size: { value: "roughly 3000 disciples", classification: "short" },
      },
    });
  });

  it("reads a character with its indexable fields classified per §13", async () => {
    const character = Character.reconstitute({
      id: "character-1",
      version: 1,
      projectId: "project-1",
      createdByUserId: "user-1",
      name: "Lin Feng",
      archetype: "wandering rogue cultivator",
      background: "Orphaned during a sect war.",
      personality: "guarded but fiercely loyal",
      goal: "avenge his master",
      description: "A young cultivator on the rise.",
      content: "Long narrative content about Lin Feng.",
      status: "active",
      currentRevisionId: "revision-1",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const reader = buildReader({ character });
    const result = await reader.read({
      entityType: "character",
      entityId: "character-1",
    });

    expect(result).toEqual({
      projectId: "project-1",
      entityName: "Lin Feng",
      currentRevisionId: "revision-1",
      content: "Long narrative content about Lin Feng.",
      fields: {
        name: { value: "Lin Feng", classification: "short" },
        archetype: {
          value: "wandering rogue cultivator",
          classification: "short",
        },
        background: {
          value: "Orphaned during a sect war.",
          classification: "medium",
        },
        personality: {
          value: "guarded but fiercely loyal",
          classification: "medium",
        },
        goal: { value: "avenge his master", classification: "short" },
        description: {
          value: "A young cultivator on the rise.",
          classification: "medium",
        },
      },
    });
  });

  it("returns null when the entity does not exist (deleted or stale revision race, §17 step 4-5)", async () => {
    const reader = buildReader({ character: null });

    const result = await reader.read({
      entityType: "character",
      entityId: "does-not-exist",
    });

    expect(result).toBeNull();
  });

  it("throws for an unrecognized entity type instead of silently returning null", async () => {
    const reader = buildReader({});

    await expect(
      reader.read({ entityType: "event", entityId: "any-id" }),
    ).rejects.toThrow(
      /No ContentEntityReader descriptor for entity type "event"/,
    );
  });
});
