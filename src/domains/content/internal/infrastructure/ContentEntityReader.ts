import type {
  ContentEntityReader,
  IndexableContentEntity,
} from "../../../../shared/application/ports/ContentEntityReader.js";
import type { CharacterRepository } from "../domain/story/CharacterRepository.js";
import type { FactionRepository } from "../domain/story/FactionRepository.js";
import type { LayerRepository } from "../domain/world/LayerRepository.js";
import type { WorldElementRepository } from "../domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "../domain/world/WorldMapRepository.js";

type Dependencies = {
  layerRepository: LayerRepository;
  worldMapRepository: WorldMapRepository;
  worldElementRepository: WorldElementRepository;
  factionRepository: FactionRepository;
  characterRepository: CharacterRepository;
};

// One combined descriptor per entity_type — repo dispatch AND field
// extraction (value + §13 classification together, per field) live in the
// SAME function, not two separately-keyed tables. Deliberate: a table for
// "which repo" and a second table for "which fields" would need to be kept
// in sync by hand for every entity type (5 today, 9 once Phase 6 lands) —
// forgetting to update one of the two on a new entity type would only ever
// surface at runtime, for that one entity type. One descriptor per type
// makes that class of drift impossible: there is nowhere to add "just the
// repo half" of a new entity type without also writing its fields.
type EntityDescriptor = (
  entityId: string,
) => Promise<IndexableContentEntity | null>;

function createDescriptors(
  dependencies: Dependencies,
): Readonly<Record<string, EntityDescriptor>> {
  return {
    layer: async (entityId) => {
      const layer = await dependencies.layerRepository.findById(entityId);

      if (!layer) return null;

      return {
        projectId: layer.projectId,
        entityName: layer.name,
        currentRevisionId: layer.currentRevisionId,
        content: layer.content,
        fields: {
          name: { value: layer.name, classification: "short" },
          exposure: { value: layer.exposure, classification: "short" },
          description: { value: layer.description, classification: "medium" },
        },
      };
    },
    map: async (entityId) => {
      const worldMap = await dependencies.worldMapRepository.findById(entityId);

      if (!worldMap) return null;

      return {
        projectId: worldMap.projectId,
        entityName: worldMap.name,
        currentRevisionId: worldMap.currentRevisionId,
        content: worldMap.content,
        fields: {
          name: { value: worldMap.name, classification: "short" },
          scale: { value: worldMap.scale, classification: "short" },
          terrain: { value: worldMap.terrain, classification: "medium" },
          environment: {
            value: worldMap.environment,
            classification: "medium",
          },
          description: {
            value: worldMap.description,
            classification: "medium",
          },
        },
      };
    },
    world_element: async (entityId) => {
      const worldElement = await dependencies.worldElementRepository.findById(entityId);

      if (!worldElement) return null;

      return {
        projectId: worldElement.projectId,
        entityName: worldElement.name,
        currentRevisionId: worldElement.currentRevisionId,
        content: worldElement.content,
        fields: {
          name: { value: worldElement.name, classification: "short" },
          category: { value: worldElement.category, classification: "short" },
          description: {
            value: worldElement.description,
            classification: "medium",
          },
        },
      };
    },
    faction: async (entityId) => {
      const faction = await dependencies.factionRepository.findById(entityId);

      if (!faction) return null;

      return {
        projectId: faction.projectId,
        entityName: faction.name,
        currentRevisionId: faction.currentRevisionId,
        content: faction.content,
        fields: {
          name: { value: faction.name, classification: "short" },
          description: { value: faction.description, classification: "medium" },
          background: { value: faction.background, classification: "medium" },
          ideology: { value: faction.ideology, classification: "short" },
          size: { value: faction.size, classification: "short" },
        },
      };
    },
    character: async (entityId) => {
      const character = await dependencies.characterRepository.findById(entityId);

      if (!character) return null;

      return {
        projectId: character.projectId,
        entityName: character.name,
        currentRevisionId: character.currentRevisionId,
        content: character.content,
        fields: {
          name: { value: character.name, classification: "short" },
          archetype: { value: character.archetype, classification: "short" },
          background: {
            value: character.background,
            classification: "medium",
          },
          personality: {
            value: character.personality,
            classification: "medium",
          },
          goal: { value: character.goal, classification: "short" },
          description: {
            value: character.description,
            classification: "medium",
          },
        },
      };
    },
  };
}

export function createContentEntityReader(
  dependencies: Dependencies,
): ContentEntityReader {
  const descriptors = createDescriptors(dependencies);

  return {
    async read({ entityType, entityId }) {
      const descriptor = descriptors[entityType];

      if (!descriptor) {
        throw new Error(
          `No ContentEntityReader descriptor for entity type "${entityType}" — either an unsupported entity type or a Phase 6 entity type not yet wired in.`,
        );
      }

      return descriptor(entityId);
    },
  };
}
