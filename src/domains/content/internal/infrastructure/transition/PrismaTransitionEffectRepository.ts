import { TransitionEffectMapper } from "./TransitionEffectMapper.js";
import { NarrativeTransitionRepositoryNotFoundError } from "../../domain/transition/NarrativeTransitionRepositoryError.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";
import type { TransitionEffect } from "../../domain/transition/TransitionEffect.js";
import type { TransitionEffectRepository } from "../../domain/transition/TransitionEffectRepository.js";

// `$queryRaw` is part of the contract, not an escape hatch: Prisma has no
// first-class `FOR UPDATE`, and the lock is the whole mechanism apply relies on.
// A `Prisma.TransactionClient` satisfies this shape structurally, which is how
// the unit of work hands its transaction in.
export type TransitionEffectDatabase = Pick<
  PrismaClient,
  "transitionEffect" | "$queryRaw"
>;

export class PrismaTransitionEffectRepository
  implements TransitionEffectRepository
{
  constructor(private readonly client: TransitionEffectDatabase) {}

  async findById(id: string): Promise<TransitionEffect | null> {
    const row = await this.client.transitionEffect.findUnique({
      where: { id },
    });

    return row ? TransitionEffectMapper.toDomain(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<TransitionEffect | null> {
    // Two statements rather than one raw SELECT of every column: the raw query
    // takes the lock, the typed read maps the row. Mapping snake_case raw
    // columns by hand would duplicate TransitionEffectMapper and drift from it
    // the first time a column is added. Same shape the outbox dispatcher uses
    // for its claim (`src/infrastructure/outbox/outboxRepository.ts:21-31`),
    // minus SKIP LOCKED — here the second caller must WAIT and then discover
    // that `applied_at` is set, which is precisely the idempotency re-check.
    //
    // Outside a transaction this call still succeeds and still returns the row,
    // but the lock is released the instant the statement returns and the
    // guarantee is gone with no error to notice. That is why the port says it
    // must run inside one and why the unit of work is the only thing that builds
    // this repository.
    const locked = await this.client.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM transition_effects
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return null;
    }

    return this.findById(id);
  }

  async findByTransitionId(transitionId: string): Promise<TransitionEffect[]> {
    const rows = await this.client.transitionEffect.findMany({
      where: { narrativeTransitionId: transitionId },
      // Contract of the port: creation order, `id` asc as tie-break. Both bulk
      // apply and the delete guard walk this list to take their row locks, so a
      // stable order is what keeps them from deadlocking against each other.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => TransitionEffectMapper.toDomain(row));
  }

  async insert(transitionEffect: TransitionEffect): Promise<void> {
    // No P2003 translation for `narrative_transition_id`: the service loaded the
    // parent transition before building this effect, so a violation means the
    // parent was deleted mid-request — rare, and a raw 500 is the honest answer
    // rather than a 404 that implies the effect was the missing thing.
    await this.client.transitionEffect.create({
      data: {
        id: transitionEffect.id,
        ...TransitionEffectMapper.toPersistence(transitionEffect),
      },
    });
  }

  async update(transitionEffect: TransitionEffect): Promise<void> {
    const result = await this.client.transitionEffect.updateMany({
      where: { id: transitionEffect.id },
      data: TransitionEffectMapper.toUpdatePersistence(transitionEffect),
    });

    if (result.count === 0) {
      throw new NarrativeTransitionRepositoryNotFoundError();
    }
  }

  async delete(id: string): Promise<void> {
    const result = await this.client.transitionEffect.deleteMany({
      where: { id },
    });

    if (result.count === 0) {
      throw new NarrativeTransitionRepositoryNotFoundError();
    }
  }

  async deleteByTransitionId(transitionId: string): Promise<void> {
    // No count check: a transition with zero effects is a legitimate thing to
    // delete, so "no rows removed" is a normal outcome here, unlike delete(id)
    // where it means the caller named a row that is not there.
    await this.client.transitionEffect.deleteMany({
      where: { narrativeTransitionId: transitionId },
    });
  }
}

// The POOLED instance, and the service uses it for READS ONLY. Every write to
// `transition_effects` — insert included — goes through the unit of work: the
// insert runs under the aggregate-root lock so a child cannot be born inside
// `deleteTransition`'s guard window, and the rest run under this row's own
// `FOR UPDATE`.
//
// It is deliberately still the same class rather than a narrow read-only one.
// Half of this surface is meaningless on a pooled client — `findByIdForUpdate`
// most obviously — but a second class would have to duplicate every read method
// to keep the writes out of reach, and two classes over one table is how the two
// drift apart. The port documents the constraint and the unit of work is what
// satisfies it.
export function createTransitionEffectRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): TransitionEffectRepository {
  return new PrismaTransitionEffectRepository(prisma);
}
