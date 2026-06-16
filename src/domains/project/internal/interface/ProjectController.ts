import { changeVisibilitySchema } from "./dto/changeVisibilitySchema.js";
import {
    createProjectResponseSchema,
    createProjectSchema,
} from "./dto/createProjectSchema.js";
import { projectResponseSchema } from "./dto/projectResponseSchema.js";
import { updateProjectDetailsSchema } from "./dto/updateProjectDetailsSchema.js";
import { ProjectDtoMapper } from "./mappers/ProjectDtoMapper.js";
import {
    requireUserId,
    requireProjectId,
    type AppEnvironment,
} from "../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../shared/http/requestValidation.js";
import { success } from "../../../../shared/http/response.js";

import type { ProjectService } from "../application/ProjectService.js";
import type { Context } from "hono";

export class ProjectController {
    constructor(private readonly projectService: ProjectService) { }

    async createProject(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, createProjectSchema);
        const userId = requireUserId(c);
        const input = ProjectDtoMapper.toCreateProjectInput(dto, userId);

        const result = await this.projectService.createProject(input);
        const response = ProjectDtoMapper.toCreateProjectResponse(result.projectId);
        const validatedResponse = createProjectResponseSchema.parse(response);

        return success(c, validatedResponse, 201);
    }

    async getProject(c: Context<AppEnvironment>) {
        const projectId = requireProjectId(c);

        const detail = await this.projectService.getProjectById(projectId);
        const response = ProjectDtoMapper.toProjectResponse(detail);
        const validatedResponse = projectResponseSchema.parse(response);

        return success(c, validatedResponse);
    }

    async updateProjectDetails(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, updateProjectDetailsSchema);
        const projectId = requireProjectId(c);
        const input = ProjectDtoMapper.toUpdateProjectDetailsInput(dto);

        const detail = await this.projectService.updateProjectDetails(
            projectId,
            input,
        );
        const response = ProjectDtoMapper.toProjectResponse(detail);
        const validatedResponse = projectResponseSchema.parse(response);

        return success(c, validatedResponse);
    }

    async activateProject(c: Context<AppEnvironment>) {
        const projectId = requireProjectId(c);

        await this.projectService.activateProject(projectId);

        return success(c, null, 200);
    }

    async archiveProject(c: Context<AppEnvironment>) {
        const projectId = requireProjectId(c);

        await this.projectService.archiveProject(projectId);

        return success(c, null, 200);
    }

    async changeProjectVisibility(c: Context<AppEnvironment>) {
        const dto = await parseJsonBody(c, changeVisibilitySchema);
        const projectId = requireProjectId(c);
        const input = ProjectDtoMapper.toChangeVisibilityInput(dto);

        await this.projectService.changeProjectVisibility(projectId, input);

        return success(c, null, 200);
    }
}

export function createProjectController({
    projectService,
}: {
    projectService: ProjectService;
}): ProjectController {
    return new ProjectController(projectService);
}
