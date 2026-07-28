import {
  requireProjectId,
  requireProjectMember,
  requireUserId,
  requireRouteParameter,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeWorldElementStatusSchema } from "../dto/world/changeWorldElementStatusSchema.js";
import {
  createWorldElementResponseSchema,
  createWorldElementSchema,
} from "../dto/world/createWorldElementSchema.js";
import { updateWorldElementSchema } from "../dto/world/updateWorldElementSchema.js";
import {
  worldElementListResponseSchema,
  worldElementResponseSchema,
} from "../dto/world/worldElementResponseSchema.js";
import { WorldElementDtoMapper } from "../mappers/world/WorldElementDtoMapper.js";

import type { WorldElementService } from "../../application/world/WorldElementService.js";
import type { Context } from "hono";

export class WorldElementController {
  constructor(private readonly worldElementService: WorldElementService) {}

  async createWorldElement(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createWorldElementSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = WorldElementDtoMapper.toCreateWorldElementInput(
      dto,
      userId,
      projectId,
      { role: member.role, canDelete: member.canDelete },
    );

    const result = await this.worldElementService.createWorldElement(input);
    const response = WorldElementDtoMapper.toCreateWorldElementResponse(
      result.worldElementId,
    );
    const validatedResponse = createWorldElementResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getWorldElement(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const worldElementId = requireRouteParameter(
      c,
      "worldElementId",
      "World element not found",
    );

    const detail = await this.worldElementService.getWorldElementById(
      projectId,
      worldElementId,
    );
    const response = WorldElementDtoMapper.toWorldElementResponse(detail);
    const validatedResponse = worldElementResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listWorldElements(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details =
      await this.worldElementService.listWorldElementsByProject(projectId);
    const response = WorldElementDtoMapper.toWorldElementListResponse(details);
    const validatedResponse = worldElementListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateWorldElement(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateWorldElementSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldElementId = requireRouteParameter(
      c,
      "worldElementId",
      "World element not found",
    );

    const member = requireProjectMember(c);
    const input = WorldElementDtoMapper.toUpdateWorldElementInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.worldElementService.updateWorldElement(
      projectId,
      worldElementId,
      input,
    );
    const response = WorldElementDtoMapper.toWorldElementResponse(detail);
    const validatedResponse = worldElementResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeWorldElementStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeWorldElementStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldElementId = requireRouteParameter(
      c,
      "worldElementId",
      "World element not found",
    );

    const member = requireProjectMember(c);
    const input = WorldElementDtoMapper.toChangeWorldElementStatusInput(
      dto,
      userId,
      { role: member.role, canDelete: member.canDelete },
    );

    const detail = await this.worldElementService.changeWorldElementStatus(
      projectId,
      worldElementId,
      input,
    );
    const response = WorldElementDtoMapper.toWorldElementResponse(detail);
    const validatedResponse = worldElementResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteWorldElement(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const worldElementId = requireRouteParameter(
      c,
      "worldElementId",
      "World element not found",
    );

    const member = requireProjectMember(c);

    await this.worldElementService.deleteWorldElement(
      projectId,
      worldElementId,
      {
        requestingUserId: userId,
        requestingMembership: {
          role: member.role,
          canDelete: member.canDelete,
        },
      },
    );

    return success(c, null, 200);
  }
}

export function createWorldElementController({
  worldElementService,
}: {
  worldElementService: WorldElementService;
}): WorldElementController {
  return new WorldElementController(worldElementService);
}
