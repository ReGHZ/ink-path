import { asFunction, type AwilixContainer } from "awilix";

import {
    createProjectService,
    type ProjectService,
} from "./internal/application/ProjectService.js";
import {
    createUserProjectService,
    type UserProjectService,
} from "./internal/application/UserProjectService.js";
import { createProjectMemberProvider } from "./internal/infrastructure/PrismaProjectMemberProvider.js";
import { createProjectRepository } from "./internal/infrastructure/PrismaProjectRepository.js";
import { createProjectUnitOfWork } from "./internal/infrastructure/PrismaProjectUnitOfWork.js";
import { createUserProjectRepository } from "./internal/infrastructure/PrismaUserProjectRepository.js";
import {
    createProjectController,
    type ProjectController,
} from "./internal/interface/ProjectController.js";
import { createAppProjectMemberMiddleware, type ProjectMemberProvider } from "./internal/interface/ProjectMemberMiddleware.js";
import {
    createUserProjectController,
    type UserProjectController,
} from "./internal/interface/UserProjectController.js";

import type { ProjectUnitOfWork } from "./internal/application/ports/ProjectUnitOfWork.js";
import type { ProjectRepository } from "./internal/domain/ProjectRepository.js";
import type { UserProjectRepository } from "./internal/domain/UserProjectRepository.js";
import type { AppEnvironment } from "../../shared/http/context.js";
import type { MiddlewareHandler } from "hono";

export type ProjectDomainCradle = {
    projectRepository: ProjectRepository;
    userProjectRepository: UserProjectRepository;
    projectUnitOfWork: ProjectUnitOfWork;
    projectMemberProvider: ProjectMemberProvider;
    projectService: ProjectService;
    userProjectService: UserProjectService;
    projectController: ProjectController;
    userProjectController: UserProjectController;
    projectMemberMiddleware: MiddlewareHandler<AppEnvironment>;
};

export function registerProjectDomain(
    container: AwilixContainer<ProjectDomainCradle>,
): void {
    container.register({
        projectRepository: asFunction(createProjectRepository).singleton(),
        userProjectRepository: asFunction(createUserProjectRepository).singleton(),
        projectUnitOfWork: asFunction(createProjectUnitOfWork).singleton(),
        projectMemberProvider: asFunction(createProjectMemberProvider).singleton(),
        projectService: asFunction(createProjectService).singleton(),
        userProjectService: asFunction(createUserProjectService).singleton(),
        projectController: asFunction(createProjectController).singleton(),
        userProjectController: asFunction(createUserProjectController).singleton(),
        projectMemberMiddleware: asFunction(
            createAppProjectMemberMiddleware,
        ).singleton(),
    });
}
