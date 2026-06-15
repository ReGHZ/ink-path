import { UserProjectMapper } from "./UserProjectMapper.js";
import { isNotFoundError, isUniqueViolation } from "../../../../shared/infrastructure/prismaErrors.js";
import { UserProjectRepositoryConflictError, UserProjectRepositoryNotFoundError } from "../domain/UserProjectRepositoryError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { UserProject } from "../domain/UserProject.js";
import type { UserProjectRepository } from "../domain/UserProjectRepository.js";


export type UserProjectDatabase = Pick<PrismaClient, "userProject">

export class PrismaUserProjectRepository implements UserProjectRepository {
    constructor(private readonly client: UserProjectDatabase) { }

    async findActiveByProjectIdAndUserId(projectId: string, userId: string): Promise<UserProject | null> {
        const row = await this.client.userProject.findFirst({
            where: {
                projectId,
                userId,
                status: "active"
            }
        })

        return row ? UserProjectMapper.toDomain(row) : null
    }

    async findActiveByProjectId(projectId: string): Promise<UserProject[]> {
        const rows = await this.client.userProject.findMany({
            where: {
                projectId,
                status: "active"
            },
            orderBy: {
                joinedAt: 'asc'
            }
        })

        return rows.map((row) => UserProjectMapper.toDomain(row))
    }

    async insert(userProject: UserProject): Promise<void> {
        try {
            await this.client.userProject.create({
                data: {
                    id: userProject.id,
                    ...UserProjectMapper.toPersistence(userProject)
                }
            })
        } catch (error) {

            if (isUniqueViolation(error)) {
                throw new UserProjectRepositoryConflictError()
            }
            throw error
        }
    }

    async update(userProject: UserProject): Promise<void> {
        try {
            await this.client.userProject.update({
                where: {
                    id: userProject.id
                },
                data: UserProjectMapper.toPersistence(userProject)
            })
        } catch (error) {
            if (isNotFoundError(error)) {
                throw new UserProjectRepositoryNotFoundError()
            }
            throw error

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