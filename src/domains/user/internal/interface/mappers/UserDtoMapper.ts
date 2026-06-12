import type {
  UpdateProfileInput,
  UserProfile,
} from "../../application/UserService.js";
import type { UpdateProfileRequestDto } from "../dto/updateProfileSchema.js";
import type { UserProfileResponseDto } from "../dto/userProfileResponseSchema.js";

export const UserDtoMapper = {
  toUpdateProfileInput(dto: UpdateProfileRequestDto): UpdateProfileInput {
    return {
      displayName: dto.displayName,
      avatarUrl: dto.avatarUrl,
    };
  },

  toProfileResponse(profile: UserProfile): UserProfileResponseDto {
    return {
      id: profile.id,
      email: profile.email,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    };
  },
};
