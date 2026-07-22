import type {
  ChangeWorldElementStatusInput,
  CreateWorldElementInput,
  UpdateWorldElementInput,
  WorldElementDetail,
} from "../../application/world/WorldElementService.js";
import type { ChangeWorldElementStatusRequestDto } from "../dto/world/changeWorldElementStatusSchema.js";
import type {
  CreateWorldElementRequestDto,
  CreateWorldElementResponseDto,
} from "../dto/world/createWorldElementSchema.js";
import type { UpdateWorldElementRequestDto } from "../dto/world/updateWorldElementSchema.js";
import type {
  WorldElementListResponseDto,
  WorldElementResponseDto,
} from "../dto/world/worldElementResponseSchema.js";

// Bridges DTO <-> the Input/Output types WorldElementService.ts already defines —
// never touches the WorldElement domain entity directly (mirrors ProjectDtoMapper.ts,
// which only ever sees CreateProjectInput/ProjectDetail, never the Project entity).
export const WorldElementDtoMapper = {
  toCreateWorldElementInput(
    dto: CreateWorldElementRequestDto,
    requestingUserId: string,
    projectId: string,
  ): CreateWorldElementInput {
    return {
      requestingUserId,
      projectId,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      content: dto.content,
    };
  },

  toCreateWorldElementResponse(
    worldElementId: string,
  ): CreateWorldElementResponseDto {
    return { worldElementId };
  },

  toWorldElementResponse(detail: WorldElementDetail): WorldElementResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      name: detail.name,
      description: detail.description,
      category: detail.category,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toWorldElementListResponse(
    details: WorldElementDetail[],
  ): WorldElementListResponseDto {
    return {
      worldElements: details.map((d) =>
        WorldElementDtoMapper.toWorldElementResponse(d),
      ),
    };
  },

  toUpdateWorldElementInput(
    dto: UpdateWorldElementRequestDto,
    requestingUserId: string,
  ): UpdateWorldElementInput {
    return {
      requestingUserId,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      content: dto.content,
    };
  },

  toChangeWorldElementStatusInput(
    dto: ChangeWorldElementStatusRequestDto,
    requestingUserId: string,
  ): ChangeWorldElementStatusInput {
    return {
      requestingUserId,
      status: dto.status,
    };
  },
};
