import { RELATIONSHIP_DEFINITION_SEED } from "../../domain/support/relationshipDefinitionSeed.js";

import type { PrismaClient } from "../../../../../generated/prisma/client.js";

export type RelationshipDefinitionSeedDatabase = Pick<
  PrismaClient,
  "relationshipDefinition"
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
// Not yet wired into project creation. Step 1 of the work order is explicitly
// additive — no existing write path is touched — so this runs where a caller
// asks for it, and the one-line hook into project creation lands when the
// definitions become a read path (step 3). A function that reports what it did
// is the shape that hook needs anyway.
export async function seedRelationshipDefinitions(
  client: RelationshipDefinitionSeedDatabase,
  projectId: string,
): Promise<RelationshipDefinitionSeedResult> {
  let created = 0;
  let skipped = 0;

  for (const definition of RELATIONSHIP_DEFINITION_SEED) {
    const existing = await client.relationshipDefinition.findUnique({
      where: {
        projectId_predicate: { projectId, predicate: definition.predicate },
      },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    // Nested create so the definition and its signatures land in one statement
    // group: a definition with no signatures accepts nothing, and a half-seeded
    // vocabulary is harder to notice than an unseeded one.
    await client.relationshipDefinition.create({
      data: {
        projectId,
        predicate: definition.predicate,
        objectRequired: definition.objectRequired,
        directionality: definition.directionality,
        inverseLabel: definition.inverseLabel,
        transitive: definition.transitive,
        signatures: {
          create: definition.signatures.map((signature) => ({
            subjectEntityType: signature.subjectEntityType,
            objectEntityType: signature.objectEntityType,
          })),
        },
      },
    });

    created += 1;
  }

  return { created, skipped };
}
