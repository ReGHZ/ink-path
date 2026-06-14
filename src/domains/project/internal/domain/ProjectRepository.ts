import type { Project } from "./Project.js";

export type ProjectRepository = {
  findById(id: string): Promise<Project | null>;

  findByOwnerUserId(ownerUserId: string): Promise<Project[]>;

  insert(project: Project): Promise<void>;

  update(project: Project): Promise<void>;
};
