import { Prisma, type PrismaClient } from "../../../../generated/prisma/client.js";
import {
  isTransientDatabaseError,
  isUniqueViolation,
} from "../../../../shared/infrastructure/prismaErrors.js";
import { EvaluationGraphTransientError } from "../domain/EvaluationGraphError.js";

import type {
  EvaluationGraphEndpoint,
  EvaluationGraphFact,
  EvaluationGraphRepository,
} from "../domain/EvaluationGraphRepository.js";

// Postgres side of the diegetic fold. Step 4b-4, stage A: the schema and the port
// only — the decision of WHICH log operation calls WHICH method here is stage B
// (`GraphProjector`), and the wiring is stage C.
export class PrismaEvaluationGraphRepository
  implements EvaluationGraphRepository
{
  constructor(private readonly client: PrismaClient) {}

  async upsertFact(fact: EvaluationGraphFact): Promise<void> {
    // ONE transaction for the whole fact, and not for tidiness: the edge's
    // foreign keys point at the two node rows, so a fold that committed the nodes
    // and failed on the edge would leave endpoints for a fact that is not in the
    // graph — indistinguishable, later, from an entity that genuinely has no
    // relationships.
    //
    // The failure mode under concurrency is deliberate, and stated only as far as it
    // has been verified: two folds that share an endpoint can race on
    // `(project_id, entity_id)`. Which error the loser sees is NOT claimed here —
    // Prisma compiles this shape of upsert to `INSERT … ON CONFLICT DO UPDATE`
    // (proved for the edge by mutation MA-9, whose failure names the conflict
    // specification), so the race may resolve inside the database rather than
    // surfacing at all, and under an unlucky interleaving it may surface as a
    // serialization or deadlock failure instead of a unique violation.
    //
    // What IS guaranteed is what stage C's retry policy is built on: the whole fact
    // folds in one transaction, so nothing partial lands, and the fold is idempotent
    // on the assertion id, so a redelivery re-folds it. Nothing is swallowed here —
    // deciding retryable-vs-dead-letter belongs to the consumer's classifier, which
    // can see the error, not to a catch block guessing what the winner wrote.
    try {
      await this.client.$transaction(
        async (tx) => {
          const subjectNodeId = await upsertNode(tx, fact.projectId, fact.subject);
          const objectNodeId = await upsertNode(tx, fact.projectId, fact.object);

          await tx.evaluationEdge.upsert({
            // The assertion is the identity — see the unique index in
            // `prisma/validation.prisma`. Conflicting on it is what makes a
            // redelivered event an update of the same edge rather than a second one,
            // while `assert → terminate → assert again` still yields two rows,
            // because the second assertion is a different row in the log.
            where: {
              sourceAssertionId_projectId: {
                sourceAssertionId: fact.sourceAssertionId,
                projectId: fact.projectId,
              },
            },
            create: {
              projectId: fact.projectId,
              sourceAssertionId: fact.sourceAssertionId,
              relationshipType: fact.relationshipType,
              sourceNodeId: subjectNodeId,
              targetNodeId: objectNodeId,
            },
            // Endpoints and predicate are re-stated rather than left alone: an
            // assertion is append-only, so a redelivery carries the same values and
            // this is a no-op — but if it ever does not, the log is the truth and the
            // fold has to follow it. `metadata` is untouched on purpose (§ADDENDUM
            // butir 5: non-authoritative).
            update: {
              relationshipType: fact.relationshipType,
              sourceNodeId: subjectNodeId,
              targetNodeId: objectNodeId,
            },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
    } catch (error) {
      throw translateTransient("upsertFact", error);
    }
  }

  async deleteFactBySourceAssertion(input: {
    projectId: string;
    sourceAssertionId: string;
  }): Promise<number> {
    // `deleteMany`, not `delete`: zero matches is a normal answer here (a retract
    // aimed at a `terminate`, or a redelivered retraction), and `delete` would
    // raise P2025 for it. The count is returned so the caller can log the
    // difference instead of inferring it.
    //
    // `projectId` in the filter even though `source_assertion_id` is unique on its
    // own in practice: the key this row is folded through is the composite one, and
    // a delete scoped to one tenant cannot be turned into a cross-tenant delete by
    // a caller that passes an id from somewhere else.
    //
    // The nodes are left standing. An endpoint with no edges is a node the graph
    // can still be asked about, and deleting it would cascade to the OTHER facts
    // touching that entity (`onDelete: Cascade` on both node foreign keys) —
    // retracting one fact would silently erase unrelated ones.
    try {
      const result = await this.client.evaluationEdge.deleteMany({
        where: {
          projectId: input.projectId,
          sourceAssertionId: input.sourceAssertionId,
        },
      });

      return result.count;
    } catch (error) {
      throw translateTransient("deleteFactBySourceAssertion", error);
    }
  }

  async deleteAllFactsOfProject(projectId: string): Promise<number> {
    try {
      const result = await this.client.evaluationEdge.deleteMany({
        where: { projectId },
      });

      return result.count;
    } catch (error) {
      throw translateTransient("deleteAllFactsOfProject", error);
    }
  }

  async pruneOrphanNodes(projectId: string): Promise<number> {
    try {
      // `none` on BOTH relations: a node can be an endpoint on either side, and pruning by
      // one side alone would delete nodes that are still a target — cascading their
      // surviving edges away with them, which is the exact damage this method exists to
      // clean up after rather than cause.
      const result = await this.client.evaluationNode.deleteMany({
        where: {
          projectId,
          sourceEdges: { none: {} },
          targetEdges: { none: {} },
        },
      });

      return result.count;
    } catch (error) {
      throw translateTransient("pruneOrphanNodes", error);
    }
  }
}

// `Prisma.TransactionClient` structurally, same as every other adapter in this
// codebase that needs to run inside someone else's transaction
// (`PrismaTransitionEffectRepository.ts:10`).
async function upsertNode(
  tx: Prisma.TransactionClient,
  projectId: string,
  endpoint: EvaluationGraphEndpoint,
): Promise<string> {
  // `(project_id, entity_id)` is the node's identity, from
  // `20260711000100_init_schema` — one node per entity per project, no matter how
  // many facts touch it.
  //
  // `attributes` and `timeline_position` are NOT written here, and that is butir 5
  // of the addendum rather than an omission: no rule shape reads them (a rule
  // matches atoms, and story time comes from reachability), so the fold does not
  // manufacture values the executor is forbidden to trust. `last_event_sequence`
  // likewise keeps its default until something needs an ordering guard — inventing
  // one now would be a second, untested idempotence mechanism beside the assertion
  // id that already provides it.
  const node = await tx.evaluationNode.upsert({
    where: { projectId_entityId: { projectId, entityId: endpoint.entityId } },
    create: {
      projectId,
      entityId: endpoint.entityId,
      entityType: endpoint.entityType,
    },
    // The entity type cannot change under a fixed id, so this exists to make the
    // upsert a lookup on the second fact rather than to correct anything.
    update: { entityType: endpoint.entityType },
    select: { id: true },
  });

  return node.id;
}

// Translation at the PORT boundary, not at the consumer: the port promises one named
// transient failure, and everything else keeps its own shape and its own message. The
// consumer's retry policy then reads a domain error rather than a Prisma code.
//
// A unique violation counts as transient HERE, and the reason is local to this fold
// rather than to the database — which is why it is composed in at this call site
// instead of being folded into the shared helper. Every unique key this writer touches
// is an IDENTITY key: `(project_id, entity_id)` for a node, `(source_assertion_id,
// project_id)` for an edge. A violation therefore means a concurrent fold already wrote
// the row this attempt was writing, and the retry finds it and updates. For the CRUD
// surface the identical code means the opposite — a duplicate the author must see — and
// `PrismaContentRelationshipRepository` maps it to its own error for that reason.
function translateTransient(operation: string, error: unknown): unknown {
  return isTransientDatabaseError(error) || isUniqueViolation(error)
    ? new EvaluationGraphTransientError(operation, error)
    : error;
}

export function createEvaluationGraphRepository({
  prisma,
}: {
  prisma: PrismaClient;
}): EvaluationGraphRepository {
  return new PrismaEvaluationGraphRepository(prisma);
}
