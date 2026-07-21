import { AppError } from "../../../../shared/errors/AppError.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { DomainErrorCode } from "../../../../shared/errors/DomainErrorCode.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";
import {
  Project,
  type ProjectStatus,
  type ProjectVisibility,
} from "../domain/Project.js";
import { ProjectRepositoryNotFoundError } from "../domain/ProjectRepositoryError.js";
import { UserProject } from "../domain/UserProject.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type { IdGenerator } from "../../../../shared/application/ports/IdGenerator.js";
import type { ProjectRepository } from "../domain/ProjectRepository.js";
import type { ProjectUnitOfWork } from "./ports/ProjectUnitOfWork.js";

export type CreateProjectInput = {
  requestingUserId: string;
  name: string;
  description?: string;
  genre?: string;
  tone?: string;
  style?: string;
  language?: string;
};

export type CreateProjectResult = {
  projectId: string;
};

export type ProjectDetail = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  genre: string | null;
  tone: string | null;
  style: string | null;
  language: string | null;
  visibility: ProjectVisibility;
  status: ProjectStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type UpdateProjectDetailsInput = {
  name: string;
  description?: string | null;
  genre?: string | null;
  tone?: string | null;
  style?: string | null;
  language?: string | null;
};

export type ChangeProjectVisibilityInput = {
  visibility: ProjectVisibility;
};

function mapProjectError(error: unknown): never {
  if (
    error instanceof DomainError &&
    error.code === DomainErrorCode.PROJECT_ALREADY_ARCHIVED
  ) {
    throw new AppError(
      ErrorCode.CONFLICT,
      "Operation is not allowed on an archived project.",
    );
  }

  if (error instanceof ProjectRepositoryNotFoundError) {
    throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
  }

  // Generic catch, after the specific PROJECT_ALREADY_ARCHIVED branch above —
  // any other DomainError from Project.validate()/updateDetails() is a Flow
  // "400 Domain validation error" by definition, regardless of which
  // invariant it names. Without this, errorHandler.ts only special-cases
  // AppError, so a DomainError falls through to a raw 500 — indistinguishable
  // from a real bug to the caller (e.g. submitting an empty project name).
  if (error instanceof DomainError) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, error.message);
  }

  throw error;
}

export class ProjectService {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly projectRepository: ProjectRepository,
    private readonly projectUnitOfWork: ProjectUnitOfWork,
  ) {}

  async createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
    const now = this.clock.now();

    const project = Project.create({
      id: this.idGenerator.generate(),
      ownerUserId: input.requestingUserId,
      createdByUserId: input.requestingUserId,
      name: input.name,
      description: input.description,
      genre: input.genre,
      tone: input.tone,
      style: input.style,
      language: input.language,
      now,
    });

    const userProject = UserProject.create({
      id: this.idGenerator.generate(),
      projectId: project.id,
      userId: input.requestingUserId,
      now,
    });

    await this.projectUnitOfWork.transaction(async (repositories) => {
      await repositories.projects.insert(project);
      await repositories.userProjects.insert(userProject);
    });

    return { projectId: project.id };
  }

  async getProjectById(projectId: string): Promise<ProjectDetail> {
    const project = await this.loadExistingProject(projectId);

    return this.toProject(project);
  }

  async updateProjectDetails(
    projectId: string,
    input: UpdateProjectDetailsInput,
  ): Promise<ProjectDetail> {
    const project = await this.loadExistingProject(projectId);
    const now = this.clock.now();

    try {
      project.updateDetails({
        name: input.name,
        description: input.description,
        genre: input.genre,
        tone: input.tone,
        style: input.style,
        language: input.language,
        now,
      });
      await this.projectRepository.update(project);
    } catch (error) {
      mapProjectError(error);
    }

    return this.toProject(project);
  }

  async activateProject(projectId: string): Promise<void> {
    const project = await this.loadExistingProject(projectId);
    const now = this.clock.now();

    try {
      project.activate(now);
      await this.projectRepository.update(project);
    } catch (error) {
      mapProjectError(error);
    }
  }

  async archiveProject(projectId: string): Promise<void> {
    const project = await this.loadExistingProject(projectId);
    const now = this.clock.now();

    try {
      project.archive(now);
      await this.projectRepository.update(project);
    } catch (error) {
      mapProjectError(error);
    }
  }

  async changeProjectVisibility(
    projectId: string,
    input: ChangeProjectVisibilityInput,
  ): Promise<void> {
    const project = await this.loadExistingProject(projectId);
    const now = this.clock.now();

    try {
      project.changeVisibility(input.visibility, now);
      await this.projectRepository.update(project);
    } catch (error) {
      mapProjectError(error);
    }
  }

  private async loadExistingProject(projectId: string): Promise<Project> {
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, "Project not found");
    }

    return project;
  }

  private toProject(project: Project): ProjectDetail {
    return {
      id: project.id,
      ownerUserId: project.ownerUserId,
      name: project.name,
      description: project.description,
      genre: project.genre,
      tone: project.tone,
      style: project.style,
      language: project.language,
      visibility: project.visibility,
      status: project.status,
      createdByUserId: project.createdByUserId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archivedAt: project.archivedAt,
    };
  }
}

export function createProjectService({
  clock,
  idGenerator,
  projectRepository,
  projectUnitOfWork,
}: {
  clock: Clock;
  idGenerator: IdGenerator;
  projectRepository: ProjectRepository;
  projectUnitOfWork: ProjectUnitOfWork;
}): ProjectService {
  return new ProjectService(
    clock,
    idGenerator,
    projectRepository,
    projectUnitOfWork,
  );
}
