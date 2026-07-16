import { WorldMapMapper } from "./WorldMapMapper.js";
import { extractForeignKeyConstraint, isForeignKeyViolation, isNotFoundError, isUniqueViolation } from "../../../../../shared/infrastructure/prismaErrors.js";
import { WorldMapRepositoryConflictError, WorldMapRepositoryNotFoundError, WorldMapRepositoryParentNotFoundError, WorldMapRepositoryReferencedError } from "../../domain/world/WorldMapRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { WorldMap } from "../../domain/world/WorldMap.js";
import type { WorldMapRepository } from "../../domain/world/WorldMapRepository.js";

export type WorldMapDatabase = Pick<PrismaClient, "map">

// Same as layer
const MAP_PARENT_FK = "maps_parent_id_fkey"

export class PrismaWorldMapRepository implements WorldMapRepository {
    constructor(private readonly client: WorldMapDatabase) { }

    async findById(id: string): Promise<WorldMap | null> {
        const row = await this.client.map.findUnique({
            where: { id }
        })

        return row ? WorldMapMapper.toDomain(row) : null
    }

    async findByProjectId(projectId: string): Promise<WorldMap[]> {
        const rows = await this.client.map.findMany({
            where: {
                projectId
            },
            orderBy: {
                updatedAt: 'desc'
            }
        })

        return rows.map((row) => WorldMapMapper.toDomain(row))
    }

    async insert(worldMap: WorldMap): Promise<void> {
        try {
            await this.client.map.create({
                data: {
                    id: worldMap.id,
                    ...WorldMapMapper.toPersistence(worldMap)
                }
            })
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new WorldMapRepositoryConflictError();
            }
            if (
                isForeignKeyViolation(error) &&
                extractForeignKeyConstraint(error) === MAP_PARENT_FK
            ) {
                throw new WorldMapRepositoryParentNotFoundError();
            }
            throw error;
        }
    }

    async update(worldMap: WorldMap): Promise<void> {
        try {
            await this.client.map.update({
                where: {
                    id: worldMap.id,
                },
                data: WorldMapMapper.toPersistence(worldMap)
            })
        } catch (error) {
            if (isNotFoundError(error)) {
                throw new WorldMapRepositoryNotFoundError();
            }

            if (
                isForeignKeyViolation(error) &&
                extractForeignKeyConstraint(error) === MAP_PARENT_FK
            ) {
                throw new WorldMapRepositoryParentNotFoundError();
            }

            throw error;
        }
    }

    async delete(id: string): Promise<void> {
        try {
            await this.client.map.delete({
                where: {
                    id
                }
            })
        } catch (error) {
            if (isNotFoundError(error)) {
                throw new WorldMapRepositoryNotFoundError()
            }

            // sane as layer
            if (isForeignKeyViolation(error)) {
                throw new WorldMapRepositoryReferencedError()
            }

            throw error
        }
    }
}

export function createWorldMapRepository({
    prisma,
}: {
    prisma: PrismaClient;
}): WorldMapRepository {
    return new PrismaWorldMapRepository(prisma);
}