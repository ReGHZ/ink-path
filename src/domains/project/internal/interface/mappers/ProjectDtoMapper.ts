import type {
  ChangeProjectVisibilityInput,
  CreateProjectInput,
  ProjectDetail,
  UpdateProjectDetailsInput,
} from "../../application/ProjectService.js";
import type { ChangeVisibilityRequestDto } from "../dto/changeVisibilitySchema.js";
import type {
  CreateProjectRequestDto,
  CreateProjectResponseDto,
} from "../dto/createProjectSchema.js";
import type { ProjectResponseDto } from "../dto/projectResponseSchema.js";
import type { UpdateProjectDetailsRequestDto } from "../dto/updateProjectDetailsSchema.js";

export const ProjectDtoMapper = {
  toCreateProjectInput(
    dto: CreateProjectRequestDto,
    requestingUserId: string,
  ): CreateProjectInput {
    return {
      requestingUserId,
      name: dto.name,
      description: dto.description,
      genre: dto.genre,
      tone: dto.tone,
      style: dto.style,
      language: dto.language,
    };
  },

  toCreateProjectResponse(projectId: string): CreateProjectResponseDto {
    return { projectId };
  },

  toProjectResponse(detail: ProjectDetail): ProjectResponseDto {
    return {
      id: detail.id,
      ownerUserId: detail.ownerUserId,
      createdByUserId: detail.createdByUserId,
      name: detail.name,
      description: detail.description,
      genre: detail.genre,
      tone: detail.tone,
      style: detail.style,
      language: detail.language,
      visibility: detail.visibility,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      archivedAt: detail.archivedAt,
    };
  },

  toUpdateProjectDetailsInput(
    dto: UpdateProjectDetailsRequestDto,
  ): UpdateProjectDetailsInput {
    return {
      name: dto.name,
      description: dto.description,
      genre: dto.genre,
      tone: dto.tone,
      style: dto.style,
      language: dto.language,
    };
  },

  toChangeVisibilityInput(
    dto: ChangeVisibilityRequestDto,
  ): ChangeProjectVisibilityInput {
    return { visibility: dto.visibility };
  },
};
