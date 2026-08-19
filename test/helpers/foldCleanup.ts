import type { PrismaClient } from "../../src/generated/prisma/client.js";

// The order the FOLDS and the LOG have to be deleted in, in one place.
//
// FIVE levels since step 4b-4, and the order is not a preference — every foreign
// key on this path is `onDelete: Restrict`, so a wrong order fails instead of
// cascading, and the failure lands inside whatever fixture the test was setting up
// next. It has already cost one debugging session at four levels: the message
// named `projects`, not the projection that was actually holding the reference
// (`notes/jangan-diregresi.md`).
//
//   1. `evaluation_edges`      → points at the assertion (4b-4, Restrict)
//   2. `evaluation_nodes`      → the edges' endpoints (Cascade, but explicit here
//                                so a leftover node is never mistaken for state)
//   3. `content_relationships` → points at the assertion (4b-2, Restrict)
//   4. `transition_effects`    → the log itself; points at definitions
//   5. `narrative_transitions` → the log's optional parent
//   6. `relationship_definitions` → the vocabulary both folds name
//
// Projections in FRONT of the log, which is the opposite of the order that was
// correct before 4b-2. Content entities, the project and the user stay with the
// caller: those differ per file, while the four rows above are the same shape
// everywhere and are exactly the ones whose order is easy to get wrong.
//
// `projectId` as a plain filter rather than through the `project` relation, for
// `transition_effects` in particular — the relation form has been the slower and
// more surprising one here.
// The FRONT of that order on its own, for the files that already own their own tail.
//
// Exported instead of copy-pasted into each of them (S-4 of the 4b-4 gate): eight existing
// files delete `transition_effects` with their own filters, and every one of them now has a
// `RESTRICT` foreign key pointing at those rows from `evaluation_edges`. They are safe only
// while nothing else writes the diegetic fold — the moment the projector runs in one test,
// the FK fails in a DIFFERENT file's fixtures, which is precisely the debugging session the
// comment above describes. One call in front of their existing deletes keeps the ORDER in
// one place while leaving each file's own id filters alone.
export async function deleteEvaluationFold(
  client: PrismaClient,
  projectIds: readonly string[],
): Promise<void> {
  const ids = [...projectIds];

  await client.evaluationEdge.deleteMany({ where: { projectId: { in: ids } } });
  await client.evaluationNode.deleteMany({ where: { projectId: { in: ids } } });
}

export async function deleteFoldsAndAssertions(
  client: PrismaClient,
  projectIds: readonly string[],
): Promise<void> {
  const ids = [...projectIds];

  await deleteEvaluationFold(client, ids);
  await client.contentRelationship.deleteMany({
    where: { projectId: { in: ids } },
  });
  await client.transitionEffect.deleteMany({
    where: { projectId: { in: ids } },
  });
  await client.narrativeTransition.deleteMany({
    where: { projectId: { in: ids } },
  });
  await client.relationshipDefinition.deleteMany({
    where: { projectId: { in: ids } },
  });
}
