import { UserProjectMapper } from "./UserProjectMapper.js";
import {
    isNotFoundError,
    isUniqueViolation,
} from "../../../../shared/infrastructure/prismaErrors.js";
import {
    UserProject,
    type ProjectAiAccess,
    type ProjectRole,
    type UserProjectStatus,
} from "../domain/UserProject.js";
import {
    UserProjectRepositoryConflictError,
    UserProjectRepositoryNotFoundError,
} from "../domain/UserProjectRepositoryError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { UserProjectRepository } from "../domain/UserProjectRepository.js";

export type UserProjectDatabase = Pick<PrismaClient, "userProject" | "$queryRaw">;

type RawUserProjectRow = {
    id: string;
    project_id: string;
    user_id: string;
    role: ProjectRole;
    can_delete: boolean;
    ai_access: ProjectAiAccess;
    status: UserProjectStatus;
    invited_by_user_id: string | null;
    joined_at: Date | null;
    removed_at: Date | null;
    created_at: Date;
    updated_at: Date;
};

export class PrismaUserProjectRepository implements UserProjectRepository {
    constructor(private readonly client: UserProjectDatabase) { }

    async findActiveByProjectIdAndUserId(
        projectId: string,
        userId: string,
    ): Promise<UserProject | null> {
        const row = await this.client.userProject.findFirst({
            where: {
                projectId,
                userId,
                status: "active",
            },
        });

        return row ? UserProjectMapper.toDomain(row) : null;
    }

    async findActiveByProjectIdAndUserIdForUpdate(
        projectId: string,
        userId: string,
    ): Promise<UserProject | null> {
        const rows = await this.client.$queryRaw<RawUserProjectRow[]>`
            SELECT id, project_id, user_id, role, can_delete, ai_access, status,
                   invited_by_user_id, joined_at, removed_at, created_at, updated_at
            FROM user_projects
            WHERE project_id = ${projectId}::uuid
              AND user_id = ${userId}::uuid
              AND status = 'active'
            FOR UPDATE
            LIMIT 1
        `;

        const row = rows[0];

        if (!row) {
            return null;
        }

        return UserProject.reconstitute({
            id: row.id,
            projectId: row.project_id,
            userId: row.user_id,
            role: row.role,
            canDelete: row.can_delete,
            aiAccess: row.ai_access,
            status: row.status,
            invitedByUserId: row.invited_by_user_id,
            joinedAt: row.joined_at,
            removedAt: row.removed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    }

    async findActiveByProjectId(projectId: string): Promise<UserProject[]> {
        const rows = await this.client.userProject.findMany({
            where: {
                projectId,
                status: "active",
            },
            orderBy: {
                joinedAt: "asc",
            },
        });

        return rows.map((row) => UserProjectMapper.toDomain(row));
    }

    async insert(userProject: UserProject): Promise<void> {
        try {
            await this.client.userProject.create({
                data: {
                    id: userProject.id,
                    ...UserProjectMapper.toPersistence(userProject),
                },
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new UserProjectRepositoryConflictError();
            }
            throw error;
        }
    }

    async update(userProject: UserProject): Promise<void> {
        try {
            await this.client.userProject.update({
                where: {
                    id: userProject.id,
                },
                data: UserProjectMapper.toPersistence(userProject),
            });
        } catch (error) {
            if (isNotFoundError(error)) {
                throw new UserProjectRepositoryNotFoundError();
            }
            throw error;
        }
    }
}

export function createUserProjectRepository({
    prisma,
}: {
    prisma: PrismaClient;
}): UserProjectRepository {
    return new PrismaUserProjectRepository(prisma);
}
