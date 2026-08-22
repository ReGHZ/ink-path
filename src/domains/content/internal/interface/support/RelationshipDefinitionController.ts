import {
  requireProjectId,
  requireProjectMember,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { createRelationshipDefinitionSchema } from "../dto/support/createRelationshipDefinitionSchema.js";
import {
  relationshipDefinitionListResponseSchema,
  relationshipDefinitionResponseSchema,
} from "../dto/support/relationshipDefinitionResponseSchema.js";
import { RelationshipDefinitionDtoMapper } from "../mappers/support/RelationshipDefinitionDtoMapper.js";

import type { RelationshipDefinitionService } from "../../application/support/RelationshipDefinitionService.js";
import type { Context } from "hono";

export class RelationshipDefinitionController {
  constructor(
    private readonly relationshipDefinitionService: RelationshipDefinitionService,
  ) {}

  async createDefinition(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createRelationshipDefinitionSchema);
    const projectId = requireProjectId(c);
    const member = requireProjectMember(c);

    const input =
      RelationshipDefinitionDtoMapper.toCreateRelationshipDefinitionInput(
        dto,
        projectId,
        { role: member.role, canDelete: member.canDelete },
      );

    const detail =
      await this.relationshipDefinitionService.createDefinition(input);
    const response =
      RelationshipDefinitionDtoMapper.toRelationshipDefinitionResponse(detail);
    const validatedResponse =
      relationshipDefinitionResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async listDefinitions(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details =
      await this.relationshipDefinitionService.listDefinitions(projectId);
    const response =
      RelationshipDefinitionDtoMapper.toRelationshipDefinitionListResponse(
        details,
      );
    const validatedResponse =
      relationshipDefinitionListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }
}

export function createRelationshipDefinitionController({
  relationshipDefinitionService,
}: {
  relationshipDefinitionService: RelationshipDefinitionService;
}): RelationshipDefinitionController {
  return new RelationshipDefinitionController(relationshipDefinitionService);
}
