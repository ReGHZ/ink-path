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
import { createContentEntityReader } from "./internal/infrastructure/ContentEntityReader.js";
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
import { createEventRepository } from "./internal/infrastructure/world/PrismaEventRepository.js";
import { createEventUnitOfWork } from "./internal/infrastructure/world/PrismaEventUnitOfWork.js";
import { createLayerRepository } from "./internal/infrastructure/world/PrismaLayerRepository.js";
import { createLayerUnitOfWork } from "./internal/infrastructure/world/PrismaLayerUnitOfWork.js";
import { createWorldElementRepository } from "./internal/infrastructure/world/PrismaWorldElementRepository.js";
import { createWorldElementUnitOfWork } from "./internal/infrastructure/world/PrismaWorldElementUnitOfWork.js";
import { createWorldMapRepository } from "./internal/infrastructure/world/PrismaWorldMapRepository.js";
import { createWorldMapUnitOfWork } from "./internal/infrastructure/world/PrismaWorldMapUnitOfWork.js";
import {
  createCharacterController,
  type CharacterController,
} from "./internal/interface/story/CharacterController.js";
import {
  createFactionController,
  type FactionController,
} from "./internal/interface/story/FactionController.js";
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

import type { ContentUnitOfWork } from "./internal/application/ports/ContentUnitOfWork.js";
import type { ChapterRepository } from "./internal/domain/story/ChapterRepository.js";
import type { CharacterRepository } from "./internal/domain/story/CharacterRepository.js";
import type { FactionRepository } from "./internal/domain/story/FactionRepository.js";
import type { PlotRepository } from "./internal/domain/story/PlotRepository.js";
import type { SceneRepository } from "./internal/domain/story/SceneRepository.js";
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
  // Phase 6.3 (repository + unit of work) and 6.4 (service). Controllers land
  // in 6.5. The ContentEntityReader descriptors for these four types were
  // added with 6.4, because a service writing `content.*` outbox events is
  // exactly what makes the embedding worker ask the reader for them.
  eventRepository: EventRepository;
  eventUnitOfWork: ContentUnitOfWork<EventRepository>;
  eventService: EventService;
  plotRepository: PlotRepository;
  plotUnitOfWork: ContentUnitOfWork<PlotRepository>;
  plotService: PlotService;
  chapterRepository: ChapterRepository;
  chapterUnitOfWork: ContentUnitOfWork<ChapterRepository>;
  chapterService: ChapterService;
  sceneRepository: SceneRepository;
  sceneUnitOfWork: ContentUnitOfWork<SceneRepository>;
  sceneService: SceneService;
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
    plotRepository: asFunction(createPlotRepository).singleton(),
    plotUnitOfWork: asFunction(createPlotUnitOfWork).singleton(),
    plotService: asFunction(createPlotService).singleton(),
    chapterRepository: asFunction(createChapterRepository).singleton(),
    chapterUnitOfWork: asFunction(createChapterUnitOfWork).singleton(),
    chapterService: asFunction(createChapterService).singleton(),
    sceneRepository: asFunction(createSceneRepository).singleton(),
    sceneUnitOfWork: asFunction(createSceneUnitOfWork).singleton(),
    sceneService: asFunction(createSceneService).singleton(),
  });
}
