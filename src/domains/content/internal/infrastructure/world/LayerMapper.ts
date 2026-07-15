import { Layer, type LayerExposure, type LayerProperties } from "../../domain/world/Layer.js";

import type {
    Layer as PrismaLayer,
    Prisma,
} from "../../../../../generated/prisma/client.js";

export const LayerMapper = {
    toDomain(row: PrismaLayer): Layer {
        const props: LayerProperties = {
            id: row.id,
            projectId: row.projectId,
            createdByUserId: row.createdByUserId,
            parentId: row.parentId,
            name: row.name,
            level: row.level,
            exposure: row.exposure as LayerExposure,
            description: row.description,
            content: row.content,
            status: row.status,
            currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };

        return Layer.reconstitute(props);
    },

    toPersistence(layer: Layer): Prisma.LayerUncheckedCreateInput {
        const snapshot = layer.toSnapshot();

        return {
            projectId: snapshot.projectId,
            createdByUserId: snapshot.createdByUserId,
            parentId: snapshot.parentId,
            name: snapshot.name,
            level: snapshot.level,
            exposure: snapshot.exposure,
            description: snapshot.description,
            content: snapshot.content,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
        };
    },
};