import type { Layer } from "./Layer.js";

export type LayerRepository = {
  findById(id: string): Promise<Layer | null>;

  findByProjectId(projectId: string): Promise<Layer[]>;

  insert(layer: Layer): Promise<void>;

  update(layer: Layer): Promise<void>;

  delete(id: string): Promise<void>;
};