import { AppError } from "../../../../shared/errors/AppError.js";
import { ErrorCode } from "../../../../shared/errors/ErrorCode.js";

import type { Clock } from "../../../../shared/application/ports/Clock.js";
import type { User } from "../domain/User.js";
import type { UserRepository } from "../domain/UserRepository.js";

export type UserProfile = {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type UpdateProfileInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
};

export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly clock: Clock,
  ) { }

  async getMyProfile(userId: string): Promise<UserProfile> {
    const user = await this.loadExistingUser(userId);

    return this.toProfile(user);
  }

  async updateMyProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserProfile> {
    const user = await this.loadExistingUser(userId);

    if (!this.hasActualProfileChanges(user, input)) {
      return this.toProfile(user);
    }

    user.changeProfile({
      ...input,
      now: this.clock.now(),
    });

    await this.userRepository.update(user);

    return this.toProfile(user);
  }

  private toProfile(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }

  private async loadExistingUser(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, "User not found");
    }

    if (user.status === "deleted") {
      throw new AppError(ErrorCode.NOT_FOUND, "User not found");
    }

    return user;
  }

  private hasActualProfileChanges(
    user: User,
    input: UpdateProfileInput,
  ): boolean {
    return (
      (input.displayName !== undefined &&
        input.displayName !== user.displayName) ||
      (input.avatarUrl !== undefined && input.avatarUrl !== user.avatarUrl)
    );
  }
}

export function createUserService({
  userRepository,
  clock,
}: {
  userRepository: UserRepository;
  clock: Clock;
}): UserService {
  return new UserService(userRepository, clock);
}
