import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeWorldMapStatusSchema } from "../dto/world/changeWorldMapStatusSchema.js";
import {
  createWorldMapResponseSchema,
  createWorldMapSchema,
} from "../dto/world/createWorldMapSchema.js";
import { updateWorldMapSchema } from "../dto/world/updateWorldMapSchema.js";
import {
  worldMapListResponseSchema,
  worldMapResponseSchema,
} from "../dto/world/worldMapResponseSchema.js";
import { WorldMapDtoMapper } from "../mappers/world/WorldMapDtoMapper.js";

import type { WorldMapService } from "../../application/world/WorldMapService.js";
import type { Context } from "hono";

export class WorldMapController {
  constructor(private readonly worldMapService: WorldMapService) {}

  async createWorldMap(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createWorldMapSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = WorldMapDtoMapper.toCreateWorldMapInput(
      dto,
      userId,
      projectId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const result = await this.worldMapService.createWorldMap(input);
    const response = WorldMapDtoMapper.toCreateWorldMapResponse(
      result.worldMapId,
    );
    const validatedResponse = createWorldMapResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getWorldMap(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const worldMapId = requireRouteParameter(
      c,
      "worldMapId",
      "World map not found",
    );

    const detail = await this.worldMapService.getWorldMapById(
      projectId,
      worldMapId,
    );
    const response = WorldMapDtoMapper.toWorldMapResponse(detail);
    const validatedResponse = worldMapResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listWorldMaps(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.worldMapService.listWorldMapsByProject(projectId);
    const response = WorldMapDtoMapper.toWorldMapListResponse(details);
    const validatedResponse = worldMapListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateWorldMap(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateWorldMapSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldMapId = requireRouteParameter(
      c,
      "worldMapId",
      "World map not found",
    );

    const member = requireProjectMember(c);
    const input = WorldMapDtoMapper.toUpdateWorldMapInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.worldMapService.updateWorldMap(
      projectId,
      worldMapId,
      input,
    );
    const response = WorldMapDtoMapper.toWorldMapResponse(detail);
    const validatedResponse = worldMapResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeWorldMapStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeWorldMapStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldMapId = requireRouteParameter(
      c,
      "worldMapId",
      "World map not found",
    );

    const member = requireProjectMember(c);
    const input = WorldMapDtoMapper.toChangeWorldMapStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.worldMapService.changeWorldMapStatus(
      projectId,
      worldMapId,
      input,
    );
    const response = WorldMapDtoMapper.toWorldMapResponse(detail);
    const validatedResponse = worldMapResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteWorldMap(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldMapId = requireRouteParameter(
      c,
      "worldMapId",
      "World map not found",
    );

    const member = requireProjectMember(c);

    await this.worldMapService.deleteWorldMap(projectId, worldMapId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createWorldMapController({
  worldMapService,
}: {
  worldMapService: WorldMapService;
}): WorldMapController {
  return new WorldMapController(worldMapService);
}
