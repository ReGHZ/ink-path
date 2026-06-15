import { PrismaProjectRepository } from "./PrismaProjectRepository.js";
import { PrismaUserProjectRepository } from "./PrismaUserProjectRepository.js";
import {
    Prisma,
    type PrismaClient,
} from "../../../../generated/prisma/client.js";

import type {
    ProjectRepositories,
    ProjectUnitOfWork,
} from "../application/ports/ProjectUnitOfWork.js";

export class PrismaProjectUnitOfWork implements ProjectUnitOfWork {
    constructor(private readonly client: PrismaClient) { }

    async transaction<T>(
        work: (repositories: ProjectRepositories) => Promise<T>,
    ): Promise<T> {
        return this.client.$transaction(
            async (tx) => {
                return work({
                    projects: new PrismaProjectRepository(tx),
                    userProjects: new PrismaUserProjectRepository(tx),
                });
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            },
        );
    }
}

export function createProjectUnitOfWork({
    prisma,
}: {
    prisma: PrismaClient;
}): ProjectUnitOfWork {
    return new PrismaProjectUnitOfWork(prisma);
}
