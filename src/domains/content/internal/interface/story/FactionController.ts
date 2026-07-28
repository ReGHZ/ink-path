import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeFactionStatusSchema } from "../dto/story/changeFactionStatusSchema.js";
import {
  createFactionResponseSchema,
  createFactionSchema,
} from "../dto/story/createFactionSchema.js";
import {
  factionListResponseSchema,
  factionResponseSchema,
} from "../dto/story/factionResponseSchema.js";
import { updateFactionSchema } from "../dto/story/updateFactionSchema.js";
import { FactionDtoMapper } from "../mappers/story/FactionDtoMapper.js";

import type { FactionService } from "../../application/story/FactionService.js";
import type { Context } from "hono";

export class FactionController {
  constructor(private readonly factionService: FactionService) {}

  async createFaction(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createFactionSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = FactionDtoMapper.toCreateFactionInput(
      dto,
      userId,
      projectId,
      { role: member.role, canDelete: member.canDelete },
    );

    const result = await this.factionService.createFaction(input);
    const response = FactionDtoMapper.toCreateFactionResponse(result.factionId);
    const validatedResponse = createFactionResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getFaction(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const factionId = requireRouteParameter(
      c,
      "factionId",
      "Faction not found",
    );

    const detail = await this.factionService.getFactionById(
      projectId,
      factionId,
    );
    const response = FactionDtoMapper.toFactionResponse(detail);
    const validatedResponse = factionResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listFactions(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.factionService.listFactionsByProject(projectId);
    const response = FactionDtoMapper.toFactionListResponse(details);
    const validatedResponse = factionListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateFaction(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateFactionSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const factionId = requireRouteParameter(
      c,
      "factionId",
      "Faction not found",
    );

    const member = requireProjectMember(c);
    const input = FactionDtoMapper.toUpdateFactionInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.factionService.updateFaction(
      projectId,
      factionId,
      input,
    );
    const response = FactionDtoMapper.toFactionResponse(detail);
    const validatedResponse = factionResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeFactionStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeFactionStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const factionId = requireRouteParameter(
      c,
      "factionId",
      "Faction not found",
    );

    const member = requireProjectMember(c);
    const input = FactionDtoMapper.toChangeFactionStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.factionService.changeFactionStatus(
      projectId,
      factionId,
      input,
    );
    const response = FactionDtoMapper.toFactionResponse(detail);
    const validatedResponse = factionResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteFaction(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const factionId = requireRouteParameter(
      c,
      "factionId",
      "Faction not found",
    );

    const member = requireProjectMember(c);

    await this.factionService.deleteFaction(projectId, factionId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createFactionController({
  factionService,
}: {
  factionService: FactionService;
}): FactionController {
  return new FactionController(factionService);
}
