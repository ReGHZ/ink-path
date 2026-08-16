import { Chapter, type UpdateChapterDetailsProperties } from "../../domain/story/Chapter.js";
import {
  ChapterRepositoryConflictError,
  ChapterRepositoryNotFoundError,
} from "../../domain/story/ChapterRepositoryError.js";
import { Character, type UpdateCharacterDetailsProperties } from "../../domain/story/Character.js";
import {
  CharacterRepositoryConflictError,
  CharacterRepositoryNotFoundError,
} from "../../domain/story/CharacterRepositoryError.js";
import { Faction, type UpdateFactionDetailsProperties } from "../../domain/story/Faction.js";
import {
  FactionRepositoryConflictError,
  FactionRepositoryNotFoundError,
} from "../../domain/story/FactionRepositoryError.js";
import { Plot, type UpdatePlotDetailsProperties } from "../../domain/story/Plot.js";
import {
  PlotRepositoryConflictError,
  PlotRepositoryNotFoundError,
} from "../../domain/story/PlotRepositoryError.js";
import { Scene, type UpdateSceneDetailsProperties } from "../../domain/story/Scene.js";
import {
  SceneRepositoryConflictError,
  SceneRepositoryNotFoundError,
} from "../../domain/story/SceneRepositoryError.js";
import {
  ContentRevision,
  type ContentEntityType,
} from "../../domain/support/ContentRevision.js";
import { Event, type UpdateEventDetailsProperties } from "../../domain/world/Event.js";
import {
  EventRepositoryConflictError,
  EventRepositoryNotFoundError,
} from "../../domain/world/EventRepositoryError.js";
import { Layer, type UpdateLayerDetailProperties } from "../../domain/world/Layer.js";
import {
  LayerRepositoryConflictError,
  LayerRepositoryNotFoundError,
} from "../../domain/world/LayerRepositoryError.js";
import { WorldElement, type UpdateWorldElementDetailsProperties } from "../../domain/world/WorldElement.js";
import {
  WorldElementRepositoryConflictError,
  WorldElementRepositoryNotFoundError,
} from "../../domain/world/WorldElementRepositoryError.js";
import { WorldMap, type UpdateWorldMapDetailsProperties } from "../../domain/world/WorldMap.js";
import {
  WorldMapRepositoryConflictError,
  WorldMapRepositoryNotFoundError,
} from "../../domain/world/WorldMapRepositoryError.js";
import { ContentAttributeConflictError } from "../ports/ContentAttributeMutatorError.js";
import { toRevisionSnapshot as chapterRevisionSnapshot } from "../story/ChapterService.js";
import { toRevisionSnapshot as characterRevisionSnapshot } from "../story/CharacterService.js";
import { toRevisionSnapshot as factionRevisionSnapshot } from "../story/FactionService.js";
import { toRevisionSnapshot as plotRevisionSnapshot } from "../story/PlotService.js";
import { toRevisionSnapshot as sceneRevisionSnapshot } from "../story/SceneService.js";
import { toRevisionSnapshot as eventRevisionSnapshot } from "../world/EventService.js";
import { toRevisionSnapshot as layerRevisionSnapshot } from "../world/LayerService.js";
import { toRevisionSnapshot as worldElementRevisionSnapshot } from "../world/WorldElementService.js";
import { toRevisionSnapshot as worldMapRevisionSnapshot } from "../world/WorldMapService.js";

import type { ChapterRepository } from "../../domain/story/ChapterRepository.js";
import type { CharacterRepository } from "../../domain/story/CharacterRepository.js";
import type { FactionRepository } from "../../domain/story/FactionRepository.js";
import type { PlotRepository } from "../../domain/story/PlotRepository.js";
import type { SceneRepository } from "../../domain/story/SceneRepository.js";
import type { ContentRevisionRepository } from "../../domain/support/ContentRevisionRepository.js";
import type { EventRepository } from "../../domain/world/EventRepository.js";
import type { LayerRepository } from "../../domain/world/LayerRepository.js";
import type { WorldElementRepository } from "../../domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";
import type {
  AppliedAttributeChange,
  ApplyAttributeChangeInput,
  ContentAttributeMutator,
} from "../ports/ContentAttributeMutator.js";

// The nine-way write dispatch behind `ContentAttributeMutator` (decision D8).
//
// WHERE THE COMPILE GUARANTEE FOR THE ALLOWLIST'S RIGHT COLUMN FINALLY LANDS.
// `attributeFieldRegistry` maps a wire field name to a domain property name, and
// nothing at 7.6 could check that the property actually exists — both sides are
// strings there (§9 "Risiko tersisa", first bullet). Here each setter returns an
// object literal contextually typed by that entity's own
// `Update*DetailsProperties`, so a name the aggregate does not accept is an
// excess-property error at build time. The remaining half — that every field the
// registry allows HAS a setter — is a coverage question between two tables and
// is locked by this module's test.
//
// It lives in `application/`, not `infrastructure/`, because everything it
// touches is a domain port or a domain aggregate: no Prisma type appears below.
// The infrastructure unit of work supplies repositories built over its
// transaction client and gets back an object that knows nothing about how they
// were made.
//
// DELIBERATELY NOT MERGED INTO `ContentEntityDescriptors`, which decision D8
// described as "descriptor table diperluas member ketiga". The property that
// decision was protecting is that a tenth entity type cannot be added with one
// half missing — and that property comes from keying the table with
// `Record<ContentEntityType, …>`, which this table does too, not from the two
// tables sharing a file. Keeping them apart buys two things: the embedding
// worker's read path does not gain a write capability it never calls, and this
// table can be built per-transaction while the descriptor table stays on the
// pooled client.
type MutableEntity = {
  applyAttributeChange(
    input: ApplyAttributeChangeInput,
  ): Promise<AppliedAttributeChange | null>;
};

// Keyed by DOMAIN property name — the right column of the registry — because
// that is the name the aggregate's `updateDetails()` accepts. The wire name was
// already translated by the caller.
type FieldSetters<TUpdate> = Readonly<
  Record<string, (value: string) => TUpdate>
>;

type MutableEntityDefinition<TEntity, TUpdate> = {
  // No `entityType` field here, and that is a fix from the 7.7 gate rather than
  // an omission: the table below is keyed BY entity type and dispatch reads that
  // key, so a duplicate copy inside the value was the one cell in every entry
  // that no compiler check covered. Mutating the scene entry to say "chapter"
  // type-checked and left the whole content suite green, while writing the wrong
  // `entity_type` into every `content_revisions` row a scene apply produces. The
  // key is now the single source, passed in with the input.
  load(entityId: string): Promise<TEntity | null>;
  setters: FieldSetters<TUpdate>;
  applyUpdate(entity: TEntity, update: TUpdate, now: Date): boolean;
  toRevisionSnapshot(entity: TEntity): Record<string, unknown>;
  // Rebuilds the aggregate with `current_revision_id` pointing at the revision
  // written below — the same two-object dance every Phase 4-6 service performs
  // in `persistChange()`, kept per type because only the class knows its own
  // `reconstitute`.
  withRevision(entity: TEntity, revisionId: string): TEntity;
  update(entity: TEntity): Promise<void>;
  conflictError: new () => Error;
  notFoundError: new () => Error;
};

function defineMutableEntity<
  TEntity extends { projectId: string; version: number; updatedAt: Date },
  TUpdate,
>(
  definition: MutableEntityDefinition<TEntity, TUpdate>,
  contentRevisions: ContentRevisionRepository,
): MutableEntity {
  return {
    async applyAttributeChange(input) {
      const setter = Object.hasOwn(definition.setters, input.domainField)
        ? definition.setters[input.domainField]
        : undefined;

      if (setter === undefined) {
        // Not a user-facing condition: the caller resolved this name through
        // `attributeFieldRegistry`, so reaching here means the two tables
        // disagree. Raw throw — a 500 that names the wiring bug beats a 400
        // that blames the writer.
        throw new Error(
          `No attribute setter for ${input.entityType}.${input.domainField}`,
        );
      }

      const entity = await definition.load(input.entityId);

      if (entity === null) {
        return null;
      }

      const projectId = entity.projectId;
      // Read BEFORE the mutation: `updateDetails()` mutates the aggregate in
      // place, so a snapshot taken afterwards would be the "after" twice.
      const revisionNumber = entity.version + 1;
      const beforeSnapshot = definition.toRevisionSnapshot(entity);

      // Unwrapped: a DomainError from here (an exposure outside its union, a
      // blank name) is the target aggregate refusing the intended value, and
      // NarrativeTransitionService maps DomainError to 400 for every path.
      const changed = definition.applyUpdate(
        entity,
        setter(input.newValue),
        input.now,
      );

      if (!changed) {
        return { projectId, revisionNumber, changed: false };
      }

      const revision = ContentRevision.create({
        id: input.revisionId,
        projectId,
        entityType: input.entityType,
        entityId: input.entityId,
        revisionNumber,
        changedByUserId: input.changedByUserId,
        changeType: "update",
        beforeSnapshot,
        afterSnapshot: definition.toRevisionSnapshot(entity),
        // The entity's own stamp, not the raw clock: the revision and the row it
        // describes then carry the same instant, exactly as `persistChange()`
        // does it.
        now: entity.updatedAt,
      });

      try {
        // Revision first, entity second — `current_revision_id` is an FK to
        // `content_revisions`, so the reverse order fails on the constraint.
        await contentRevisions.insert(revision);
        await definition.update(definition.withRevision(entity, input.revisionId));
      } catch (error) {
        if (error instanceof definition.notFoundError) {
          return null;
        }

        if (error instanceof definition.conflictError) {
          throw new ContentAttributeConflictError();
        }

        throw error;
      }

      return { projectId, revisionNumber, changed: true };
    },
  };
}

export type ContentAttributeMutatorDependencies = {
  layerRepository: LayerRepository;
  worldMapRepository: WorldMapRepository;
  worldElementRepository: WorldElementRepository;
  factionRepository: FactionRepository;
  characterRepository: CharacterRepository;
  eventRepository: EventRepository;
  plotRepository: PlotRepository;
  chapterRepository: ChapterRepository;
  sceneRepository: SceneRepository;
  contentRevisionRepository: ContentRevisionRepository;
};

// Setters are declared as standalone constants rather than inline, so each one
// carries its aggregate's update type explicitly. Inline, inference would widen
// the return type and the excess-property check — the entire point of this
// table — would stop firing.
const layerSetters: FieldSetters<Partial<UpdateLayerDetailProperties>> = {
  name: (value) => ({ name: value }),
  // Cast, and the only one in this file: `exposure` is a closed union and
  // `new_value` is TEXT. Narrowing it here would duplicate a rule that
  // `Layer.validate()` already owns (`../../domain/world/Layer.ts:268`), and a
  // second copy is how the two answers drift apart. The cast hands the raw
  // string to the aggregate, which refuses anything outside the union.
  exposure: (value) => ({
    exposure: value as UpdateLayerDetailProperties["exposure"],
  }),
  description: (value) => ({ description: value }),
};

const worldMapSetters: FieldSetters<Partial<UpdateWorldMapDetailsProperties>> = {
  name: (value) => ({ name: value }),
  scale: (value) => ({ scale: value }),
  terrain: (value) => ({ terrain: value }),
  environment: (value) => ({ environment: value }),
  description: (value) => ({ description: value }),
};

const worldElementSetters: FieldSetters<
  Partial<UpdateWorldElementDetailsProperties>
> = {
  name: (value) => ({ name: value }),
  category: (value) => ({ category: value }),
  description: (value) => ({ description: value }),
};

const factionSetters: FieldSetters<Partial<UpdateFactionDetailsProperties>> = {
  name: (value) => ({ name: value }),
  description: (value) => ({ description: value }),
  background: (value) => ({ background: value }),
  ideology: (value) => ({ ideology: value }),
  size: (value) => ({ size: value }),
};

const characterSetters: FieldSetters<Partial<UpdateCharacterDetailsProperties>> =
  {
    name: (value) => ({ name: value }),
    archetype: (value) => ({ archetype: value }),
    background: (value) => ({ background: value }),
    personality: (value) => ({ personality: value }),
    goal: (value) => ({ goal: value }),
    description: (value) => ({ description: value }),
  };

const eventSetters: FieldSetters<Partial<UpdateEventDetailsProperties>> = {
  title: (value) => ({ title: value }),
  era: (value) => ({ era: value }),
  eventType: (value) => ({ eventType: value }),
  significance: (value) => ({ significance: value }),
  description: (value) => ({ description: value }),
};

const plotSetters: FieldSetters<Partial<UpdatePlotDetailsProperties>> = {
  name: (value) => ({ name: value }),
  theme: (value) => ({ theme: value }),
  conflict: (value) => ({ conflict: value }),
  resolution: (value) => ({ resolution: value }),
  description: (value) => ({ description: value }),
};

const chapterSetters: FieldSetters<Partial<UpdateChapterDetailsProperties>> = {
  title: (value) => ({ title: value }),
  summary: (value) => ({ summary: value }),
};

const sceneSetters: FieldSetters<Partial<UpdateSceneDetailsProperties>> = {
  title: (value) => ({ title: value }),
  summary: (value) => ({ summary: value }),
};

// Keyed by the `ContentEntityType` union: a tenth entity type fails to COMPILE
// here until its write dispatch exists, the same protection
// `createContentEntityDescriptors` gives the read path.
export function createContentAttributeMutator(
  dependencies: ContentAttributeMutatorDependencies,
): ContentAttributeMutator {
  const contentRevisions = dependencies.contentRevisionRepository;

  const mutableEntities: Readonly<Record<ContentEntityType, MutableEntity>> = {
    layer: defineMutableEntity(
      {
        load: (entityId) => dependencies.layerRepository.findById(entityId),
        setters: layerSetters,
        applyUpdate: (layer, update, now) => layer.updateDetails({ ...update, now }),
        toRevisionSnapshot: layerRevisionSnapshot,
        withRevision: (layer, currentRevisionId) =>
          Layer.reconstitute({ ...layer.toSnapshot(), currentRevisionId }),
        update: (layer) => dependencies.layerRepository.update(layer),
        conflictError: LayerRepositoryConflictError,
        notFoundError: LayerRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    map: defineMutableEntity(
      {
        load: (entityId) => dependencies.worldMapRepository.findById(entityId),
        setters: worldMapSetters,
        applyUpdate: (worldMap, update, now) =>
          worldMap.updateDetails({ ...update, now }),
        toRevisionSnapshot: worldMapRevisionSnapshot,
        withRevision: (worldMap, currentRevisionId) =>
          WorldMap.reconstitute({ ...worldMap.toSnapshot(), currentRevisionId }),
        update: (worldMap) => dependencies.worldMapRepository.update(worldMap),
        conflictError: WorldMapRepositoryConflictError,
        notFoundError: WorldMapRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    world_element: defineMutableEntity(
      {
        load: (entityId) =>
          dependencies.worldElementRepository.findById(entityId),
        setters: worldElementSetters,
        applyUpdate: (worldElement, update, now) =>
          worldElement.updateDetails({ ...update, now }),
        toRevisionSnapshot: worldElementRevisionSnapshot,
        withRevision: (worldElement, currentRevisionId) =>
          WorldElement.reconstitute({
            ...worldElement.toSnapshot(),
            currentRevisionId,
          }),
        update: (worldElement) =>
          dependencies.worldElementRepository.update(worldElement),
        conflictError: WorldElementRepositoryConflictError,
        notFoundError: WorldElementRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    faction: defineMutableEntity(
      {
        load: (entityId) => dependencies.factionRepository.findById(entityId),
        setters: factionSetters,
        applyUpdate: (faction, update, now) =>
          faction.updateDetails({ ...update, now }),
        toRevisionSnapshot: factionRevisionSnapshot,
        withRevision: (faction, currentRevisionId) =>
          Faction.reconstitute({ ...faction.toSnapshot(), currentRevisionId }),
        update: (faction) => dependencies.factionRepository.update(faction),
        conflictError: FactionRepositoryConflictError,
        notFoundError: FactionRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    character: defineMutableEntity(
      {
        load: (entityId) => dependencies.characterRepository.findById(entityId),
        setters: characterSetters,
        applyUpdate: (character, update, now) =>
          character.updateDetails({ ...update, now }),
        toRevisionSnapshot: characterRevisionSnapshot,
        withRevision: (character, currentRevisionId) =>
          Character.reconstitute({
            ...character.toSnapshot(),
            currentRevisionId,
          }),
        update: (character) => dependencies.characterRepository.update(character),
        conflictError: CharacterRepositoryConflictError,
        notFoundError: CharacterRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    event: defineMutableEntity(
      {
        load: (entityId) => dependencies.eventRepository.findById(entityId),
        setters: eventSetters,
        applyUpdate: (event, update, now) => event.updateDetails({ ...update, now }),
        toRevisionSnapshot: eventRevisionSnapshot,
        withRevision: (event, currentRevisionId) =>
          Event.reconstitute({ ...event.toSnapshot(), currentRevisionId }),
        update: (event) => dependencies.eventRepository.update(event),
        conflictError: EventRepositoryConflictError,
        notFoundError: EventRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    plot: defineMutableEntity(
      {
        load: (entityId) => dependencies.plotRepository.findById(entityId),
        setters: plotSetters,
        applyUpdate: (plot, update, now) => plot.updateDetails({ ...update, now }),
        toRevisionSnapshot: plotRevisionSnapshot,
        withRevision: (plot, currentRevisionId) =>
          Plot.reconstitute({ ...plot.toSnapshot(), currentRevisionId }),
        update: (plot) => dependencies.plotRepository.update(plot),
        conflictError: PlotRepositoryConflictError,
        notFoundError: PlotRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    chapter: defineMutableEntity(
      {
        load: (entityId) => dependencies.chapterRepository.findById(entityId),
        setters: chapterSetters,
        applyUpdate: (chapter, update, now) =>
          chapter.updateDetails({ ...update, now }),
        toRevisionSnapshot: chapterRevisionSnapshot,
        withRevision: (chapter, currentRevisionId) =>
          Chapter.reconstitute({ ...chapter.toSnapshot(), currentRevisionId }),
        update: (chapter) => dependencies.chapterRepository.update(chapter),
        conflictError: ChapterRepositoryConflictError,
        notFoundError: ChapterRepositoryNotFoundError,
      },
      contentRevisions,
    ),

    scene: defineMutableEntity(
      {
        load: (entityId) => dependencies.sceneRepository.findById(entityId),
        setters: sceneSetters,
        applyUpdate: (scene, update, now) => scene.updateDetails({ ...update, now }),
        toRevisionSnapshot: sceneRevisionSnapshot,
        withRevision: (scene, currentRevisionId) =>
          Scene.reconstitute({ ...scene.toSnapshot(), currentRevisionId }),
        update: (scene) => dependencies.sceneRepository.update(scene),
        conflictError: SceneRepositoryConflictError,
        notFoundError: SceneRepositoryNotFoundError,
      },
      contentRevisions,
    ),
  };

  return {
    applyAttributeChange(input) {
      return mutableEntities[input.entityType].applyAttributeChange(input);
    },
  };
}

// Exported for the coverage test only: it answers "which domain property names
// does this table accept for this entity type", which is the half the compiler
// cannot check against `attributeFieldRegistry`.
export function settableDomainFieldsOf(
  entityType: ContentEntityType,
): readonly string[] {
  const setters: Readonly<Record<ContentEntityType, FieldSetters<unknown>>> = {
    layer: layerSetters,
    map: worldMapSetters,
    world_element: worldElementSetters,
    faction: factionSetters,
    character: characterSetters,
    event: eventSetters,
    plot: plotSetters,
    chapter: chapterSetters,
    scene: sceneSetters,
  };

  return Object.keys(setters[entityType]).sort();
}
