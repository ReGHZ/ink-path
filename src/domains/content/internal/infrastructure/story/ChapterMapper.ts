import { Chapter, type ChapterProperties } from "../../domain/story/Chapter.js";

import type {
    Chapter as PrismaChapter,
    Prisma,
} from "../../../../../generated/prisma/client.js";

export const ChapterMapper = {
    toDomain(row: PrismaChapter): Chapter {
        const props: ChapterProperties = {
            id: row.id,
            version: row.version,
            projectId: row.projectId,
            createdByUserId: row.createdByUserId,
            title: row.title,
            order: row.order,
            summary: row.summary,
            content: row.content,
            status: row.status,
            publishedAt: row.publishedAt,
            currentRevisionId: row.currentRevisionId ?? "", // Force Entity validation if a required DB value is unexpectedly null.
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };

        return Chapter.reconstitute(props);
    },

    toPersistence(chapter: Chapter): Prisma.ChapterUncheckedCreateInput {
        const snapshot = chapter.toSnapshot();

        return {
            projectId: snapshot.projectId,
            createdByUserId: snapshot.createdByUserId,
            title: snapshot.title,
            order: snapshot.order,
            summary: snapshot.summary,
            content: snapshot.content,
            status: snapshot.status,
            publishedAt: snapshot.publishedAt,
            currentRevisionId: snapshot.currentRevisionId,
        };
    },

    toCreatePersistence(chapter: Chapter): Prisma.ChapterUncheckedCreateInput {
        return {
            ...this.toPersistence(chapter),
            currentRevisionId: null,
        };
    },

    // `publishedAt` IS included: it is a side effect of publish()/unpublish()
    // (Flow 5 transitions 3 and 5), so it moves with `status` on update. The
    // entity keeps them consistent — validate() rejects any snapshot where one
    // is set without the other.
    toUpdatePersistence(chapter: Chapter): Prisma.ChapterUncheckedUpdateManyInput {
        const snapshot = chapter.toSnapshot();

        return {
            title: snapshot.title,
            order: snapshot.order,
            summary: snapshot.summary,
            content: snapshot.content,
            status: snapshot.status,
            publishedAt: snapshot.publishedAt,
            currentRevisionId: snapshot.currentRevisionId,
            updatedAt: snapshot.updatedAt,
            version: { increment: 1 },
        };
    },
};
