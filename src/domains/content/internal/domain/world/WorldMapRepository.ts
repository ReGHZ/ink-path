import type { WorldMap } from "./WorldMap.js";

export type WorldMapRepository = {
  findById(id: string): Promise<WorldMap | null>;

  findByProjectId(projectId: string): Promise<WorldMap[]>;

  insert(worldMap: WorldMap): Promise<void>;

  update(worldMap: WorldMap): Promise<void>;

  delete(id: string): Promise<void>;
};