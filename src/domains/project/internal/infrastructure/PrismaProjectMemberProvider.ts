import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { ProjectMemberInfo } from "../../../../shared/http/context.js";
import type { ProjectMemberProvider } from "../interface/ProjectMemberMiddleware.js";

export type ProjectMemberDatabase = Pick<PrismaClient, "userProject">;

export class PrismaProjectMemberProvider implements ProjectMemberProvider {
  constructor(private readonly client: ProjectMemberDatabase) {}

  async getActiveMember(
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberInfo | null> {
    const row = await this.client.userProject.findFirst({
      where: {
        projectId,
        userId,
        status: "active",
      },
      select: {
        userId: true,
        role: true,
        canDelete: true,
        aiAccess: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      userId: row.userId,
      role: row.role,
      canDelete: row.canDelete,
      aiAccess: row.aiAccess,
    };
  }
}

export function createProjectMemberProvider({
  prisma,
}: {
  prisma: PrismaClient;
}): ProjectMemberProvider {
  return new PrismaProjectMemberProvider(prisma);
}
