import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangePlotStatusInput,
  CreatePlotInput,
  PlotDetail,
  UpdatePlotInput,
} from "../../../application/story/PlotService.js";
import type { ChangePlotStatusRequestDto } from "../../dto/story/changePlotStatusSchema.js";
import type {
  CreatePlotRequestDto,
  CreatePlotResponseDto,
} from "../../dto/story/createPlotSchema.js";
import type {
  PlotListResponseDto,
  PlotResponseDto,
} from "../../dto/story/plotResponseSchema.js";
import type { UpdatePlotRequestDto } from "../../dto/story/updatePlotSchema.js";

// Bridges DTO <-> the Input/Output types PlotService.ts already defines — never touches
// the Plot domain entity directly.
export const PlotDtoMapper = {
  toCreatePlotInput(
    dto: CreatePlotRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreatePlotInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      name: dto.name,
      description: dto.description,
      theme: dto.theme,
      conflict: dto.conflict,
      resolution: dto.resolution,
      content: dto.content,
    };
  },

  toCreatePlotResponse(plotId: string): CreatePlotResponseDto {
    return { plotId };
  },

  toPlotResponse(detail: PlotDetail): PlotResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      name: detail.name,
      description: detail.description,
      theme: detail.theme,
      conflict: detail.conflict,
      resolution: detail.resolution,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toPlotListResponse(details: PlotDetail[]): PlotListResponseDto {
    return {
      plots: details.map((d) => PlotDtoMapper.toPlotResponse(d)),
    };
  },

  toUpdatePlotInput(
    dto: UpdatePlotRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdatePlotInput {
    return {
      requestingUserId,
      requestingMembership,
      name: dto.name,
      description: dto.description,
      theme: dto.theme,
      conflict: dto.conflict,
      resolution: dto.resolution,
      content: dto.content,
    };
  },

  toChangePlotStatusInput(
    dto: ChangePlotStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangePlotStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
