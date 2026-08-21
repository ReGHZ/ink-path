import { ContentRelationshipMapper } from "./ContentRelationshipMapper.js";
import {
  isUniqueViolation,
  matchesUniqueConstraint,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  ContentRelationshipRepositoryConflictError,
  ContentRelationshipRepositoryDuplicateError,
  ContentRelationshipRepositoryNotFoundError,
} from "../../domain/support/ContentRelationshipRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { ContentRelationship } from "../../domain/support/ContentRelationship.js";
import type { ContentRelationshipRepository } from "../../domain/support/ContentRelationshipRepository.js";
import type { ContentEntityType } from "../../domain/support/ContentRevision.js";

export type ContentRelationshipDatabase = Pick<
  PrismaClient,
  "contentRelationship"
>;

// Columns of the natural-identity index
// `@@unique([projectId, relationType, sourceEntityType, sourceEntityId,
// targetEntityType, targetEntityId])` (`content-support.prisma:74`). DATABASE
// column names, because that is what a P2002 reports — see the note on
// extractUniqueConstraintColumns (`shared/infrastructure/prismaErrors.ts:111-132`).
const RELATIONSHIP_IDENTITY_UNIQUE = [
  "project_id",
  "relation_type",
  "source_entity_type",
  "source_entity_id",
  "target_entity_type",
  "target_entity_id",
] as const;

export class PrismaContentRelationshipRepository
  implements ContentRelationshipRepository
{
  constructor(private readonly client: ContentRelationshipDatabase) { }

  async findById(id: string): Promise<ContentRelationship | null> {
    const row = await this.client.contentRelationship.findUnique({
      where: { id },
    });

    return row ? ContentRelationshipMapper.toDomain(row) : null;
  }

  async findByEntity(
    projectId: string,
    entityType: ContentEntityType,
    entityId: string,
  ): Promise<ContentRelationship[]> {
    const rows = await this.client.contentRelationship.findMany({
      where: {
        // `projectId` sits OUTSIDE the OR on purpose: inside it, each branch
        // would have to repeat it, and one forgotten repetition would leak
        // another tenant's rows through that branch alone. Both
        // `(project_id, source_*)` and `(project_id, target_*)` are indexed
        // (`content-support.prisma:76-77`).
        projectId,
        // Both sides in ONE query — the entity can sit on either end of the row,
        // and Flow 4 §Read Relation ("Read: kedua sisi") requires the faction to
        // see the characters pointing at it as well as the ones it points at.
        OR: [
          { sourceEntityType: entityType, sourceEntityId: entityId },
          { targetEntityType: entityType, targetEntityId: entityId },
        ],
      },
      // Contract of the port, not an adapter preference: `createdAt` asc with
      // `id` asc as tie-break, so the list is stable across calls and
      // reproducible in tests. `createdAt` alone is not total — rows written
      // inside one transaction can share a timestamp.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ContentRelationshipMapper.toDomain(row));
  }

  async insert(contentRelationship: ContentRelationship): Promise<void> {
    try {
      await this.client.contentRelationship.create({
        data: {
          id: contentRelationship.id,
          ...ContentRelationshipMapper.toPersistence(contentRelationship),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The natural-identity index is the ENTIRE duplicate check: the domain
        // canonicalises non-directional endpoints, so `A↔B` and `B↔A` collide
        // here and no read-before-write is needed (Flow 4 step 8, superseded
        // 2026-08-14). Any OTHER unique violation — in practice a collision on
        // the primary key — is not a duplicate relationship the user can act on
        // but a transient anomaly, so it stays a plain Conflict, exactly as
        // PrismaSceneRepository splits its order index from the rest
        // (`../story/PrismaSceneRepository.ts:70-74`).
        throw matchesUniqueConstraint(error, RELATIONSHIP_IDENTITY_UNIQUE)
          ? new ContentRelationshipRepositoryDuplicateError()
          : new ContentRelationshipRepositoryConflictError();
      }

      // No P2003 branch, deliberately. Both FKs are outbound — `project_id`
      // (Restrict) and `created_by_user_id` (SetNull) — and both values come
      // from an already-authorized route context, so a missing parent is a
      // higher-layer bug that must surface raw rather than be dressed up as a
      // user-facing 404/409 (see ContentRelationshipRepositoryError.ts:46-53).
      throw error;
    }
  }

  async update(contentRelationship: ContentRelationship): Promise<void> {
    // No try/catch for a unique violation here, unlike insert(): the only
    // column this writes is `note` (plus `updated_at`/`version`), and `note` is
    // in no unique index, so P2002 is unreachable on this path. The natural
    // identity cannot be updated at all — Flow 4 §Update Relation.
    const result = await this.client.contentRelationship.updateMany({
      where: {
        id: contentRelationship.id,
        version: contentRelationship.version,
      },
      data: ContentRelationshipMapper.toUpdatePersistence(contentRelationship),
    });

    if (result.count === 1) {
      return;
    }

    await this.throwZeroRowCause(contentRelationship.id);
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    // Guarded delete, never `delete(id)` — `06_concurrency_control_policy.md:198-218`
    // (FROZEN) decided `version` AND the delete-guard together for this table:
    // it has no `content_revisions` history, so a silent overwrite is permanent,
    // and an unguarded delete would be the bypass that voids the guarantee.
    //
    // No P2003 branch: nothing points at `content_relationships` (no inbound
    // Restrict FK, no back-relation, and 7.7's `assertions` stores
    // endpoints rather than a FK to a relationship row), so a delete cannot be
    // blocked by a referent — which is why this port has no ReferencedError.
    const result = await this.client.contentRelationship.deleteMany({
      where: {
        id,
        version: expectedVersion,
      },
    });

    if (result.count === 1) {
      return;
    }

    await this.throwZeroRowCause(id);
  }

  // A guarded write that matched 0 rows is ambiguous, and the two meanings get
  // different HTTP answers (Flow 4 §Update/§Delete error paths): the row is
  // gone → 404, or the row is still there under a different version → 409. Same
  // second lookup PrismaSceneRepository performs
  // (`../story/PrismaSceneRepository.ts:125-134`), shared here because update()
  // and delete() need the identical split.
  private async throwZeroRowCause(id: string): Promise<never> {
    const existing = await this.client.contentRelationship.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new ContentRelationshipRepositoryNotFoundError();
    }

    throw new ContentRelationshipRepositoryConflictError();
  }
}

export function createContentRelationshipRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): ContentRelationshipRepository {
  return new PrismaContentRelationshipRepository(prisma);
}
