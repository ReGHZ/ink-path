import type { MemberDetail } from "../../application/UserProjectService.js";
import type {
  MemberListResponseDto,
  MemberResponseDto,
} from "../dto/memberResponseSchema.js";

export const UserProjectDtoMapper = {
  toMemberResponse(detail: MemberDetail): MemberResponseDto {
    return {
      id: detail.id,
      userId: detail.userId,
      role: detail.role,
      canDelete: detail.canDelete,
      aiAccess: detail.aiAccess,
      joinedAt: detail.joinedAt,
      invitedByUserId: detail.invitedByUserId,
    };
  },

  toMemberListResponse(details: MemberDetail[]): MemberListResponseDto {
    return {
      members: details.map((d) => UserProjectDtoMapper.toMemberResponse(d)),
    };
  },
};
