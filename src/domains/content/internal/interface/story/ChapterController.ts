import {
  requireProjectId,
  requireProjectMember,
  requireRouteParameter,
  requireUserId,
  type AppEnvironment,
} from "../../../../../shared/http/context.js";
import { parseJsonBody } from "../../../../../shared/http/requestValidation.js";
import { success } from "../../../../../shared/http/response.js";
import { changeChapterStatusSchema } from "../dto/story/changeChapterStatusSchema.js";
import {
  chapterListResponseSchema,
  chapterResponseSchema,
} from "../dto/story/chapterResponseSchema.js";
import {
  createChapterResponseSchema,
  createChapterSchema,
} from "../dto/story/createChapterSchema.js";
import { updateChapterSchema } from "../dto/story/updateChapterSchema.js";
import { ChapterDtoMapper } from "../mappers/story/ChapterDtoMapper.js";

import type { ChapterService } from "../../application/story/ChapterService.js";
import type { Context } from "hono";

export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  async createChapter(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, createChapterSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);

    const member = requireProjectMember(c);
    const input = ChapterDtoMapper.toCreateChapterInput(
      dto,
      userId,
      projectId,
      {
        role: member.role,
        canDelete: member.canDelete,
      },
    );

    const result = await this.chapterService.createChapter(input);
    const response = ChapterDtoMapper.toCreateChapterResponse(result.chapterId);
    const validatedResponse = createChapterResponseSchema.parse(response);

    return success(c, validatedResponse, 201);
  }

  async getChapter(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const detail = await this.chapterService.getChapterById(
      projectId,
      chapterId,
    );
    const response = ChapterDtoMapper.toChapterResponse(detail);
    const validatedResponse = chapterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async listChapters(c: Context<AppEnvironment>) {
    const projectId = requireProjectId(c);

    const details = await this.chapterService.listChaptersByProject(projectId);
    const response = ChapterDtoMapper.toChapterListResponse(details);
    const validatedResponse = chapterListResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async updateChapter(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, updateChapterSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const member = requireProjectMember(c);
    const input = ChapterDtoMapper.toUpdateChapterInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.chapterService.updateChapter(
      projectId,
      chapterId,
      input,
    );
    const response = ChapterDtoMapper.toChapterResponse(detail);
    const validatedResponse = chapterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  // The single endpoint behind all five Flow 5 edges. Only the target status arrives
  // here; ChapterService reads the stored origin and resolves the PAIR, because two
  // different edges land on `draft` (review->draft = revision request, published->draft
  // = unpublish) and the target alone cannot tell them apart.
  async changeChapterStatus(c: Context<AppEnvironment>) {
    const dto = await parseJsonBody(c, changeChapterStatusSchema);
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const member = requireProjectMember(c);
    const input = ChapterDtoMapper.toChangeChapterStatusInput(dto, userId, {
      role: member.role,
      canDelete: member.canDelete,
    });

    const detail = await this.chapterService.changeChapterStatus(
      projectId,
      chapterId,
      input,
    );
    const response = ChapterDtoMapper.toChapterResponse(detail);
    const validatedResponse = chapterResponseSchema.parse(response);

    return success(c, validatedResponse);
  }

  async deleteChapter(c: Context<AppEnvironment>) {
    const userId = requireUserId(c);
    const projectId = requireProjectId(c);
    const chapterId = requireRouteParameter(
      c,
      "chapterId",
      "Chapter not found",
    );

    const member = requireProjectMember(c);

    await this.chapterService.deleteChapter(projectId, chapterId, {
      requestingUserId: userId,
      requestingMembership: {
        role: member.role,
        canDelete: member.canDelete,
      },
    });

    return success(c, null, 200);
  }
}

export function createChapterController({
  chapterService,
}: {
  chapterService: ChapterService;
}): ChapterController {
  return new ChapterController(chapterService);
}
