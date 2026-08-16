import type { IndexableContentEntity } from "../../../../shared/application/ports/ContentEntityReader.js";
import type { ContentEntityLocation } from "../application/ports/ContentEntityLocator.js";
import type { ChapterRepository } from "../domain/story/ChapterRepository.js";
import type { CharacterRepository } from "../domain/story/CharacterRepository.js";
import type { FactionRepository } from "../domain/story/FactionRepository.js";
import type { PlotRepository } from "../domain/story/PlotRepository.js";
import type { SceneRepository } from "../domain/story/SceneRepository.js";
import type { ContentEntityType } from "../domain/support/ContentRevision.js";
import type { EventRepository } from "../domain/world/EventRepository.js";
import type { LayerRepository } from "../domain/world/LayerRepository.js";
import type { WorldElementRepository } from "../domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "../domain/world/WorldMapRepository.js";

export type ContentEntityRepositories = {
  layerRepository: LayerRepository;
  worldMapRepository: WorldMapRepository;
  worldElementRepository: WorldElementRepository;
  factionRepository: FactionRepository;
  characterRepository: CharacterRepository;
  eventRepository: EventRepository;
  plotRepository: PlotRepository;
  chapterRepository: ChapterRepository;
  sceneRepository: SceneRepository;
};

// One combined descriptor per entity_type — repo dispatch AND field extraction
// (value + §13 classification together, per field) live in the SAME entry, not
// in two separately-keyed tables. Deliberate: a table for "which repo" and a
// second table for "which fields" would need to be kept in sync by hand for
// every entity type, and forgetting one of the two would only ever surface at
// runtime, for that one entity type. One descriptor per type makes that class
// of drift impossible: there is nowhere to add "just the repo half" of a new
// entity type without also writing its fields.
//
// Since 7.2 the same table serves TWO adapters — `createContentEntityReader`
// (embedding worker) and `createContentEntityLocator` (RelationshipService,
// registry rules 5-7). `locate` is NOT a second per-type function: it is
// derived generically from the same `load`, because every one of the nine
// aggregates carries `projectId`. So the two-consumer split costs zero extra
// per-type code and cannot drift — there is no "locate half" to forget.
export type ContentEntityDescriptor = {
  read(entityId: string): Promise<IndexableContentEntity | null>;
  locate(entityId: string): Promise<ContentEntityLocation | null>;
};

// `locate()` loads the whole aggregate, `content` column included, rather than
// selecting `project_id` alone. Accepted cost, not an oversight: the narrow
// query would mean a tenth method (`existsInProject`) on all nine repository
// ports plus their adapters — eighteen files edited to save one column read on
// a path that runs twice per POST /relationships. That the aggregate is already
// loaded is what made item 7.4b's decision cheap: naming the entities that block
// a delete needs no new query shape at all.
//
// `entityName` is derived from `toIndexable`, NOT from a third per-type
// function. That keeps the property this table was built for: there is nowhere
// to add a new entity type's repo dispatch without also writing where its name
// comes from. The cost is building the field record on a path that only reads
// two of its members — pure in-memory mapping, no extra query.
function describeEntity<TEntity extends { projectId: string }>(
  load: (entityId: string) => Promise<TEntity | null>,
  toIndexable: (entity: TEntity) => IndexableContentEntity,
): ContentEntityDescriptor {
  return {
    async read(entityId) {
      const entity = await load(entityId);

      return entity ? toIndexable(entity) : null;
    },

    async locate(entityId) {
      const entity = await load(entityId);

      if (!entity) {
        return null;
      }

      return {
        projectId: entity.projectId,
        entityName: toIndexable(entity).entityName,
      };
    },
  };
}

// Keyed by the `ContentEntityType` union rather than by `string`: a tenth entity
// type added to `domain/support/ContentRevision.ts` now fails to COMPILE here
// until its descriptor exists, instead of failing at runtime on the first
// request that happens to name it.
export function createContentEntityDescriptors(
  dependencies: ContentEntityRepositories,
): Readonly<Record<ContentEntityType, ContentEntityDescriptor>> {
  return {
    layer: describeEntity(
      (entityId) => dependencies.layerRepository.findById(entityId),
      (layer) => ({
        projectId: layer.projectId,
        entityName: layer.name,
        currentRevisionId: layer.currentRevisionId,
        content: layer.content,
        fields: {
          name: { value: layer.name, classification: "short" },
          exposure: { value: layer.exposure, classification: "short" },
          description: { value: layer.description, classification: "medium" },
        },
      }),
    ),

    map: describeEntity(
      (entityId) => dependencies.worldMapRepository.findById(entityId),
      (worldMap) => ({
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
      }),
    ),

    world_element: describeEntity(
      (entityId) => dependencies.worldElementRepository.findById(entityId),
      (worldElement) => ({
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
      }),
    ),

    faction: describeEntity(
      (entityId) => dependencies.factionRepository.findById(entityId),
      (faction) => ({
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
      }),
    ),

    character: describeEntity(
      (entityId) => dependencies.characterRepository.findById(entityId),
      (character) => ({
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
      }),
    ),

    // Phase 6 entity types. Every classification below is taken verbatim from
    // the frozen field lists in 05-implementation-policy/
    // 03_qdrant_point_id_chunking.md:412-424 — title/era/event_type/
    // significance/theme/name are named there as SHORT, and description/
    // summary/conflict/resolution as MEDIUM. Nothing here is a judgement call.
    event: describeEntity(
      (entityId) => dependencies.eventRepository.findById(entityId),
      (event) => ({
        projectId: event.projectId,
        entityName: event.title,
        currentRevisionId: event.currentRevisionId,
        content: event.content,
        fields: {
          title: { value: event.title, classification: "short" },
          era: { value: event.era, classification: "short" },
          event_type: { value: event.eventType, classification: "short" },
          significance: { value: event.significance, classification: "short" },
          description: { value: event.description, classification: "medium" },
        },
      }),
    ),

    plot: describeEntity(
      (entityId) => dependencies.plotRepository.findById(entityId),
      (plot) => ({
        projectId: plot.projectId,
        entityName: plot.name,
        currentRevisionId: plot.currentRevisionId,
        content: plot.content,
        fields: {
          name: { value: plot.name, classification: "short" },
          theme: { value: plot.theme, classification: "short" },
          conflict: { value: plot.conflict, classification: "medium" },
          resolution: { value: plot.resolution, classification: "medium" },
          description: { value: plot.description, classification: "medium" },
        },
      }),
    ),

    chapter: describeEntity(
      (entityId) => dependencies.chapterRepository.findById(entityId),
      (chapter) => ({
        projectId: chapter.projectId,
        entityName: chapter.title,
        currentRevisionId: chapter.currentRevisionId,
        content: chapter.content,
        fields: {
          title: { value: chapter.title, classification: "short" },
          summary: { value: chapter.summary, classification: "medium" },
        },
      }),
    ),

    scene: describeEntity(
      (entityId) => dependencies.sceneRepository.findById(entityId),
      (scene) => ({
        projectId: scene.projectId,
        // Scene is the only one of the nine entity types whose name/title is
        // nullable (`content-story.prisma:169`), and `entityName` feeds the
        // "Entity Name/Title:" line of the canonical embedding text. An
        // untitled scene therefore contributes an empty label rather than a
        // synthesised one like "Scene 3": a generated string would enter the
        // embedding as if the author had written it, which is worse than a
        // blank — the scene's own content is what carries its meaning.
        entityName: scene.title ?? "",
        currentRevisionId: scene.currentRevisionId,
        content: scene.content,
        fields: {
          title: { value: scene.title, classification: "short" },
          summary: { value: scene.summary, classification: "medium" },
        },
      }),
    ),
  };
}
