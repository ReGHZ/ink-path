import { PlotMapper } from "./PlotMapper.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  PlotRepositoryConflictError,
  PlotRepositoryNotFoundError,
  PlotRepositoryReferencedError,
} from "../../domain/story/PlotRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Plot } from "../../domain/story/Plot.js";
import type { PlotRepository } from "../../domain/story/PlotRepository.js";

export type PlotDatabase = Pick<PrismaClient, "plot">;

// Like `events`, `plots` has no user-supplied FK — no parent, no composite
// unique index. A P2003 on insert/update therefore signals a higher-layer bug
// and is left to surface raw.
export class PrismaPlotRepository implements PlotRepository {
  constructor(private readonly client: PlotDatabase) { }

  async findById(id: string): Promise<Plot | null> {
    const row = await this.client.plot.findUnique({
      where: { id },
    });

    return row ? PlotMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<Plot[]> {
    const rows = await this.client.plot.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => PlotMapper.toDomain(row));
  }

  async insert(plot: Plot): Promise<void> {
    try {
      await this.client.plot.create({
        data: {
          id: plot.id,
          ...PlotMapper.toCreatePersistence(plot),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PlotRepositoryConflictError();
      }

      throw error;
    }
  }

  async update(plot: Plot): Promise<void> {
    const result = await this.client.plot.updateMany({
      where: {
        id: plot.id,
        version: plot.version,
      },
      data: PlotMapper.toUpdatePersistence(plot),
    });

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.plot.findUnique({
      where: { id: plot.id },
      select: { id: true },
    });

    if (!existing) {
      throw new PlotRepositoryNotFoundError();
    }

    throw new PlotRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.plot.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new PlotRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.plot.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new PlotRepositoryNotFoundError();
    }

    throw new PlotRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4). See PrismaEventRepository.linkRevision().
  async linkRevision(
    id: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<void> {
    const result = await this.client.plot.updateMany({
      where: {
        id,
        version: expectedVersion,
        currentRevisionId: null,
      },
      data: {
        currentRevisionId: revisionId,
      },
    });

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.plot.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new PlotRepositoryNotFoundError();
    }

    throw new PlotRepositoryConflictError();
  }
}

export function createPlotRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): PlotRepository {
  return new PrismaPlotRepository(prisma);
}
