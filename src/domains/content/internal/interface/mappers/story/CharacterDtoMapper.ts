import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeCharacterStatusInput,
  CharacterDetail,
  CreateCharacterInput,
  UpdateCharacterInput,
} from "../../../application/story/CharacterService.js";
import type { ChangeCharacterStatusRequestDto } from "../../dto/story/changeCharacterStatusSchema.js";
import type {
  CharacterListResponseDto,
  CharacterResponseDto,
} from "../../dto/story/characterResponseSchema.js";
import type {
  CreateCharacterRequestDto,
  CreateCharacterResponseDto,
} from "../../dto/story/createCharacterSchema.js";
import type { UpdateCharacterRequestDto } from "../../dto/story/updateCharacterSchema.js";

// Bridges DTO <-> the Input/Output types CharacterService.ts already defines —
// never touches the Character domain entity directly (mirrors WorldElementDtoMapper.ts).
export const CharacterDtoMapper = {
  toCreateCharacterInput(
    dto: CreateCharacterRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateCharacterInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      name: dto.name,
      archetype: dto.archetype,
      background: dto.background,
      personality: dto.personality,
      goal: dto.goal,
      description: dto.description,
      content: dto.content,
    };
  },

  toCreateCharacterResponse(characterId: string): CreateCharacterResponseDto {
    return { characterId };
  },

  toCharacterResponse(detail: CharacterDetail): CharacterResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      name: detail.name,
      archetype: detail.archetype,
      background: detail.background,
      personality: detail.personality,
      goal: detail.goal,
      description: detail.description,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toCharacterListResponse(
    details: CharacterDetail[],
  ): CharacterListResponseDto {
    return {
      characters: details.map((d) => CharacterDtoMapper.toCharacterResponse(d)),
    };
  },

  toUpdateCharacterInput(
    dto: UpdateCharacterRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateCharacterInput {
    return {
      requestingUserId,
      requestingMembership,
      name: dto.name,
      archetype: dto.archetype,
      background: dto.background,
      personality: dto.personality,
      goal: dto.goal,
      description: dto.description,
      content: dto.content,
    };
  },

  toChangeCharacterStatusInput(
    dto: ChangeCharacterStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeCharacterStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
