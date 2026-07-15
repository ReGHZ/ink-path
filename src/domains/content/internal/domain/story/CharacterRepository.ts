import type { Character } from "./Character.js";

export type CharacterRepository = {
  findById(id: string): Promise<Character | null>;

  findByProjectId(projectId: string): Promise<Character[]>;

  insert(character: Character): Promise<void>;

  update(character: Character): Promise<void>;

  delete(id: string): Promise<void>;
};