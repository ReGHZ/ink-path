import type { ProjectMembership } from "../../../../../../shared/application/ports/ProjectMembership.js";
import type {
  ChangeFactionStatusInput,
  CreateFactionInput,
  FactionDetail,
  UpdateFactionInput,
} from "../../../application/story/FactionService.js";
import type { ChangeFactionStatusRequestDto } from "../../dto/story/changeFactionStatusSchema.js";
import type {
  CreateFactionRequestDto,
  CreateFactionResponseDto,
} from "../../dto/story/createFactionSchema.js";
import type {
  FactionListResponseDto,
  FactionResponseDto,
} from "../../dto/story/factionResponseSchema.js";
import type { UpdateFactionRequestDto } from "../../dto/story/updateFactionSchema.js";

// Bridges DTO <-> the Input/Output types FactionService.ts already defines —
// never touches the Faction domain entity directly (mirrors WorldElementDtoMapper.ts).
export const FactionDtoMapper = {
  toCreateFactionInput(
    dto: CreateFactionRequestDto,
    requestingUserId: string,
    projectId: string,
    requestingMembership: ProjectMembership,
  ): CreateFactionInput {
    return {
      requestingUserId,
      requestingMembership,
      projectId,
      name: dto.name,
      description: dto.description,
      background: dto.background,
      ideology: dto.ideology,
      size: dto.size,
      content: dto.content,
    };
  },

  toCreateFactionResponse(factionId: string): CreateFactionResponseDto {
    return { factionId };
  },

  toFactionResponse(detail: FactionDetail): FactionResponseDto {
    return {
      id: detail.id,
      projectId: detail.projectId,
      createdByUserId: detail.createdByUserId,
      name: detail.name,
      description: detail.description,
      background: detail.background,
      ideology: detail.ideology,
      size: detail.size,
      content: detail.content,
      status: detail.status,
      currentRevisionId: detail.currentRevisionId,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    };
  },

  toFactionListResponse(details: FactionDetail[]): FactionListResponseDto {
    return {
      factions: details.map((d) => FactionDtoMapper.toFactionResponse(d)),
    };
  },

  toUpdateFactionInput(
    dto: UpdateFactionRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): UpdateFactionInput {
    return {
      requestingUserId,
      requestingMembership,
      name: dto.name,
      description: dto.description,
      background: dto.background,
      ideology: dto.ideology,
      size: dto.size,
      content: dto.content,
    };
  },

  toChangeFactionStatusInput(
    dto: ChangeFactionStatusRequestDto,
    requestingUserId: string,
    requestingMembership: ProjectMembership,
  ): ChangeFactionStatusInput {
    return {
      requestingUserId,
      requestingMembership,
      status: dto.status,
    };
  },
};
