import type { WorldElement } from "./WorldElement.js";

export type WorldElementRepository = {
  findById(id: string): Promise<WorldElement | null>;

  findByProjectId(projectId: string): Promise<WorldElement[]>;

  insert(worldElement: WorldElement): Promise<void>;

  update(worldElement: WorldElement): Promise<void>;

  delete(id: string): Promise<void>;
};