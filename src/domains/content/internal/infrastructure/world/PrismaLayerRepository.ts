import { LayerMapper } from "./LayerMapper.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
  extractForeignKeyConstraint,
} from "../../../../../shared/infrastructure/prismaErrors.js";
import {
  LayerRepositoryConflictError,
  LayerRepositoryNotFoundError,
  LayerRepositoryReferencedError,
  LayerRepositoryParentNotFoundError,
} from "../../domain/world/LayerRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { Layer } from "../../domain/world/Layer.js";
import type { LayerRepository } from "../../domain/world/LayerRepository.js";

export type LayerDatabase = Pick<PrismaClient, "layer">;

// FK constraint name for the `parentId` self-reference (`"LayerHierarchy"`,
// `onDelete: Restrict`). VERIFIED empirically against Postgres 17 / Prisma 7.8.0
// (probe 2026-07-15): this is the exact string carried in
// `error.meta.driverAdapterError.cause.constraint.index` when a P2003 fires on
// the parent FK. Keeping it as a module constant localizes the schema coupling
// (`@@map("layers")` + `@map("parent_id")`) in one place; if the column/table
// is ever renamed, update this single constant and re-run the integration test.
//
// Non-parent FKs (`layers_project_id_fkey`, `layers_created_by_user_id_fkey`,
// `layers_current_revision_id_fkey`) are intentionally NOT matched: per the
// Opsi B + default-to-raw decision, a P2003 from those indicates a bug in a
// higher layer (unvalidated context, broken Improvement-Rule ordering), not
// user input, so it must surface raw with its real constraint name rather than
// be mistranslated. Only `parentId` is genuine raw user input (Domain treats it
// as an opaque token and delegates existence to this FK).
const LAYER_PARENT_FK = "layers_parent_id_fkey";

export class PrismaLayerRepository implements LayerRepository {
  constructor(private readonly client: LayerDatabase) { }

  async findById(id: string): Promise<Layer | null> {
    const row = await this.client.layer.findUnique({
      where: { id },
    });

    return row ? LayerMapper.toDomain(row) : null;
  }

  async findByProjectId(projectId: string): Promise<Layer[]> {
    const rows = await this.client.layer.findMany({
      where: {
        projectId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return rows.map((row) => LayerMapper.toDomain(row));
  }

  async insert(layer: Layer): Promise<void> {
    try {
      await this.client.layer.create({
        data: {
          id: layer.id,
          ...LayerMapper.toCreatePersistence(layer),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new LayerRepositoryConflictError();
      }
      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === LAYER_PARENT_FK
      ) {
        throw new LayerRepositoryParentNotFoundError();
      }
      throw error;
    }
  }

  async update(layer: Layer): Promise<void> {
    let result;
    try {
      result = await this.client.layer.updateMany({
        where: {
          id: layer.id,
          version: layer.version,
        },
        data: LayerMapper.toUpdatePersistence(layer),
      });
    } catch (error) {
      if (
        isForeignKeyViolation(error) &&
        extractForeignKeyConstraint(error) === LAYER_PARENT_FK
      ) {
        throw new LayerRepositoryParentNotFoundError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    const existing = await this.client.layer.findUnique({
      where: { id: layer.id },
      select: { id: true },
    });

    if (!existing) {
      throw new LayerRepositoryNotFoundError();
    }

    throw new LayerRepositoryConflictError();
  }

  async delete(id: string, expectedVersion: number): Promise<void> {
    let result;
    try {
      result = await this.client.layer.deleteMany({
        where: {
          id,
          version: expectedVersion,
        },
      });
    } catch (error) {
      // On delete, every P2003 means the same thing: an inbound
      // `onDelete: Restrict` FK is blocking removal because a third row
      // still points at this layer (child via `layers_parent_id_fkey`
      // today; `comment_target_layers_layer_id_fkey` once the Feedback
      // domain exists; any future Restrict FK likewise). Unlike
      // insert/update, P2003 here is not overloaded — there is no
      // "referent missing" reading on delete and no bug-signal FK — so we
      // translate any FK violation to ReferencedError without matching
      // the constraint name. `extractForeignKeyConstraint` is only
      // needed on insert/update, where P2003 is ambiguous and only the
      // parent FK is a legitimate user-facing failure.
      if (isForeignKeyViolation(error)) {
        throw new LayerRepositoryReferencedError();
      }

      throw error;
    }

    if (result.count === 1) {
      return;
    }

    // count === 0 is ambiguous the same way it is in update(): either the
    // row is already gone, or it still exists at a different version.
    const existing = await this.client.layer.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new LayerRepositoryNotFoundError();
    }

    throw new LayerRepositoryConflictError();
  }

  // Create-flow only (policy 06 §4, currentRevisionId circular dependency):
  // sets currentRevisionId after content_revisions has been inserted in the
  // same transaction. WHERE requires currentRevisionId: null so this is
  // mechanically impossible to call outside the create-flow — any row that
  // already has one falls into the ambiguous count===0 path as a Conflict.
  // No version bump: completing create is not a discrete edit (policy 06 §3
  // no-op rule), so a freshly created, never-edited row must still read
  // version === 0 after this call.
  async linkRevision(id: string, revisionId: string, expectedVersion: number): Promise<void> {
    const result = await this.client.layer.updateMany({
      where: {
        id,
        version: expectedVersion,
        currentRevisionId: null
      },
      data: {
        currentRevisionId: revisionId
      }
    })

    if (result.count === 1) {
      return
    }

    const existing = await this.client.layer.findUnique({
      where: { id },
      select: { id: true }
    })

    if (!existing) {
      throw new LayerRepositoryNotFoundError()
    }

    throw new LayerRepositoryConflictError()
  }
}

export function createLayerRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): LayerRepository {
  return new PrismaLayerRepository(prisma);
}
