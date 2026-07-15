import type { Faction } from "./Faction.js";

export type FactionRepository = {
  findById(id: string): Promise<Faction | null>;

  findByProjectId(projectId: string): Promise<Faction[]>;

  insert(faction: Faction): Promise<void>;

  update(faction: Faction): Promise<void>;

  delete(id: string): Promise<void>;
};