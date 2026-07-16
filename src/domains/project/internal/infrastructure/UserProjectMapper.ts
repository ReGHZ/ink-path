import {
  UserProject,
  type UserProjectProperties,
} from "../domain/UserProject.js";

import type {
  UserProject as PrismaUserProject,
  Prisma,
} from "../../../../generated/prisma/client.js";

export const UserProjectMapper = {
  toDomain(row: PrismaUserProject): UserProject {
    const props: UserProjectProperties = {
      id: row.id,
      projectId: row.projectId,
      userId: row.userId,
      role: row.role,
      canDelete: row.canDelete,
      aiAccess: row.aiAccess,
      status: row.status,
      version: row.version,
      joinedAt: row.joinedAt,
      removedAt: row.removedAt,
      invitedByUserId: row.invitedByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    return UserProject.reconstitute(props);
  },

  toPersistence(
    userProject: UserProject,
  ): Prisma.UserProjectUncheckedCreateInput {
    const snapshot = userProject.toSnapshot();

    return {
      projectId: snapshot.projectId,
      userId: snapshot.userId,
      role: snapshot.role,
      canDelete: snapshot.canDelete,
      aiAccess: snapshot.aiAccess,
      status: snapshot.status,
      joinedAt: snapshot.joinedAt,
      removedAt: snapshot.removedAt,
      invitedByUserId: snapshot.invitedByUserId,
    };
  },

  toUpdatePersistence(
    userProject: UserProject,
  ): Prisma.UserProjectUncheckedUpdateManyInput {
    const snapshot = userProject.toSnapshot();

    return {
      role: snapshot.role,
      canDelete: snapshot.canDelete,
      aiAccess: snapshot.aiAccess,
      status: snapshot.status,
      joinedAt: snapshot.joinedAt,
      removedAt: snapshot.removedAt,
      invitedByUserId: snapshot.invitedByUserId,
      updatedAt: snapshot.updatedAt,
      version: { increment: 1 },
    };
  },
};
