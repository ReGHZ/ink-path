import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeLayerStatusInput,
  CreateLayerInput,
  LayerDetail,
  UpdateLayerInput,
} from "../../../application/world/LayerService.js";
import type { ChangeLayerStatusRequestDto } from "../../dto/world/changeLayerStatusSchema.js";
import type {
  CreateLayerRequestDto,
  CreateLayerResponseDto,
} from "../../dto/world/createLayerSchema.js";
import type {
  LayerListResponseDto,
  LayerResponseDto,
} from "../../dto/world/layerResponseSchema.js";
import type { UpdateLayerRequestDto } from "../../dto/world/updateLayerSchema.js";

// Bridges DTO <-> the Input/Output types LayerService.ts already defines —
// never touches the Layer domain entity directly (mirrors WorldElementDtoMapper.ts).
export const LayerDtoMapper = {
  toCreateLayerInput(
    dto: CreateLayerRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateLayerInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      parentId: dto.parentId,
      name: dto.name,
      level: dto.level,
      exposure: dto.exposure,
      description: dto.description,
      content: dto.content,
    };
  },

  toCreateLayerResponse(layerId: string): CreateLayerResponseDto {
    return { layerId };
  },

  toLayerResponse(detail: LayerDetail): LayerResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      parentId: detail.parentId,
      name: detail.name,
      level: detail.level,
      exposure: detail.exposure,
      description: detail.description,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toLayerListResponse(details: LayerDetail[]): LayerListResponseDto {
    return {
      layers: details.map((d) => LayerDtoMapper.toLayerResponse(d)),
    };
  },

  toUpdateLayerInput(
    dto: UpdateLayerRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateLayerInput {
    return {
      requestingUserId,
      requestingMembership,
      name: dto.name,
      level: dto.level,
      exposure: dto.exposure,
      description: dto.description,
      content: dto.content,
    };
  },

  toChangeLayerStatusInput(
    dto: ChangeLayerStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeLayerStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
