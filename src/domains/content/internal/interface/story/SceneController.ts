import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeSceneStatusSchema } from "../dto/story/changeSceneStatusSchema.js";
import {
  createSceneResponseSchema,
  createSceneSchema,
} from "../dto/story/createSceneSchema.js";
import {
  sceneListResponseSchema,
  sceneResponseSchema,
} from "../dto/story/sceneResponseSchema.js";
import { updateSceneSchema } from "../dto/story/updateSceneSchema.js";
import { SceneDtoMapper } from "../mappers/story/SceneDtoMapper.js";

import type { SceneService } from "../../application/story/SceneService.js";
import type { Context } from "hono";

export class SceneController {
  constructor(private readonly sceneService: SceneService) {}

  // Nested under a chapter: `chapterId` is a route param, not a body field. The service
  // verifies the chapter exists AND belongs to this project before writing — `chapter_id`
  // is a plain FK, so the database alone would happily hang this scene off another
  // tenant's chapter.
  async createScene(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createSceneSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const member = requireProjectMember(c);
    const input = SceneDtoMapper.toCreateSceneInput(
      dto,
      userId,
      projectId,
      chapterId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const result = await this.sceneService.createScene(input);
    const response = SceneDtoMapper.toCreateSceneResponse(result.sceneId);
    const validatedResponse = createSceneResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  // Also nested: listing is a property of a chapter, and the service answers 404 for a
  // chapter that does not exist or belongs to another project rather than an empty array
  // — "no such chapter" and "chapter with no scenes yet" are different facts.
  async listScenesByChapter(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const details = await this.sceneService.listScenesByChapter(
      projectId,
      chapterId,
    );
    const response = SceneDtoMapper.toSceneListResponse(details);
    const validatedResponse = sceneListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async getScene(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const sceneId = requireRouteParameter(c, "sceneId", "Scene not found");

    const detail = await this.sceneService.getSceneById(projectId, sceneId);
    const response = SceneDtoMapper.toSceneResponse(detail);
    const validatedResponse = sceneResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateScene(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateSceneSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const sceneId = requireRouteParameter(c, "sceneId", "Scene not found");

    const member = requireProjectMember(c);
    const input = SceneDtoMapper.toUpdateSceneInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.sceneService.updateScene(
      projectId,
      sceneId,
      input,
    );
    const response = SceneDtoMapper.toSceneResponse(detail);
    const validatedResponse = sceneResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async changeSceneStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeSceneStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const sceneId = requireRouteParameter(c, "sceneId", "Scene not found");

    const member = requireProjectMember(c);
    const input = SceneDtoMapper.toChangeSceneStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.sceneService.changeSceneStatus(
      projectId,
      sceneId,
      input,
    );
    const response = SceneDtoMapper.toSceneResponse(detail);
    const validatedResponse = sceneResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteScene(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const sceneId = requireRouteParameter(c, "sceneId", "Scene not found");

    const member = requireProjectMember(c);

    await this.sceneService.deleteScene(projectId, sceneId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createSceneController({
  sceneService,
}: {
  sceneService: SceneService;
}): SceneController {
  return new SceneController(sceneService);
}
