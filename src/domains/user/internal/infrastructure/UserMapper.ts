import { User, type UserProperties } from "../domain/User.js";

export function toUserDomain(row: UserProperties): User {
  return User.reconstitute(row);
}

export function toUserPersistence(user: User) {
  const s = user.toSnapshot();
  return {
    email: s.email,
    username: s.username,
    passwordHash: s.passwordHash,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    status: s.status,
    emailVerifiedAt: s.emailVerifiedAt,
    lastLoginAt: s.lastLoginAt,
  };
}
