import { NESTED_RELATIONSHIP_ROUTES } from "./nestedRelationshipRoutes.js";
import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { createRelationshipSchema } from "../dto/support/createRelationshipSchema.js";
import {
  relationshipListResponseSchema,
  relationshipResponseSchema,
} from "../dto/support/relationshipResponseSchema.js";
import { updateRelationshipSchema } from "../dto/support/updateRelationshipSchema.js";
import { RelationshipDtoMapper } from "../mappers/support/RelationshipDtoMapper.js";

import type { RelationshipService } from "../../application/support/RelationshipService.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";
import type { Context } from "hono";

const RELATIONSHIP_NOT_FOUND = "Relationship not found";

export class RelationshipController {
  constructor(private readonly relationshipService: RelationshipService) {}

  async createRelationship(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createRelationshipSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const member = requireProjectMember(c);
    const input = RelationshipDtoMapper.toCreateRelationshipInput(
      dto,
      userId,
      projectId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const detail = await this.relationshipService.createRelationship(input);
    // 201 with the full row, not `{ id }`: see relationshipResponseSchema.ts.
    const response = RelationshipDtoMapper.toRelationshipResponse(detail);
    const validatedResponse = relationshipResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getRelationship(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const relationshipId = requireRouteParameter(
      c,
      "relationshipId",
      RELATIONSHIP_NOT_FOUND,
    );

    const detail = await this.relationshipService.getRelationshipById(
      projectId,
      relationshipId,
    );
    const response = RelationshipDtoMapper.toRelationshipResponse(detail);
    const validatedResponse = relationshipResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  // One method for all nine nested routes. `entityType` is a parameter of the
  // METHOD, not something read out of the request: the route table supplies it
  // as a compile-time constant, so a typo is a build failure and there is no
  // per-entity controller code to keep in sync (K6).
  async listRelationshipsByEntity(
    c: Context<AppEnvironment>,
    entityType: ContentEntityType,
  ) {
    const route = NESTED_RELATIONSHIP_ROUTES[entityType];
    const projectId = requireProjectId(c);
    const entityId = requireRouteParameter(
      c,
      route.parameterName,
      route.notFoundMessage,
    );

    const details = await this.relationshipService.listRelationshipsByEntity(
      projectId,
      entityType,
      entityId,
    );
    // The perspective handed to the mapper is the entity from the PATH — the
    // same pair the service just validated — so `direction`/`label` can never be
    // computed against a different entity than the one that was queried.
    const response = RelationshipDtoMapper.toRelationshipListResponse(details, {
      entityType,
      entityId,
    });
    const validatedResponse = relationshipListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateRelationshipNote(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateRelationshipSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const relationshipId = requireRouteParameter(
      c,
      "relationshipId",
      RELATIONSHIP_NOT_FOUND,
    );

    const member = requireProjectMember(c);
    const input = RelationshipDtoMapper.toUpdateRelationshipNoteInput(
      dto,
      userId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const detail = await this.relationshipService.updateRelationshipNote(
      projectId,
      relationshipId,
      input,
    );
    const response = RelationshipDtoMapper.toRelationshipResponse(detail);
    const validatedResponse = relationshipResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  // No `can_delete` check anywhere on this path, deliberately: the guard lives
  // in the service and is `assertCanWrite`, the one content service without an
  // `assertCanDelete` twin (`RelationshipService.ts:68-81`). Cutting a link
  // destroys no content, so Flow 4 lets an Editor do it.
  async deleteRelationship(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const relationshipId = requireRouteParameter(
      c,
      "relationshipId",
      RELATIONSHIP_NOT_FOUND,
    );

    const member = requireProjectMember(c);

    await this.relationshipService.deleteRelationship(
      projectId,
      relationshipId,
      RelationshipDtoMapper.toDeleteRelationshipInput(userId, {
        role: member.role,
        canDelete: member.canDelete,
      }),
    );

    return success(c, null, 200);
  }
}

export function createRelationshipController({
  relationshipService,
}: {
  relationshipService: RelationshipService;
}): RelationshipController {
  return new RelationshipController(relationshipService);
}
