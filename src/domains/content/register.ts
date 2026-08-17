import { asFunction, type AwilixContainer } from "awilix";

import {
  createChapterService,
  type ChapterService,
} from "./internal/application/story/ChapterService.js";
import {
  createCharacterService,
  type CharacterService,
} from "./internal/application/story/CharacterService.js";
import {
  createFactionService,
  type FactionService,
} from "./internal/application/story/FactionService.js";
import {
  createPlotService,
  type PlotService,
} from "./internal/application/story/PlotService.js";
import {
  createSceneService,
  type SceneService,
} from "./internal/application/story/SceneService.js";
import {
  createRelationshipService,
  type RelationshipService,
} from "./internal/application/support/RelationshipService.js";
import {
  createNarrativeTransitionService,
  type NarrativeTransitionService,
} from "./internal/application/transition/NarrativeTransitionService.js";
import {
  createEventService,
  type EventService,
} from "./internal/application/world/EventService.js";
import {
  createLayerService,
  type LayerService,
} from "./internal/application/world/LayerService.js";
import {
  createWorldElementService,
  type WorldElementService,
} from "./internal/application/world/WorldElementService.js";
import {
  createWorldMapService,
  type WorldMapService,
} from "./internal/application/world/WorldMapService.js";
import { createContentEntityLocator } from "./internal/infrastructure/ContentEntityLocator.js";
import { createContentEntityReader } from "./internal/infrastructure/ContentEntityReader.js";
import { createNarrativeTransitionUnitOfWork } from "./internal/infrastructure/PrismaNarrativeTransitionUnitOfWork.js";
import { createChapterRepository } from "./internal/infrastructure/story/PrismaChapterRepository.js";
import { createChapterUnitOfWork } from "./internal/infrastructure/story/PrismaChapterUnitOfWork.js";
import { createCharacterRepository } from "./internal/infrastructure/story/PrismaCharacterRepository.js";
import { createCharacterUnitOfWork } from "./internal/infrastructure/story/PrismaCharacterUnitOfWork.js";
import { createFactionRepository } from "./internal/infrastructure/story/PrismaFactionRepository.js";
import { createFactionUnitOfWork } from "./internal/infrastructure/story/PrismaFactionUnitOfWork.js";
import { createPlotRepository } from "./internal/infrastructure/story/PrismaPlotRepository.js";
import { createPlotUnitOfWork } from "./internal/infrastructure/story/PrismaPlotUnitOfWork.js";
import { createSceneRepository } from "./internal/infrastructure/story/PrismaSceneRepository.js";
import { createSceneUnitOfWork } from "./internal/infrastructure/story/PrismaSceneUnitOfWork.js";
import { createContentRelationshipRepository } from "./internal/infrastructure/support/PrismaContentRelationshipRepository.js";
import { createNarrativeTransitionRepository } from "./internal/infrastructure/transition/PrismaNarrativeTransitionRepository.js";
import { createTransitionEffectRepository } from "./internal/infrastructure/transition/PrismaTransitionEffectRepository.js";
import { createEventRepository } from "./internal/infrastructure/world/PrismaEventRepository.js";
import { createEventUnitOfWork } from "./internal/infrastructure/world/PrismaEventUnitOfWork.js";
import { createLayerRepository } from "./internal/infrastructure/world/PrismaLayerRepository.js";
import { createLayerUnitOfWork } from "./internal/infrastructure/world/PrismaLayerUnitOfWork.js";
import { createWorldElementRepository } from "./internal/infrastructure/world/PrismaWorldElementRepository.js";
import { createWorldElementUnitOfWork } from "./internal/infrastructure/world/PrismaWorldElementUnitOfWork.js";
import { createWorldMapRepository } from "./internal/infrastructure/world/PrismaWorldMapRepository.js";
import { createWorldMapUnitOfWork } from "./internal/infrastructure/world/PrismaWorldMapUnitOfWork.js";
import {
  createChapterController,
  type ChapterController,
} from "./internal/interface/story/ChapterController.js";
import {
  createCharacterController,
  type CharacterController,
} from "./internal/interface/story/CharacterController.js";
import {
  createFactionController,
  type FactionController,
} from "./internal/interface/story/FactionController.js";
import {
  createPlotController,
  type PlotController,
} from "./internal/interface/story/PlotController.js";
import {
  createSceneController,
  type SceneController,
} from "./internal/interface/story/SceneController.js";
import {
  createRelationshipController,
  type RelationshipController,
} from "./internal/interface/support/RelationshipController.js";
import {
  createNarrativeTransitionController,
  type NarrativeTransitionController,
} from "./internal/interface/transition/NarrativeTransitionController.js";
import {
  createEventController,
  type EventController,
} from "./internal/interface/world/EventController.js";
import {
  createLayerController,
  type LayerController,
} from "./internal/interface/world/LayerController.js";
import {
  createWorldElementController,
  type WorldElementController,
} from "./internal/interface/world/WorldElementController.js";
import {
  createWorldMapController,
  type WorldMapController,
} from "./internal/interface/world/WorldMapController.js";

import type { ContentEntityLocator } from "./internal/application/ports/ContentEntityLocator.js";
import type { ContentUnitOfWork } from "./internal/application/ports/ContentUnitOfWork.js";
import type { NarrativeTransitionUnitOfWork } from "./internal/application/ports/NarrativeTransitionUnitOfWork.js";
import type { ChapterRepository } from "./internal/domain/story/ChapterRepository.js";
import type { CharacterRepository } from "./internal/domain/story/CharacterRepository.js";
import type { FactionRepository } from "./internal/domain/story/FactionRepository.js";
import type { PlotRepository } from "./internal/domain/story/PlotRepository.js";
import type { SceneRepository } from "./internal/domain/story/SceneRepository.js";
import type { ContentRelationshipRepository } from "./internal/domain/support/ContentRelationshipRepository.js";
import type { NarrativeTransitionRepository } from "./internal/domain/transition/NarrativeTransitionRepository.js";
import type { TransitionEffectRepository } from "./internal/domain/transition/TransitionEffectRepository.js";
import type { EventRepository } from "./internal/domain/world/EventRepository.js";
import type { LayerRepository } from "./internal/domain/world/LayerRepository.js";
import type { WorldElementRepository } from "./internal/domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "./internal/domain/world/WorldMapRepository.js";
import type { ContentEntityReader } from "../../shared/application/ports/ContentEntityReader.js";

// `clock`/`idGenerator` are NOT registered here — they're already registered by
// registerUserDomain (SystemClock/UuidGenerator) onto the same shared container,
// and every Content service resolves them by name via Awilix PROXY injection,
// same as ProjectService already does.
export type ContentDomainCradle = {
  layerRepository: LayerRepository;
  layerUnitOfWork: ContentUnitOfWork<LayerRepository>;
  layerService: LayerService;
  layerController: LayerController;
  worldMapRepository: WorldMapRepository;
  worldMapUnitOfWork: ContentUnitOfWork<WorldMapRepository>;
  worldMapService: WorldMapService;
  worldMapController: WorldMapController;
  worldElementRepository: WorldElementRepository;
  worldElementUnitOfWork: ContentUnitOfWork<WorldElementRepository>;
  worldElementService: WorldElementService;
  worldElementController: WorldElementController;
  factionRepository: FactionRepository;
  factionUnitOfWork: ContentUnitOfWork<FactionRepository>;
  factionService: FactionService;
  factionController: FactionController;
  characterRepository: CharacterRepository;
  characterUnitOfWork: ContentUnitOfWork<CharacterRepository>;
  characterService: CharacterService;
  characterController: CharacterController;
  contentEntityReader: ContentEntityReader;
  // Phase 6.3 (repository + unit of work), 6.4 (service), 6.5 (controller).
  // The ContentEntityReader descriptors for these four types were added with
  // 6.4, because a service writing `content.*` outbox events is exactly what
  // makes the embedding worker ask the reader for them.
  eventRepository: EventRepository;
  eventUnitOfWork: ContentUnitOfWork<EventRepository>;
  eventService: EventService;
  eventController: EventController;
  plotRepository: PlotRepository;
  plotUnitOfWork: ContentUnitOfWork<PlotRepository>;
  plotService: PlotService;
  plotController: PlotController;
  chapterRepository: ChapterRepository;
  chapterUnitOfWork: ContentUnitOfWork<ChapterRepository>;
  chapterService: ChapterService;
  chapterController: ChapterController;
  sceneRepository: SceneRepository;
  sceneUnitOfWork: ContentUnitOfWork<SceneRepository>;
  sceneService: SceneService;
  sceneController: SceneController;
  // Phase 7.1-7.3. No `relationshipUnitOfWork`: a relationship write produces no
  // revision and no outbox event, so there is no multi-write to make atomic
  // (`RelationshipService.ts:135-139`). `contentEntityLocator` is the second
  // adapter over the shared descriptor table — registered next to
  // `contentEntityReader` because they are built from the same descriptors.
  contentEntityLocator: ContentEntityLocator;
  contentRelationshipRepository: ContentRelationshipRepository;
  relationshipService: RelationshipService;
  relationshipController: RelationshipController;
  // Phase 7.6-7.7. `narrativeTransitionUnitOfWork` has no
  // `ContentUnitOfWork<T>` twin above it because it is not generic over one
  // entity repository: applying an effect touches whichever of the nine the
  // effect names, plus the effect row, plus revisions or relationships
  // (`internal/application/ports/NarrativeTransitionUnitOfWork.ts`).
  //
  // The two repositories beside it are the POOLED instances, and the split
  // between them is not symmetrical:
  //
  //   `narrativeTransitionRepository` — reads, plus the two writes that need no
  //   transaction because each is one row and nothing has to agree with it:
  //   declare (`insert`) and relabel (`update`, last-write-wins, this table has
  //   no `version` column on purpose).
  //
  //   `transitionEffectRepository` — READS ONLY from the service. Every write to
  //   `transition_effects` goes through the unit of work, including the plain
  //   insert of `addEffect`, which looks like it could be a single statement and
  //   deliberately is not: it runs under the aggregate-root lock so that
  //   `deleteTransition` can trust that the set of children it inspected is the
  //   set its blanket delete removes (7.7 gate, notes §10).
  narrativeTransitionRepository: NarrativeTransitionRepository;
  transitionEffectRepository: TransitionEffectRepository;
  narrativeTransitionUnitOfWork: NarrativeTransitionUnitOfWork;
  narrativeTransitionService: NarrativeTransitionService;
  // Phase 7.8. One controller for all twelve routes, including the two that hang
  // off `/transition-effects` rather than off a transition: they are operations
  // of the same aggregate, and splitting them into a second controller would
  // only hide that `deleteEffect` and `deleteTransition` guard each other (D10).
  narrativeTransitionController: NarrativeTransitionController;
};

export function registerContentDomain(
  container: AwilixContainer<ContentDomainCradle>,
): void {
  container.register({
    layerRepository: asFunction(createLayerRepository).singleton(),
    layerUnitOfWork: asFunction(createLayerUnitOfWork).singleton(),
    layerService: asFunction(createLayerService).singleton(),
    layerController: asFunction(createLayerController).singleton(),
    worldMapRepository: asFunction(createWorldMapRepository).singleton(),
    worldMapUnitOfWork: asFunction(createWorldMapUnitOfWork).singleton(),
    worldMapService: asFunction(createWorldMapService).singleton(),
    worldMapController: asFunction(createWorldMapController).singleton(),
    worldElementRepository: asFunction(
      createWorldElementRepository,
    ).singleton(),
    worldElementUnitOfWork: asFunction(
      createWorldElementUnitOfWork,
    ).singleton(),
    worldElementService: asFunction(createWorldElementService).singleton(),
    worldElementController: asFunction(
      createWorldElementController,
    ).singleton(),
    factionRepository: asFunction(createFactionRepository).singleton(),
    factionUnitOfWork: asFunction(createFactionUnitOfWork).singleton(),
    factionService: asFunction(createFactionService).singleton(),
    factionController: asFunction(createFactionController).singleton(),
    characterRepository: asFunction(createCharacterRepository).singleton(),
    characterUnitOfWork: asFunction(createCharacterUnitOfWork).singleton(),
    characterService: asFunction(createCharacterService).singleton(),
    characterController: asFunction(createCharacterController).singleton(),
    contentEntityReader: asFunction(createContentEntityReader).singleton(),
    eventRepository: asFunction(createEventRepository).singleton(),
    eventUnitOfWork: asFunction(createEventUnitOfWork).singleton(),
    eventService: asFunction(createEventService).singleton(),
    eventController: asFunction(createEventController).singleton(),
    plotRepository: asFunction(createPlotRepository).singleton(),
    plotUnitOfWork: asFunction(createPlotUnitOfWork).singleton(),
    plotService: asFunction(createPlotService).singleton(),
    plotController: asFunction(createPlotController).singleton(),
    chapterRepository: asFunction(createChapterRepository).singleton(),
    chapterUnitOfWork: asFunction(createChapterUnitOfWork).singleton(),
    chapterService: asFunction(createChapterService).singleton(),
    chapterController: asFunction(createChapterController).singleton(),
    sceneRepository: asFunction(createSceneRepository).singleton(),
    sceneUnitOfWork: asFunction(createSceneUnitOfWork).singleton(),
    sceneService: asFunction(createSceneService).singleton(),
    sceneController: asFunction(createSceneController).singleton(),
    contentEntityLocator: asFunction(createContentEntityLocator).singleton(),
    contentRelationshipRepository: asFunction(
      createContentRelationshipRepository,
    ).singleton(),
    relationshipService: asFunction(createRelationshipService).singleton(),
    relationshipController: asFunction(createRelationshipController).singleton(),
    narrativeTransitionRepository: asFunction(
      createNarrativeTransitionRepository,
    ).singleton(),
    transitionEffectRepository: asFunction(
      createTransitionEffectRepository,
    ).singleton(),
    narrativeTransitionUnitOfWork: asFunction(
      createNarrativeTransitionUnitOfWork,
    ).singleton(),
    narrativeTransitionService: asFunction(
      createNarrativeTransitionService,
    ).singleton(),
    narrativeTransitionController: asFunction(
      createNarrativeTransitionController,
    ).singleton(),
  });
}
