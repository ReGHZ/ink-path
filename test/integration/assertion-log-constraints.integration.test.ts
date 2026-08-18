import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { NarrativeTransition } from "../../src/domains/content/internal/domain/transition/NarrativeTransition.js";
import { PrismaNarrativeTransitionRepository } from "../../src/domains/content/internal/infrastructure/transition/PrismaNarrativeTransitionRepository.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { PrismaClient } from "../../src/generated/prisma/client.js";

// The 2026-08-18 migration turned `transition_effects` into the assertion log
// (`notes/premis-symbolic-rule-engine.md` §8b step 2). Making
// `narrative_transition_id` nullable removed the one thing that guaranteed every
// row had a provenance and a story anchor, so four CHECK constraints took over.
// None of them is reachable from application code yet — nothing writes
// assertions until the vertical slice — which is precisely why they need a test:
// an unexercised constraint is indistinguishable from a missing one.
//
// The positive control at the end is the point of the whole step: a row with NO
// parent transition, pointing at a predicate definition, carrying a story
// anchor. That row could not exist before this migration.
//
// FIXTURE ID BLOCK 017 — owner/project ids end in `...0000000017NN`, assertion
// and entity ids use the `68686868` prefix. Both unused when this file was
// written (blocks 000-016 taken; prefixes 00000000/1x/2x/3x-9x/616263/64/65/66/67
// claimed elsewhere). Vitest runs test FILES in parallel and each cleans up its
// own project, so a shared block makes two files delete each other's fixtures
// intermittently. Grep the block AND the prefix before adding fixtures.
const now = new Date("2026-08-18T00:00:00.000Z");

const ownerUserId = "00000000-0000-4000-8000-000000001701";
const projectId = "00000000-0000-4000-8000-000000001702";
const otherProjectId = "00000000-0000-4000-8000-000000001703";

const transitionId = "68686868-0000-4000-8000-000000000001";
const characterId = "68686868-0000-4000-8000-0000000000ca";
const chapterId = "68686868-0000-4000-8000-0000000000cb";

const prisma = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const transitions = new PrismaNarrativeTransitionRepository(prisma);

let deadDefinitionId = "";
let otherProjectDefinitionId = "";

async function cleanDatabase(client: PrismaClient): Promise<void> {
  // Assertions before definitions before projects: every one of those FKs is
  // onDelete: Restrict, so deleting in the other order fails rather than
  // cascading.
  await client.transitionEffect.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.narrativeTransition.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.relationshipDefinition.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await client.project.deleteMany({
    where: { id: { in: [projectId, otherProjectId] } },
  });
  await client.user.deleteMany({ where: { id: ownerUserId } });
}

beforeEach(async () => {
  await cleanDatabase(prisma);

  await users.insert(
    User.create({
      id: ownerUserId,
      email: "assertion-log-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  for (const [id, name] of [
    [projectId, "Assertion log project"],
    [otherProjectId, "Assertion log neighbour"],
  ] as const) {
    await projects.insert(
      Project.create({
        id,
        ownerUserId,
        createdByUserId: ownerUserId,
        name,
        now,
      }),
    );
  }

  await transitions.insert(
    NarrativeTransition.create({
      id: transitionId,
      projectId,
      sourceEntityType: "chapter",
      sourceEntityId: chapterId,
      title: "Kematian di bab 12",
      description: null,
      declaredByUserId: ownerUserId,
      reversesTransitionId: null,
      now,
    }),
  );

  // A unary predicate — the shape that had no home before this step at all.
  const dead = await prisma.relationshipDefinition.create({
    data: {
      projectId,
      predicate: "dead",
      objectRequired: false,
      directionality: "directional",
      inverseLabel: "dead",
      signatures: {
        create: [
          { subjectEntityType: "character", objectEntityType: null },
        ],
      },
    },
  });
  deadDefinitionId = dead.id;

  const neighbour = await prisma.relationshipDefinition.create({
    data: {
      projectId: otherProjectId,
      predicate: "dead",
      objectRequired: false,
      directionality: "directional",
      inverseLabel: "dead",
    },
  });
  otherProjectDefinitionId = neighbour.id;
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

type AssertionOverrides = Partial<{
  narrativeTransitionId: string | null;
  relationshipDefinitionId: string | null;
  effectType: "attribute_change" | "relationship_add" | "terminate" | "retract";
  anchorEntityType: "chapter" | "scene" | "event" | null;
  anchorEntityId: string | null;
  targetAssertionId: string | null;
  targetEffectType:
    | "attribute_change"
    | "relationship_add"
    | "terminate"
    | "retract"
    | null;
  id: string;
}>;

// A well-formed unary assertion: no parent transition, a predicate definition,
// and a story anchor. Each test bends exactly one field away from this.
function assertionRow(overrides: AssertionOverrides = {}) {
  return {
    projectId,
    narrativeTransitionId: null,
    relationshipDefinitionId: deadDefinitionId,
    effectType: "relationship_add" as const,
    targetEntityType: "character" as const,
    targetEntityId: characterId,
    anchorEntityType: "chapter" as const,
    anchorEntityId: chapterId,
    targetAssertionId: null,
    targetEffectType: null,
    createdAt: now,
    ...overrides,
  };
}

async function seedAssertion(id?: string): Promise<string> {
  const created = await prisma.transitionEffect.create({
    data: assertionRow(id === undefined ? {} : { id }),
  });

  return created.id;
}

async function seedTerminate(): Promise<string> {
  const created = await prisma.transitionEffect.create({
    data: assertionRow({
      effectType: "terminate",
      targetAssertionId: await seedAssertion(),
      targetEffectType: "relationship_add",
    }),
  });

  return created.id;
}

describe("assertion log constraints", () => {
  // The whole reason step 2 exists. Before the migration this insert was
  // impossible: `narrative_transition_id` was NOT NULL, there was no column to
  // name the predicate, and no column to carry the story anchor.
  it("accepts a unary assertion with no parent transition", async () => {
    const created = await prisma.transitionEffect.create({
      data: assertionRow(),
    });

    expect(created.narrativeTransitionId).toBeNull();
    expect(created.relationshipDefinitionId).toBe(deadDefinitionId);
    expect(created.anchorEntityType).toBe("chapter");
    expect(created.relatedEntityId).toBeNull();
  });

  it("still accepts a Phase 7 effect that has a parent and no predicate", async () => {
    const created = await prisma.transitionEffect.create({
      data: assertionRow({
        narrativeTransitionId: transitionId,
        relationshipDefinitionId: null,
        anchorEntityType: null,
        anchorEntityId: null,
        effectType: "attribute_change",
      }),
    });

    expect(created.narrativeTransitionId).toBe(transitionId);
  });

  it("refuses a row with neither a parent nor a predicate", async () => {
    await expect(
      prisma.transitionEffect.create({
        data: assertionRow({ relationshipDefinitionId: null }),
      }),
    ).rejects.toThrow(/transition_effects_has_provenance/);
  });

  it("refuses half an anchor, in either half", async () => {
    await expect(
      prisma.transitionEffect.create({
        data: assertionRow({ anchorEntityId: null }),
      }),
    ).rejects.toThrow(/transition_effects_anchor_complete/);

    await expect(
      prisma.transitionEffect.create({
        data: assertionRow({ anchorEntityType: null }),
      }),
    ).rejects.toThrow(/transition_effects_anchor_complete/);
  });

  it("accepts an assertion with no anchor at all", async () => {
    // "Holds with no time information" is a different answer from "holds at
    // every cut", and the log has to be able to say it.
    const created = await prisma.transitionEffect.create({
      data: assertionRow({ anchorEntityType: null, anchorEntityId: null }),
    });

    expect(created.anchorEntityType).toBeNull();
  });

  describe("terminate / retract must name the assertion they act on", () => {
    it("refuses a terminate with no target", async () => {
      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({ effectType: "terminate" }),
        }),
      ).rejects.toThrow(/transition_effects_target_matches_operation/);
    });

    it("refuses a retract with no target", async () => {
      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({ effectType: "retract" }),
        }),
      ).rejects.toThrow(/transition_effects_target_matches_operation/);
    });

    // The other half of the equivalence. Without it the constraint would only
    // stop empty terminates, and an `attribute_change` could still claim to act
    // on some other assertion.
    it("refuses an assert-shaped row that points at an assertion", async () => {
      const targetId = await seedAssertion();

      await expect(
        prisma.transitionEffect.create({
          // The kind is stated too, so the row is well formed in every OTHER
          // dimension and only one constraint can be the one that refuses it.
          data: assertionRow({
            targetAssertionId: targetId,
            targetEffectType: "relationship_add",
          }),
        }),
      ).rejects.toThrow(/transition_effects_target_matches_operation/);
    });

    it("accepts a terminate that names its target", async () => {
      const targetId = await seedAssertion();

      const created = await prisma.transitionEffect.create({
        data: assertionRow({
          effectType: "terminate",
          targetAssertionId: targetId,
          targetEffectType: "relationship_add",
        }),
      });

      expect(created.targetAssertionId).toBe(targetId);
    });

    it("refuses an assertion that terminates itself", async () => {
      const id = "68686868-0000-4000-8000-0000000000ff";

      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({
            id,
            effectType: "terminate",
            targetAssertionId: id,
            targetEffectType: "relationship_add",
          }),
        }),
      ).rejects.toThrow(/transition_effects_target_not_self/);
    });

    it("refuses a terminate whose target lives in another project", async () => {
      const targetId = await seedAssertion();

      await expect(
        prisma.transitionEffect.create({
          data: {
            ...assertionRow({
              effectType: "terminate",
              targetAssertionId: targetId,
              targetEffectType: "relationship_add",
              relationshipDefinitionId: otherProjectDefinitionId,
            }),
            projectId: otherProjectId,
          },
        }),
      ).rejects.toThrow(
        /transition_effects_target_assertion_id_project_id_target_e_fkey/,
      );
    });
  });

  // C-1 (`quality-gate/gerbang-mutu-phase-11-slice-pass2-2026-08-18.md`).
  // `target_matches_operation` only ever asked whether a target EXISTS. What
  // KIND of row it is went unasked, so `retract` over a `terminate` row — and
  // `terminate` over either operation — were all writable and all read as
  // nothing. Premis §8.3 AMENDMENT 2026-08-18 decides which of them mean
  // something; these tests are that decision, enforced.
  describe("an operation's target is checked by KIND, not just existence", () => {
    it("refuses a target whose kind goes unstated", async () => {
      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({
            effectType: "terminate",
            targetAssertionId: await seedAssertion(),
            targetEffectType: null,
          }),
        }),
      ).rejects.toThrow(/transition_effects_target_kind_complete/);
    });

    // The load-bearing one. `target_effect_type` is denormalised, so the whole
    // design rests on it being unable to lie — and it is the FOREIGN KEY, not a
    // CHECK, that makes that true: a kind disagreeing with the target's real
    // `effect_type` has no row to point at.
    it("refuses a target kind that disagrees with the target row", async () => {
      const assertionId = await seedAssertion();

      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({
            effectType: "retract",
            targetAssertionId: assertionId,
            // The row really is a `relationship_add`.
            targetEffectType: "terminate",
          }),
        }),
      ).rejects.toThrow(
        /transition_effects_target_assertion_id_project_id_target_e_fkey/,
      );
    });

    it("refuses a terminate over a terminate", async () => {
      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({
            effectType: "terminate",
            targetAssertionId: await seedTerminate(),
            targetEffectType: "terminate",
          }),
        }),
      ).rejects.toThrow(/transition_effects_terminate_targets_assertion/);
    });

    // The correction path for a mistyped termination, and — the log being
    // append-only — the only one there is.
    it("accepts a retract over a terminate", async () => {
      const terminateId = await seedTerminate();

      const created = await prisma.transitionEffect.create({
        data: assertionRow({
          effectType: "retract",
          targetAssertionId: terminateId,
          targetEffectType: "terminate",
        }),
      });

      expect(created.targetAssertionId).toBe(terminateId);
    });

    // Double negation, refused at the door. Allowing it would resurrect an
    // assertion and force every reader to resolve retractions transitively
    // rather than as a flat set.
    it("refuses a retract over a retract", async () => {
      const retracted = await prisma.transitionEffect.create({
        data: assertionRow({
          effectType: "retract",
          targetAssertionId: await seedAssertion(),
          targetEffectType: "relationship_add",
        }),
      });

      await expect(
        prisma.transitionEffect.create({
          data: assertionRow({
            effectType: "retract",
            targetAssertionId: retracted.id,
            targetEffectType: "retract",
          }),
        }),
      ).rejects.toThrow(
        /transition_effects_retract_targets_assertion_or_terminate/,
      );
    });
  });

  it("refuses an assertion naming a predicate from another project", async () => {
    await expect(
      prisma.transitionEffect.create({
        data: assertionRow({
          relationshipDefinitionId: otherProjectDefinitionId,
        }),
      }),
    ).rejects.toThrow(
      /transition_effects_relationship_definition_id_project_id_fkey/,
    );
  });
});
