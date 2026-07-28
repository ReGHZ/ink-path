import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeLayerStatusSchema } from "../dto/world/changeLayerStatusSchema.js";
import {
  createLayerResponseSchema,
  createLayerSchema,
} from "../dto/world/createLayerSchema.js";
import {
  layerListResponseSchema,
  layerResponseSchema,
} from "../dto/world/layerResponseSchema.js";
import { updateLayerSchema } from "../dto/world/updateLayerSchema.js";
import { LayerDtoMapper } from "../mappers/world/LayerDtoMapper.js";

import type { LayerService } from "../../application/world/LayerService.js";
import type { Context } from "hono";

export class LayerController {
  constructor(private readonly layerService: LayerService) {}

  async createLayer(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createLayerSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const member = requireProjectMember(c);
    const input = LayerDtoMapper.toCreateLayerInput(dto, userId, projectId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const result = await this.layerService.createLayer(input);
    const response = LayerDtoMapper.toCreateLayerResponse(result.layerId);
    const validatedResponse = createLayerResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getLayer(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const layerId = requireRouteParameter(c, "layerId", "Layer not found");

    const detail = await this.layerService.getLayerById(projectId, layerId);
    const response = LayerDtoMapper.toLayerResponse(detail);
    const validatedResponse = layerResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listLayers(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.layerService.listLayersByProject(projectId);
    const response = LayerDtoMapper.toLayerListResponse(details);
    const validatedResponse = layerListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateLayer(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateLayerSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const layerId = requireRouteParameter(c, "layerId", "Layer not found");

    const member = requireProjectMember(c);
    const input = LayerDtoMapper.toUpdateLayerInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.layerService.updateLayer(
      projectId,
      layerId,
      input,
    );
    const response = LayerDtoMapper.toLayerResponse(detail);
    const validatedResponse = layerResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeLayerStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeLayerStatusSchema);
    const userId = requireUserId(c);

    const projectId = requireProjectId(c);
    const layerId = requireRouteParameter(c, "layerId", "Layer not found");

    const member = requireProjectMember(c);
    const input = LayerDtoMapper.toChangeLayerStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.layerService.changeLayerStatus(
      projectId,
      layerId,
      input,
    );
    const response = LayerDtoMapper.toLayerResponse(detail);
    const validatedResponse = layerResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteLayer(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const layerId = requireRouteParameter(c, "layerId", "Layer not found");

    const member = requireProjectMember(c);

    await this.layerService.deleteLayer(projectId, layerId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createLayerController({
  layerService,
}: {
  layerService: LayerService;
}): LayerController {
  return new LayerController(layerService);
}
