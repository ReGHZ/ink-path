import { randomUUID } from "node:crypto";

import {
  displayLabelFromSymbol,
  RELATIONSHIP_DEFINITION_SEED,
} from "../../domain/support/relationshipDefinitionSeed.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";

export type RelationshipDefinitionSeedDatabase = Pick<
  PrismaClient,
  "relationshipDefinition" | "relationshipDefinitionSignature"
>;

export type RelationshipDefinitionSeedResult = {
  created: number;
  skipped: number;
};

// Gives a project its starting predicate vocabulary.
//
// CREATE-IF-MISSING, never update. A predicate the author has already edited —
// renamed its inverse label, narrowed its signature set, marked it transitive —
// is THEIR data now; re-running the seeder over it would silently restore the
// shipped version, and the author would have no way to tell that the vocabulary
// they tuned had been reset under them. That is also why signatures are only
// written together with a definition the seeder itself created: adding "missing"
// signatures to an existing definition would resurrect exactly the pairs an
// author deliberately removed.
//
// MUST RUN INSIDE THE CALLER'S TRANSACTION, and the parameter type is what says
// so: `Prisma.TransactionClient` satisfies the two-delegate shape above while a
// bare `PrismaClient` also does — but the caller that matters,
// `PrismaProjectUnitOfWork`, has only the transaction client to give. Atomicity
// across the whole vocabulary is the CALLER'S, deliberately: this function
// writes two statements, and a caller that runs them outside a transaction can
// end up with definitions whose signatures never landed. Project creation, the
// only production caller, runs both inside the transaction that writes the
// project row (`shared/application/ports/ProjectVocabularySeeder.ts` explains
// why the vocabulary is not optional).
//
// NO read-before-write. An earlier version checked `findUnique` and then
// `create`, which is a TOCTOU: two callers racing on one project both saw
// "missing" and the loser hit an unhandled P2002 on
// `(project_id, predicate)` — from a function whose `skipped` count promises
// idempotence. `createMany({ skipDuplicates })` emits ON CONFLICT DO NOTHING,
// so no statement can raise and there is no window to lose. That also matters
// for the transaction requirement above: a P2002 caught mid-transaction does
// NOT leave the transaction usable in Postgres, so "catch and continue" would
// have been a fix that works standalone and breaks the moment it is wired into
// project creation.
export async function seedRelationshipDefinitions(
  client: RelationshipDefinitionSeedDatabase,
  projectId: string,
): Promise<RelationshipDefinitionSeedResult> {
  // Ids generated here rather than by the database default, because the id is
  // also the OWNERSHIP TOKEN. `skipDuplicates` silently drops the rows that lost,
  // and `createMany` reports only a count — so "did I write this predicate, or
  // did a concurrent caller?" has no other honest answer. A racing caller
  // generates different ids, so exactly one of them finds its own id in the
  // table and exactly one writes the signatures.
  const candidates = RELATIONSHIP_DEFINITION_SEED.map((definition) => ({
    id: randomUUID(),
    definition,
  }));

  await client.relationshipDefinition.createMany({
    data: candidates.map(({ id, definition }) => ({
      id,
      projectId,
      predicate: definition.predicate,
      objectRequired: definition.objectRequired,
      directionality: definition.directionality,
      inverseLabel: definition.inverseLabel,
      // Derived from the symbol, not translated — the author decides the wording.
      displayLabel: displayLabelFromSymbol(definition.predicate),
      inverseDisplayLabel: displayLabelFromSymbol(definition.inverseLabel),
      transitive: definition.transitive,
    })),
    skipDuplicates: true,
  });

  const persisted = await client.relationshipDefinition.findMany({
    where: { projectId, id: { in: candidates.map(({ id }) => id) } },
    select: { id: true },
  });
  const persistedIds = new Set(persisted.map((row) => row.id));

  const created = candidates.filter(({ id }) => persistedIds.has(id));

  await client.relationshipDefinitionSignature.createMany({
    data: created.flatMap(({ id, definition }) =>
      definition.signatures.map((signature) => ({
        definitionId: id,
        subjectEntityType: signature.subjectEntityType,
        objectEntityType: signature.objectEntityType,
      })),
    ),
  });

  return {
    created: created.length,
    skipped: candidates.length - created.length,
  };
}

