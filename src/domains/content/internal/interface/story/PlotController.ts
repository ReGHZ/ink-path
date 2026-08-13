import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changePlotStatusSchema } from "../dto/story/changePlotStatusSchema.js";
import {
  createPlotResponseSchema,
  createPlotSchema,
} from "../dto/story/createPlotSchema.js";
import {
  plotListResponseSchema,
  plotResponseSchema,
} from "../dto/story/plotResponseSchema.js";
import { updatePlotSchema } from "../dto/story/updatePlotSchema.js";
import { PlotDtoMapper } from "../mappers/story/PlotDtoMapper.js";

import type { PlotService } from "../../application/story/PlotService.js";
import type { Context } from "hono";

export class PlotController {
  constructor(private readonly plotService: PlotService) {}

  async createPlot(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createPlotSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = PlotDtoMapper.toCreatePlotInput(dto, userId, projectId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const result = await this.plotService.createPlot(input);
    const response = PlotDtoMapper.toCreatePlotResponse(result.plotId);
    const validatedResponse = createPlotResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getPlot(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const plotId = requireRouteParameter(c, "plotId", "Plot not found");

    const detail = await this.plotService.getPlotById(projectId, plotId);
    const response = PlotDtoMapper.toPlotResponse(detail);
    const validatedResponse = plotResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listPlots(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.plotService.listPlotsByProject(projectId);
    const response = PlotDtoMapper.toPlotListResponse(details);
    const validatedResponse = plotListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updatePlot(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updatePlotSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const plotId = requireRouteParameter(c, "plotId", "Plot not found");

    const member = requireProjectMember(c);
    const input = PlotDtoMapper.toUpdatePlotInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.plotService.updatePlot(projectId, plotId, input);
    const response = PlotDtoMapper.toPlotResponse(detail);
    const validatedResponse = plotResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changePlotStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changePlotStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const plotId = requireRouteParameter(c, "plotId", "Plot not found");

    const member = requireProjectMember(c);
    const input = PlotDtoMapper.toChangePlotStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.plotService.changePlotStatus(
      projectId,
      plotId,
      input,
    );
    const response = PlotDtoMapper.toPlotResponse(detail);
    const validatedResponse = plotResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deletePlot(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const plotId = requireRouteParameter(c, "plotId", "Plot not found");

    const member = requireProjectMember(c);

    await this.plotService.deletePlot(projectId, plotId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createPlotController({
  plotService,
}: {
  plotService: PlotService;
}): PlotController {
  return new PlotController(plotService);
}
