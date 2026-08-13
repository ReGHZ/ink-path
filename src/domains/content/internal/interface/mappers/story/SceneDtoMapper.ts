import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeSceneStatusInput,
  CreateSceneInput,
  SceneDetail,
  UpdateSceneInput,
} from "../../../application/story/SceneService.js";
import type { ChangeSceneStatusRequestDto } from "../../dto/story/changeSceneStatusSchema.js";
import type {
  CreateSceneRequestDto,
  CreateSceneResponseDto,
} from "../../dto/story/createSceneSchema.js";
import type {
  SceneListResponseDto,
  SceneResponseDto,
} from "../../dto/story/sceneResponseSchema.js";
import type { UpdateSceneRequestDto } from "../../dto/story/updateSceneSchema.js";

// Bridges DTO <-> the Input/Output types SceneService.ts already defines — never touches
// the Scene domain entity directly.
export const SceneDtoMapper = {
  // Takes `chapterId` as its own parameter, alongside `projectId`: both are route params
  // for the nested collection endpoint, not body fields (see createSceneSchema.ts).
  toCreateSceneInput(
    dto: CreateSceneRequestDto,
    requestingUserId: string,
    projectId: string,
    chapterId: string,
    requestingMembership: ProjectMembership,
  ): CreateSceneInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      chapterId,
      orderInChapter: dto.orderInChapter,
      title: dto.title,
      summary: dto.summary,
      content: dto.content,
    };
  },

  toCreateSceneResponse(sceneId: string): CreateSceneResponseDto {
    return { sceneId };
  },

  toSceneResponse(detail: SceneDetail): SceneResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      chapterId: detail.chapterId,
      title: detail.title,
      summary: detail.summary,
      content: detail.content,
      orderInChapter: detail.orderInChapter,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toSceneListResponse(details: SceneDetail[]): SceneListResponseDto {
    return {
      scenes: details.map((d) => SceneDtoMapper.toSceneResponse(d)),
    };
  },

  // No `chapterId` — UpdateSceneInput has no such field (no re-parent operation).
  toUpdateSceneInput(
    dto: UpdateSceneRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateSceneInput {
    return {
      requestingUserId,
      requestingMembership,
      title: dto.title,
      summary: dto.summary,
      content: dto.content,
      orderInChapter: dto.orderInChapter,
    };
  },

  toChangeSceneStatusInput(
    dto: ChangeSceneStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeSceneStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
