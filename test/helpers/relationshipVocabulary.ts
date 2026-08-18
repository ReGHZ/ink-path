import { seedRelationshipDefinitions } from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionSeeder.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Gives a test project the default predicate vocabulary.
//
// Needed since step 4 attached
// `content_relationships(project_id, relation_type)` to
// `relationship_definitions(project_id, predicate)`: a project with no
// vocabulary can hold no relationships, which is the intended production
// behaviour and not a test-only quirk.
//
// ONE helper rather than a call open-coded in each file, and the reason is the
// file that does not exist yet: the next integration test to create a project
// and a relationship would otherwise rediscover this by way of a foreign-key
// violation. Reuses the real seeder, so a test can never assert against a
// vocabulary the application would not have written.
//
// Not wired into project creation itself: hooking the seeder into
// `ProjectService.createProject` is a PRODUCT decision about what a new project
// starts with, deliberately still open (`notes/tech-debt.md` §B-8 sisa). Tests
// needing vocabulary ask for it explicitly, which also keeps "a project can have
// zero predicates" a state the suite can still construct.
export async function seedProjectVocabulary(
  prisma: PrismaClient,
  projectId: string,
): Promise<void> {
  await seedRelationshipDefinitions(prisma, projectId);
}

// Gives a test project an ASSERTION for a relationship row to be a fold of.
//
// Needed since step 4b-2 attached
// `content_relationships(source_assertion_id, project_id)` to
// `transition_effects(id, project_id)`: the projection names the fact it came
// from, so a relationship row can no longer be inserted on its own. Same reason
// this file exists at all — the next integration test to insert one would
// otherwise rediscover it as a foreign-key violation.
//
// Written with the Prisma client rather than through `TransitionEffect`: callers
// need a row that SATISFIES THE KEY, and going through the aggregate would drag
// the whole declare-path signature into every fixture. The semantic pairing of a
// projection with its assertion is proven where it belongs — `retractFact` in the
// domain suite, and the CRUD path end to end.
export async function seedOriginAssertion(
  prisma: PrismaClient,
  input: {
    id: string;
    projectId: string;
    predicate: string;
    subjectEntityId: string;
    objectEntityId: string;
    now: Date;
  },
): Promise<string> {
  const definition = await prisma.relationshipDefinition.findFirst({
    where: { projectId: input.projectId, predicate: input.predicate },
    select: { id: true },
  });

  if (definition === null) {
    throw new Error(
      `Project ${input.projectId} has no predicate "${input.predicate}" — seed the vocabulary first`,
    );
  }

  await prisma.transitionEffect.create({
    data: {
      id: input.id,
      // Parentless, like every assertion made through CRUD. `has_provenance` is
      // satisfied by the definition below.
      narrativeTransitionId: null,
      projectId: input.projectId,
      effectType: "relationship_add",
      targetEntityType: "character",
      targetEntityId: input.subjectEntityId,
      relationshipType: input.predicate,
      relationshipDefinitionId: definition.id,
      relatedEntityType: "character",
      relatedEntityId: input.objectEntityId,
      // A fact that holds the moment it is written — there is no apply step here.
      appliedAt: input.now,
      createdAt: input.now,
    },
  });

  return input.id;
}
