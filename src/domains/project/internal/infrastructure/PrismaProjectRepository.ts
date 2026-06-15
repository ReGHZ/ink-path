import { ProjectMapper } from "./ProjectMapper.js";
import {
    isNotFoundError,
    isUniqueViolation,
} from "../../../../shared/infrastructure/prismaErrors.js";
import {
    ProjectRepositoryConflictError,
    ProjectRepositoryNotFoundError,
} from "../domain/ProjectRepositoryError.js";

import type { PrismaClient } from "../../../../generated/prisma/client.js";
import type { Project } from "../domain/Project.js";
import type { ProjectRepository } from "../domain/ProjectRepository.js";

export type ProjectDatabase = Pick<PrismaClient, "project">;

export class PrismaProjectRepository implements ProjectRepository {
    constructor(private readonly client: ProjectDatabase) { }

    async findById(id: string): Promise<Project | null> {
        const row = await this.client.project.findUnique({
            where: {
                id,
            },
        });

        return row ? ProjectMapper.toDomain(row) : null;
    }

    async findByOwnerUserId(ownerUserId: string): Promise<Project[]> {
        const rows = await this.client.project.findMany({
            where: {
                ownerUserId,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        return rows.map((row) => ProjectMapper.toDomain(row));
    }

    async insert(project: Project): Promise<void> {
        try {
            await this.client.project.create({
                data: {
                    id: project.id,
                    ...ProjectMapper.toPersistence(project),
                },
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ProjectRepositoryConflictError();
            }

            throw error;
        }
    }

    async update(project: Project): Promise<void> {
        try {
            await this.client.project.update({
                where: {
                    id: project.id,
                },
                data: ProjectMapper.toPersistence(project),
            });
        } catch (error) {
            if (isNotFoundError(error)) {
                throw new ProjectRepositoryNotFoundError();
            }

            throw error;
        }
    }
}

export function createProjectRepository({
    prisma,
}: {
    prisma: PrismaClient;
}): ProjectRepository {
    return new PrismaProjectRepository(prisma);
}
