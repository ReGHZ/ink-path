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
