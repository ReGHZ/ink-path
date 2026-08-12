import { Scene, type SceneProperties } from "../../domain/story/Scene.js";

import type {
    Scene as PrismaScene,
    Prisma,
} from "../../../../../generated/prisma/client.js";

export const SceneMapper = {
    toDomain(row: PrismaScene): Scene {
        const props: SceneProperties = {
            id: row.id,
            version: row.version,
            projectId: row.projectId,
            createdByUserId: row.createdByUserId,
            chapterId: row.chapterId,
            title: row.title,
            summary: row.summary,
            content: row.content,
            orderInChapter: row.orderInChapter,
            status: row.status,
            currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };

        return Scene.reconstitute(props);
    },

    toPersistence(scene: Scene): Prisma.SceneUncheckedCreateInput {
        const snapshot = scene.toSnapshot();

        return {
            projectId: snapshot.projectId,
            createdByUserId: snapshot.createdByUserId,
            chapterId: snapshot.chapterId,
            title: snapshot.title,
            summary: snapshot.summary,
            content: snapshot.content,
            orderInChapter: snapshot.orderInChapter,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
        };
    },

    toCreatePersistence(scene: Scene): Prisma.SceneUncheckedCreateInput {
        return {
            ...this.toPersistence(scene),
            currentRevisionId: null,
        };
    },

    // `chapterId` is absent here on purpose, alongside the usual immutable
    // `projectId`/`createdByUserId`: the entity exposes no way to move a scene
    // to another chapter (`UpdateSceneDetailsProperties`, `Scene.ts:36-42`, has
    // no chapterId), so persisting it on update could only ever write back the
    // value it already holds — or silently enable a re-parent the domain never
    // sanctioned. Moving scenes between chapters is a distinct operation that
    // needs its own domain method first.
    toUpdatePersistence(scene: Scene): Prisma.SceneUncheckedUpdateManyInput {
        const snapshot = scene.toSnapshot();

        return {
            title: snapshot.title,
            summary: snapshot.summary,
            content: snapshot.content,
            orderInChapter: snapshot.orderInChapter,
            status: snapshot.status,
            currentRevisionId: snapshot.currentRevisionId,
            updatedAt: snapshot.updatedAt,
            version: { increment: 1 },
        };
    },
};
