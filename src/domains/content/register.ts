import { asFunction, type AwilixContainer } from "awilix";

import {
  createCharacterService,
  type CharacterService,
} from "./internal/application/story/CharacterService.js";
import {
  createFactionService,
  type FactionService,
} from "./internal/application/story/FactionService.js";
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
import { createCharacterRepository } from "./internal/infrastructure/story/PrismaCharacterRepository.js";
import { createCharacterUnitOfWork } from "./internal/infrastructure/story/PrismaCharacterUnitOfWork.js";
import { createFactionRepository } from "./internal/infrastructure/story/PrismaFactionRepository.js";
import { createFactionUnitOfWork } from "./internal/infrastructure/story/PrismaFactionUnitOfWork.js";
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
import type { CharacterRepository } from "./internal/domain/story/CharacterRepository.js";
import type { FactionRepository } from "./internal/domain/story/FactionRepository.js";
import type { LayerRepository } from "./internal/domain/world/LayerRepository.js";
import type { WorldElementRepository } from "./internal/domain/world/WorldElementRepository.js";
import type { WorldMapRepository } from "./internal/domain/world/WorldMapRepository.js";

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
  });
}
