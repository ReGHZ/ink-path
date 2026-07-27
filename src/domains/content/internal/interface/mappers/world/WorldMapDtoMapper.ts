import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeWorldMapStatusInput,
  CreateWorldMapInput,
  UpdateWorldMapInput,
  WorldMapDetail,
} from "../../../application/world/WorldMapService.js";
import type { ChangeWorldMapStatusRequestDto } from "../../dto/world/changeWorldMapStatusSchema.js";
import type {
  CreateWorldMapRequestDto,
  CreateWorldMapResponseDto,
} from "../../dto/world/createWorldMapSchema.js";
import type { UpdateWorldMapRequestDto } from "../../dto/world/updateWorldMapSchema.js";
import type {
  WorldMapListResponseDto,
  WorldMapResponseDto,
} from "../../dto/world/worldMapResponseSchema.js";

// Bridges DTO <-> the Input/Output types WorldMapService.ts already defines —
// never touches the WorldMap domain entity directly (mirrors WorldElementDtoMapper.ts).
export const WorldMapDtoMapper = {
  toCreateWorldMapInput(
    dto: CreateWorldMapRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateWorldMapInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      parentId: dto.parentId,
      name: dto.name,
      scale: dto.scale,
      terrain: dto.terrain,
      environment: dto.environment,
      description: dto.description,
      content: dto.content,
    };
  },

  toCreateWorldMapResponse(worldMapId: string): CreateWorldMapResponseDto {
    return { worldMapId };
  },

  toWorldMapResponse(detail: WorldMapDetail): WorldMapResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      parentId: detail.parentId,
      name: detail.name,
      scale: detail.scale,
      terrain: detail.terrain,
      environment: detail.environment,
      description: detail.description,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toWorldMapListResponse(details: WorldMapDetail[]): WorldMapListResponseDto {
    return {
      worldMaps: details.map((d) => WorldMapDtoMapper.toWorldMapResponse(d)),
    };
  },

  toUpdateWorldMapInput(
    dto: UpdateWorldMapRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateWorldMapInput {
    return {
      requestingUserId,
      requestingMembership,
      name: dto.name,
      scale: dto.scale,
      terrain: dto.terrain,
      environment: dto.environment,
      description: dto.description,
      content: dto.content,
    };
  },

  toChangeWorldMapStatusInput(
    dto: ChangeWorldMapStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeWorldMapStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
