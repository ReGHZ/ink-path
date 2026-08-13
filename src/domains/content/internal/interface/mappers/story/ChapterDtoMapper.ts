import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeChapterStatusInput,
  ChapterDetail,
  CreateChapterInput,
  UpdateChapterInput,
} from "../../../application/story/ChapterService.js";
import type { ChangeChapterStatusRequestDto } from "../../dto/story/changeChapterStatusSchema.js";
import type {
  ChapterListResponseDto,
  ChapterResponseDto,
} from "../../dto/story/chapterResponseSchema.js";
import type {
  CreateChapterRequestDto,
  CreateChapterResponseDto,
} from "../../dto/story/createChapterSchema.js";
import type { UpdateChapterRequestDto } from "../../dto/story/updateChapterSchema.js";

// Bridges DTO <-> the Input/Output types ChapterService.ts already defines — never touches
// the Chapter domain entity directly.
export const ChapterDtoMapper = {
  toCreateChapterInput(
    dto: CreateChapterRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateChapterInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      title: dto.title,
      order: dto.order,
      summary: dto.summary,
      content: dto.content,
    };
  },

  toCreateChapterResponse(chapterId: string): CreateChapterResponseDto {
    return { chapterId };
  },

  toChapterResponse(detail: ChapterDetail): ChapterResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      title: detail.title,
      order: detail.order,
      summary: detail.summary,
      content: detail.content,
      status: detail.status,
      publishedAt: detail.publishedAt,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toChapterListResponse(details: ChapterDetail[]): ChapterListResponseDto {
    return {
      chapters: details.map((d) => ChapterDtoMapper.toChapterResponse(d)),
    };
  },

  toUpdateChapterInput(
    dto: UpdateChapterRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateChapterInput {
    return {
      requestingUserId,
      requestingMembership,
      title: dto.title,
      order: dto.order,
      summary: dto.summary,
      content: dto.content,
    };
  },

  toChangeChapterStatusInput(
    dto: ChangeChapterStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeChapterStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
