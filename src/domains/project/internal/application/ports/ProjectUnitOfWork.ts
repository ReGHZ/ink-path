import type { ProjectRepository } from "../../domain/ProjectRepository.js";
import type { UserProjectRepository } from "../../domain/UserProjectRepository.js";

export type ProjectRepositories = {
  projects: ProjectRepository;
  userProjects: UserProjectRepository;
};

export type ProjectUnitOfWork = {
  transaction<T>(
    work: (repositories: ProjectRepositories) => Promise<T>,
  ): Promise<T>;
};
