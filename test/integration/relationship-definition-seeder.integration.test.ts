import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  displayLabelFromSymbol,
  RELATIONSHIP_DEFINITION_SEED,
} from "../../src/domains/content/internal/domain/support/relationshipDefinitionSeed.js";
import {
  seedRelationshipDefinitions,
  type RelationshipDefinitionSeedResult,
} from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionSeeder.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";
import {
  extractUniqueConstraintColumns,
  isUniqueViolation,
} from "../../src/shared/infrastructure/prismaErrors.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// Four things only a real database can decide, and every one of them is a rule
// that used to live in TypeScript:
//
//   1. The dedicated-hierarchy ban. `assertNoHierarchyPairs()` runs at module
//      load over a frozen constant. Once the matrix is project data there is no
//      constant to check at boot, and §4 REVISI(b) of the registry document is
//      explicit that the ban "hilang senyap" unless it moves to write time.
//   2. The predicate name shape. `relation_type` was free text guarded only by
//      a closed union; a project-owned vocabulary has no union.
//   3. Partial uniqueness over a nullable object side. A plain composite unique
//      admits `(d, character, NULL)` any number of times, and unary predicates
//      are exactly what step 3 introduces.
//   4. That the seeder is genuinely create-if-missing. Re-running it is the
//      normal case, not the edge one.
//
// FIXTURE ID BLOCK 016 — owner/project ids end in `...0000000016NN`, definition
// ids use the `67676767` prefix. Both were unused when this file was written
// (blocks 000-015 are taken; prefixes 00000000/1x/2x/3x-9x/616263/64/65/66 are
// claimed elsewhere).
//
// Vitest runs test FILES in parallel and each of these files cleans up by
// deleting its own project and user, so two files sharing a block delete each
// other's fixtures mid-run — intermittently, since a full-suite run can pass on
// scheduling luck. Before adding fixtures here or in a new file, grep
// `test/integration/` for the block AND the prefix; `tsc`, lint and a
// single-file run cannot see this.
const now = new Date("2026-08-18T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001601";
const projectId = "00000000-0000-4000-8000-000000001602";
const otherProjectId = "00000000-0000-4000-8000-000000001603";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);

const seededPredicates = RELATIONSHIP_DEFINITION_SEED.map(
  (seed) => seed.predicate,
);
const seededSignatureTotal = RELATIONSHIP_DEFINITION_SEED.reduce(
  (total, seed) => total + seed.signatures.length,
  0,
);

// A single definition to hang signatures off, for the constraint probes below.
// Deliberately not one of the seeded 19: those carry a matrix the frozen
// document owns, and a probe that mutated one would be testing the constraint
// against data whose shape it is not free to choose.
async function seedOneDefinition(predicate: string): Promise<string> {
  const created = await prisma.relationshipDefinition.create({
    data: {
      projectId,
      predicate,
      objectRequired: true,
      directionality: "directional",
      inverseLabel: `${predicate}_by`,
      displayLabel: displayLabelFromSymbol(predicate),
      inverseDisplayLabel: displayLabelFromSymbol(`${predicate}_by`),
    },
  });

  return created.id;
}

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Definitions before projects: `relationship_definitions.project_id` is
  // onDelete: Restrict, so deleting the project with a definition still
  // attached fails rather than cascading. Signatures need no separate delete —
  // their FK cascades from the definition.
  await client.relationshipDefinition.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.project.deleteMany({
    where: { id: { in: [projectId, otherProjectId] } },
  });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

async function seedOwnerAndProjects(): Promise<void> {
  await users.insert(
    User.create({
      id: ownerUserId,
      email: "definition-seed-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  await projects.insert(
    Project.create({
      id: projectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Definition seed project",
      now,
    }),
  );

  await projects.insert(
    Project.create({
      id: otherProjectId,
      ownerUserId,
      createdByUserId: ownerUserId,
      name: "Definition seed neighbour project",
      now,
    }),
  );
}

// The seeder's contract is "runs inside the caller's transaction" — it writes
// definitions and signatures as two statements and leaves atomicity to whoever
// owns the transaction (in production, project creation). Exercising it any
// other way would test a shape nothing uses.
async function seedVocabulary(
  targetProjectId: string,
): Promise<RelationshipDefinitionSeedResult> {
  return prisma.$transaction((tx) =>
    seedRelationshipDefinitions(tx, targetProjectId),
  );
}

beforeEach(async () => {
  await cleanDatabase(prisma);
  await seedOwnerAndProjects();
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

describe("relationship definition seeder", () => {
  it("gives a fresh project all 19 predicates with their signatures", async () => {
    const result = await seedVocabulary(projectId);

    expect(result).toEqual({ created: 19, skipped: 0 });

    const rows = await prisma.relationshipDefinition.findMany({
      where: { projectId },
      select: { predicate: true },
    });

    expect(rows.map((row) => row.predicate).sort()).toEqual(
      [...seededPredicates].sort(),
    );

    const signatureCount = await prisma.relationshipDefinitionSignature.count({
      where: { definition: { projectId } },
    });

    expect(signatureCount).toBe(seededSignatureTotal);
  });

  // Spot-checks with literal numbers next to the derived total above: the
  // derived count proves nothing was dropped, but it moves with the seed, so a
  // matrix that silently emptied would still satisfy it.
  it("writes each predicate's own signature set, not a shared one", async () => {
    await seedVocabulary(projectId);

    const owns = await prisma.relationshipDefinition.findUniqueOrThrow({
      where: { projectId_predicate: { projectId, predicate: "owns" } },
      include: { signatures: true },
    });

    expect(owns.inverseLabel).toBe("owned_by");
    expect(owns.directionality).toBe("directional");
    expect(
      owns.signatures
        .map((s) => `${s.subjectEntityType}->${s.objectEntityType ?? "∅"}`)
        .sort(),
    ).toEqual(["character->world_element", "faction->world_element"]);

    const depicts = await prisma.relationshipDefinition.findUniqueOrThrow({
      where: { projectId_predicate: { projectId, predicate: "depicts" } },
      include: { signatures: true },
    });

    expect(depicts.signatures).toHaveLength(1);
    expect(depicts.signatures[0]?.subjectEntityType).toBe("scene");
    expect(depicts.signatures[0]?.objectEntityType).toBe("event");
  });

  it("is a no-op on a project that already has its vocabulary", async () => {
    await seedVocabulary(projectId);
    const second = await seedVocabulary(projectId);

    expect(second).toEqual({ created: 0, skipped: 19 });

    const definitionCount = await prisma.relationshipDefinition.count({
      where: { projectId },
    });
    const signatureCount = await prisma.relationshipDefinitionSignature.count({
      where: { definition: { projectId } },
    });

    expect(definitionCount).toBe(19);
    expect(signatureCount).toBe(seededSignatureTotal);
  });

  // The reason create-if-missing matters. An author who narrows `ally_of` and
  // marks it transitive owns that row; a seeder that "restores defaults" would
  // undo the change with nothing to show for it.
  it("leaves an author's edits alone when it runs again", async () => {
    await seedVocabulary(projectId);

    const allyOf = await prisma.relationshipDefinition.findUniqueOrThrow({
      where: { projectId_predicate: { projectId, predicate: "ally_of" } },
    });

    await prisma.relationshipDefinitionSignature.deleteMany({
      where: { definitionId: allyOf.id, subjectEntityType: "faction" },
    });
    await prisma.relationshipDefinition.update({
      where: { id: allyOf.id },
      data: { transitive: true, inverseLabel: "sworn_with" },
    });

    await seedVocabulary(projectId);

    const after = await prisma.relationshipDefinition.findUniqueOrThrow({
      where: { id: allyOf.id },
      include: { signatures: true },
    });

    expect(after.transitive).toBe(true);
    expect(after.inverseLabel).toBe("sworn_with");
    expect(
      after.signatures.some((s) => s.subjectEntityType === "faction"),
    ).toBe(false);
  });

  // TWO CONNECTIONS, not two awaits. The bug this replaced was a TOCTOU
  // (`findUnique` said "missing", then `create` raced another caller into the
  // `(project_id, predicate)` unique index), and a race needs two transactions
  // in flight at once to reproduce. Sequential awaits on one client cannot
  // fail this way no matter how the seeder is written, so they would be a
  // control that always passes.
  it("stays correct when two connections seed the same project at once", async () => {
    const rival = createPrismaClient();

    try {
      const [first, second] = await Promise.all([
        prisma.$transaction((tx) => seedRelationshipDefinitions(tx, projectId)),
        rival.$transaction((tx) => seedRelationshipDefinitions(tx, projectId)),
      ]);

      // Exactly one caller owns each predicate. Not "at least 19": a total of
      // 38 would mean both wrote, and a total below 19 would mean a predicate
      // was reported skipped that nobody ever created.
      expect(first.created + second.created).toBe(19);
      expect(first.skipped + second.skipped).toBe(19);

      expect(
        await prisma.relationshipDefinition.count({ where: { projectId } }),
      ).toBe(19);
      // The signature side is where a "both callers think they won" bug would
      // land, and it would land silently: signatures have no per-project
      // unique index to stop a second write.
      expect(
        await prisma.relationshipDefinitionSignature.count({
          where: { definition: { projectId } },
        }),
      ).toBe(seededSignatureTotal);
    } finally {
      await rival.$disconnect();
    }
  });

  it("seeds each project separately", async () => {
    await seedVocabulary(projectId);

    expect(
      await prisma.relationshipDefinition.count({
        where: { projectId: otherProjectId },
      }),
    ).toBe(0);

    const result = await seedVocabulary(otherProjectId);

    expect(result).toEqual({ created: 19, skipped: 0 });
    expect(
      await prisma.relationshipDefinition.count({ where: { projectId } }),
    ).toBe(19);
  });

  describe("invariants the database holds, not the application", () => {
    // Asserting the constraint NAME, not merely that something threw: a write
    // rejected by the wrong rule is not evidence for the rule under test. This
    // check was written after a manual probe of the same ban appeared to pass
    // while actually failing on an unrelated foreign key.
    it("refuses chapter/scene as a signature, in both directions", async () => {
      const definitionId = await seedOneDefinition("probe_hierarchy");

      for (const [subject, object] of [
        ["chapter", "scene"],
        ["scene", "chapter"],
      ] as const) {
        await expect(
          prisma.relationshipDefinitionSignature.create({
            data: {
              definitionId,
              subjectEntityType: subject,
              objectEntityType: object,
            },
          }),
        ).rejects.toThrow(
          /relationship_definition_signatures_no_dedicated_hierarchy/,
        );
      }
    });

    it("refuses layer/layer and map/map as signatures", async () => {
      const definitionId = await seedOneDefinition("probe_self_hierarchy");

      for (const entityType of ["layer", "map"] as const) {
        await expect(
          prisma.relationshipDefinitionSignature.create({
            data: {
              definitionId,
              subjectEntityType: entityType,
              objectEntityType: entityType,
            },
          }),
        ).rejects.toThrow(
          /relationship_definition_signatures_no_dedicated_hierarchy/,
        );
      }
    });

    it("accepts a signature that is merely unusual", async () => {
      const definitionId = await seedOneDefinition("probe_allowed");

      await expect(
        prisma.relationshipDefinitionSignature.create({
          data: {
            definitionId,
            subjectEntityType: "scene",
            objectEntityType: "layer",
          },
        }),
      ).resolves.toBeDefined();
    });

    // The SQL twin of PREDICATE_NAME_PATTERN. Without this the two copies could
    // drift apart and only the application one would ever be exercised.
    it("refuses a predicate name the pattern rejects", async () => {
      await expect(
        prisma.relationshipDefinition.create({
          data: {
            projectId,
            predicate: "Bad Predicate!",
            objectRequired: true,
            directionality: "directional",
            inverseLabel: "x",
            displayLabel: "x",
            inverseDisplayLabel: "x",
          },
        }),
      ).rejects.toThrow(/relationship_definitions_predicate_format/);
    });

    it("refuses a repeated unary signature, which a plain unique would admit", async () => {
      const definitionId = await seedOneDefinition("probe_unary");

      await prisma.relationshipDefinitionSignature.create({
        data: {
          definitionId,
          subjectEntityType: "character",
          objectEntityType: null,
        },
      });

      // Prisma reports a unique violation as P2002 carrying the FIELD LIST, not
      // the index name, so the field list is what identifies which of the two
      // partial indexes fired: two columns is the unary index, while the binary
      // one covers three.
      //
      // Read the columns off the driver-adapter payload with the repo's own
      // helper rather than off the message. The rendered message embeds a
      // snippet of this very file, so a message-level assertion ends up
      // matching the test's own source — comments included.
      const error: unknown = await prisma.relationshipDefinitionSignature
        .create({
          data: {
            definitionId,
            subjectEntityType: "character",
            objectEntityType: null,
          },
        })
        .then(
          () => null,
          (error_: unknown) => error_,
        );

      expect(isUniqueViolation(error)).toBe(true);
      expect(extractUniqueConstraintColumns(error)).toEqual([
        "definition_id",
        "subject_entity_type",
      ]);
    });

    it("still admits the same subject with a real object beside a unary row", async () => {
      const definitionId = await seedOneDefinition("probe_mixed_arity");

      await prisma.relationshipDefinitionSignature.create({
        data: {
          definitionId,
          subjectEntityType: "character",
          objectEntityType: null,
        },
      });

      // The unary index keys on (definition, subject) alone, so it must not
      // reach a row whose object side is filled — otherwise declaring `dead`
      // for characters would block `owns` from ever accepting one.
      await expect(
        prisma.relationshipDefinitionSignature.create({
          data: {
            definitionId,
            subjectEntityType: "character",
            objectEntityType: "world_element",
          },
        }),
      ).resolves.toBeDefined();
    });

    it("refuses a subclass parent that lives in another project", async () => {
      const parentId = await seedOneDefinition("probe_parent");

      await expect(
        prisma.relationshipDefinition.create({
          data: {
            projectId: otherProjectId,
            predicate: "probe_child",
            objectRequired: true,
            directionality: "directional",
            inverseLabel: "x",
            displayLabel: "x",
            inverseDisplayLabel: "x",
            subclassOfId: parentId,
          },
        }),
      ).rejects.toThrow(
        /relationship_definitions_subclass_of_id_project_id_fkey/,
      );

      // Positive control: the same parent inside the same project is accepted,
      // so the rejection above is about the project boundary and not about the
      // foreign key refusing every parent.
      await expect(
        prisma.relationshipDefinition.create({
          data: {
            projectId,
            predicate: "probe_child",
            objectRequired: true,
            directionality: "directional",
            inverseLabel: "x",
            displayLabel: "x",
            inverseDisplayLabel: "x",
            subclassOfId: parentId,
          },
        }),
      ).resolves.toBeDefined();
    });
  });
});
