import { User, type UserProperties } from "../domain/User.js";

import type {
  User as PrismaUser,
  Prisma,
} from "../../../../generated/prisma/client.js";

export const UserMapper = {
  toDomain(row: PrismaUser): User {
    const props: UserProperties = {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.passwordHash,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return User.reconstitute(props);
  },

  toPersistence(user: User): Prisma.UserUncheckedCreateInput {
    const snapshot = user.toSnapshot();

    return {
      email: snapshot.email,
      username: snapshot.username,
      passwordHash: snapshot.passwordHash,
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      status: snapshot.status,
      emailVerifiedAt: snapshot.emailVerifiedAt,
      lastLoginAt: snapshot.lastLoginAt,
    };
  },
};
