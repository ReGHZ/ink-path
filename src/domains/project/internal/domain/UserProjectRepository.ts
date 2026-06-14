import type { UserProject } from "./UserProject.js";

export type UserProjectRepository = {
  findActiveByProjectIdAndUserId(
    projectId: string,
    userId: string,
  ): Promise<UserProject | null>;

  findActiveByProjectId(projectId: string): Promise<UserProject[]>;

  insert(userProject: UserProject): Promise<void>;

  update(userProject: UserProject): Promise<void>;
};
