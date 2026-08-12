import { Plot, type PlotProperties } from "../../domain/story/Plot.js";

import type {
    Plot as PrismaPlot,
    Prisma,
} from "../../../../../generated/prisma/client.js";

export const PlotMapper = {
    toDomain(row: PrismaPlot): Plot {
        const props: PlotProperties = {
            id: row.id,
            version: row.version,
            projectId: row.projectId,
            createdByUserId: row.createdByUserId,
            name: row.name,
            description: row.description,
            theme: row.theme,
            conflict: row.conflict,
            resolution: row.resolution,
            content: row.content,
            status: row.status,
            currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };

        return Plot.reconstitute(props);
    },

    toPersistence(plot: Plot): Prisma.PlotUncheckedCreateInput {
        const snapshot = plot.toSnapshot();

        return {
            projectId: snapshot.projectId,
            createdByUserId: snapshot.createdByUserId,
            name: snapshot.name,
            description: snapshot.description,
            theme: snapshot.theme,
            conflict: snapshot.conflict,
            resolution: snapshot.resolution,
            content: snapshot.content,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
        };
    },

    toCreatePersistence(plot: Plot): Prisma.PlotUncheckedCreateInput {
        return {
            ...this.toPersistence(plot),
            currentRevisionId: null,
        };
    },

    toUpdatePersistence(plot: Plot): Prisma.PlotUncheckedUpdateManyInput {
        const snapshot = plot.toSnapshot();

        return {
            name: snapshot.name,
            description: snapshot.description,
            theme: snapshot.theme,
            conflict: snapshot.conflict,
            resolution: snapshot.resolution,
            content: snapshot.content,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
            updatedAt: snapshot.updatedAt,
            version: { increment: 1 },
        };
    },
};
