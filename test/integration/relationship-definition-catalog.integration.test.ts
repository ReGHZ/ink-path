import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { RelationshipDefinitionCatalogError } from "../../src/domains/content/internal/domain/support/RelationshipDefinitionCatalogError.js";
import { PrismaRelationshipDefinitionCatalog } from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionCatalog.js";
import { PrismaRelationshipDefinitionReader } from "../../src/domains/content/internal/infrastructure/support/PrismaRelationshipDefinitionReader.js";
import { Project } from "../../src/domains/project/internal/domain/Project.js";
import { PrismaProjectRepository } from "../../src/domains/project/internal/infrastructure/PrismaProjectRepository.js";
import { User } from "../../src/domains/user/internal/domain/User.js";
import { PrismaUserRepository } from "../../src/domains/user/internal/infrastructure/PrismaUserRepository.js";
import { createPrismaClient } from "../../src/infrastructure/database/prisma.js";

import type { RelationshipDefinitionDraft } from "../../src/domains/content/internal/domain/support/relationshipDefinition.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

// FIXTURE ID BLOCK 025 — owner/project ids end in `...0000000025NN`, definition
// ids are assigned by the adapter (randomUUID) so this file claims no id prefix
// of its own beyond the owner/project pair. Block 025 was the next free one
// (registri: `notes/jangan-diregresi.md` §Konvensi test integration; 015-024
// taken, 019/`70707070` retired and not to be reused).
//
// Four things only a real database can decide here, and each one is a rule whose
// SECOND owner this file is:
//
//   1. That the nested create really lands definition + signatures together.
//      The domain refuses a signature-less draft; nothing in TypeScript proves
//      the write cannot produce one anyway.
//   2. That `P2002` on `(project_id, predicate)` arrives as the port's own error
//      type. If the adapter ever stops translating, the service's `instanceof`
//      silently stops matching and a duplicate turns into a 500.
//   3. That `listDetails` is scoped by project INSIDE the statement. The tenancy
//      lesson from G2-3: a filter applied after the fact is not a filter.
//   4. That the display-label CHECK exists in the database, not only in the
//      domain guard — proven by writing past the domain, straight through Prisma.
//   5. That the LABEL is unique per project too, normalized — the half of
//      "one word = one predicate" the symbol index structurally cannot hold,
//      because a label no ASCII survives gets an opaque symbol that is unique by
//      construction (gate B8-2).
const ownerUserId = "6e6e6e6e-0000-4000-8000-000000002501";
const projectId = "6e6e6e6e-0000-4000-8000-000000002502";
const otherProjectId = "6e6e6e6e-0000-4000-8000-000000002503";

const now = new Date("2026-08-20T00:00:00.000Z");

const prisma: PrismaClient = createPrismaClient();
const users = new PrismaUserRepository(prisma);
const projects = new PrismaProjectRepository(prisma);
const catalog = new PrismaRelationshipDefinitionCatalog(prisma);
const reader = new PrismaRelationshipDefinitionReader(prisma);

function draft(
  overrides: Partial<RelationshipDefinitionDraft> = {},
): RelationshipDefinitionDraft {
  return {
    predicate: "mentors",
    directionality: "directional",
    objectRequired: true,
    inverseLabel: "mentored_by",
    displayLabel: "mentors",
    inverseDisplayLabel: "mentored by",
    signatures: [
      { subjectEntityType: "character", objectEntityType: "character" },
    ],
    ...overrides,
  };
}

async function cleanDatabase(client: PrismaClient): Promise<void> {
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
      email: "definition-catalog-owner@example.com",
      username: null,
      passwordHash: "hashed-password",
      now,
    }),
  );

  for (const [id, name] of [
    [projectId, "Vocabulary project"],
    [otherProjectId, "Neighbour project"],
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
});

afterAll(async () => {
  await cleanDatabase(prisma);
  await prisma.$disconnect();
});

describe("relationship definition catalog", () => {
  it("stores the definition and its signatures in one write", async () => {
    const created = await catalog.create(projectId, draft());

    expect(created.predicate).toBe("mentors");
    expect(created.signatures).toEqual([
      { subjectEntityType: "character", objectEntityType: "character" },
    ]);

    // Read back through the reader the ENGINE uses, not through the catalog that
    // just wrote it: that is what proves the row is usable for validation, not
    // merely present.
    const seen = await reader.findByPredicate(projectId, "mentors");

    expect(seen?.id).toBe(created.id);
    expect(seen?.signatures).toHaveLength(1);
  });

  it("stores a unary predicate with a null object side", async () => {
    const created = await catalog.create(
      projectId,
      draft({
        predicate: "dead",
        objectRequired: false,
        inverseLabel: "dead",
        displayLabel: "mati",
        inverseDisplayLabel: "mati",
        signatures: [
          { subjectEntityType: "character", objectEntityType: null },
        ],
      }),
    );

    expect(created.objectRequired).toBe(false);
    expect(created.signatures[0]?.objectEntityType).toBeNull();
  });

  it("keeps display text in any script, byte for byte", async () => {
    const created = await catalog.create(
      projectId,
      draft({
        predicate: "p_1a2b3c4d",
        inverseLabel: "p_1a2b3c4d",
        displayLabel: "結婚",
        inverseDisplayLabel: "配偶者",
      }),
    );

    const [listed] = await catalog.listDetails(projectId);

    expect(created.displayLabel).toBe("結婚");
    expect(listed?.displayLabel).toBe("結婚");
    expect(listed?.inverseDisplayLabel).toBe("配偶者");
  });

  it("translates a duplicate predicate into the port's own error", async () => {
    await catalog.create(projectId, draft());

    await expect(catalog.create(projectId, draft())).rejects.toThrow(
      RelationshipDefinitionCatalogError,
    );
  });

  it("refuses a second row that READS the same when the symbol cannot say so", async () => {
    const kekkon = {
      inverseLabel: "p_1a2b3c4d5e6f",
      displayLabel: "結婚",
      inverseDisplayLabel: "結婚",
    };

    await catalog.create(
      projectId,
      draft({ predicate: "p_1a2b3c4d5e6f", ...kekkon }),
    );

    // A DIFFERENT opaque symbol, so `@@unique([project_id, predicate])` cannot
    // see this at all — opaque symbols are unique by construction. The word on
    // screen is identical, and that is what the author has to live with, so the
    // label index is the one that has to catch it (gate B8-2).
    await expect(
      catalog.create(
        projectId,
        draft({
          ...kekkon,
          predicate: "p_9f8e7d6c5b4a",
          inverseLabel: "p_9f8e7d6c5b4a",
        }),
      ),
    ).rejects.toThrow(RelationshipDefinitionCatalogError);
  });

  it("carries the EXISTING row's label back with the conflict", async () => {
    await catalog.create(
      projectId,
      draft({
        predicate: "mati_fisik",
        inverseLabel: "mati_fisik",
        displayLabel: "mati (fisik)",
        inverseDisplayLabel: "mati (fisik)",
      }),
    );

    // Same derived symbol, different typing. What the author must be told is the
    // text of the row that WON, because that is the one they have to find in the
    // list — reading it here is only possible after the write already lost.
    await expect(
      catalog.create(
        projectId,
        draft({
          predicate: "mati_fisik",
          inverseLabel: "mati_fisik",
          displayLabel: "mati fisik",
          inverseDisplayLabel: "mati fisik",
        }),
      ),
    ).rejects.toMatchObject({
      existing: { displayLabel: "mati (fisik)", objectRequired: true },
    });
  });

  it("names the winning row even when only its LETTER CASE differs", async () => {
    await catalog.create(projectId, draft({ displayLabel: "Menikah" }));

    // Both indexes are violated at once here, and which one Postgres reports is
    // its business. The wording handed back must not depend on that, which is
    // why the lookup is unconditional rather than branching on the index.
    await expect(
      catalog.create(projectId, draft({ displayLabel: "menikah" })),
    ).rejects.toMatchObject({ existing: { displayLabel: "Menikah" } });
  });

  it("unites two NORMALIZATION FORMS of one word, in the DATABASE", async () => {
    // 각 precomposed (U+AC01) vs decomposed (U+1100 U+1161 U+11A8) — the two
    // forms a Korean IME emits interchangeably for the same word. Only
    // `normalize(..., NFKC)` in the key can see they are one word: `lower` and
    // `btrim` leave them different byte strings. This case exists because the
    // clause survived a mutation while its neighbours died — the case/padding
    // test exercises two clauses at once and cannot tell which one went missing
    // (gate B8P-2).
    await prisma.relationshipDefinition.create({
      data: {
        projectId,
        predicate: "p_precomposed",
        directionality: "directional",
        objectRequired: true,
        inverseLabel: "p_precomposed",
        displayLabel: "\uAC01",
        inverseDisplayLabel: "\uAC01",
      },
    });

    await expect(
      prisma.relationshipDefinition.create({
        data: {
          projectId,
          predicate: "p_decomposed",
          directionality: "directional",
          objectRequired: true,
          inverseLabel: "p_decomposed",
          displayLabel: "\u1100\u1161\u11A8",
          inverseDisplayLabel: "\u1100\u1161\u11A8",
        },
      }),
    ).rejects.toThrow(/Unique constraint failed[\s\S]*display_label/);
  });

  it("names the winning row by its WORDING when the symbol is opaque", async () => {
    const kekkon = {
      displayLabel: "結婚",
      inverseDisplayLabel: "結婚",
    };

    await catalog.create(
      projectId,
      draft({
        ...kekkon,
        predicate: "p_1a2b3c4d5e6f",
        inverseLabel: "p_1a2b3c4d5e6f",
        objectRequired: true,
      }),
    );

    // The second attempt mints its OWN opaque symbol, so a lookup by symbol
    // finds nothing and the service used to answer an ARITY clash with a
    // sentence about punctuation (gate B8P-3). The wording is the second key.
    await expect(
      catalog.create(
        projectId,
        draft({
          ...kekkon,
          predicate: "p_9f8e7d6c5b4a",
          inverseLabel: "p_9f8e7d6c5b4a",
          objectRequired: false,
          signatures: [
            { subjectEntityType: "character", objectEntityType: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      existing: { displayLabel: "結婚", objectRequired: true },
    });
  });

  it("folds case and padding for the label key, in the DATABASE", async () => {
    // Straight through Prisma, past the adapter and past the domain: the index
    // is the second owner of "one word = one predicate", and the normalization
    // (`lower(normalize(btrim(...), NFKC))`) is part of that ownership, not a
    // convenience of the write path.
    await prisma.relationshipDefinition.create({
      data: {
        projectId,
        predicate: "a_one",
        directionality: "directional",
        objectRequired: true,
        inverseLabel: "a_one",
        displayLabel: "Menikah",
        inverseDisplayLabel: "Menikah",
      },
    });

    await expect(
      prisma.relationshipDefinition.create({
        data: {
          projectId,
          predicate: "b_two",
          directionality: "directional",
          objectRequired: true,
          inverseLabel: "b_two",
          displayLabel: "  menikah  ",
          inverseDisplayLabel: "menikah",
        },
      }),
      // Prisma names the EXPRESSION rather than the index here — asserting the
      // index name would pass for any unique failure once the message changes.
    ).rejects.toThrow(/Unique constraint failed[\s\S]*display_label/);
  });

  it("lets a NEIGHBOUR project use the same predicate name", async () => {
    await catalog.create(projectId, draft());

    await expect(
      catalog.create(otherProjectId, draft()),
    ).resolves.toMatchObject({ predicate: "mentors" });
  });

  it("lists only the asking project's vocabulary", async () => {
    await catalog.create(projectId, draft({ predicate: "mentors" }));
    await catalog.create(otherProjectId, draft({ predicate: "betrays" }));

    const listed = await catalog.listDetails(projectId);

    expect(listed.map((detail) => detail.predicate)).toEqual(["mentors"]);
  });

  it("orders by the symbol, so an edited label cannot reshuffle the list", async () => {
    await catalog.create(
      projectId,
      draft({ predicate: "betrays", displayLabel: "zzz" }),
    );
    await catalog.create(
      projectId,
      draft({ predicate: "mentors", displayLabel: "aaa" }),
    );

    const listed = await catalog.listDetails(projectId);

    expect(listed.map((detail) => detail.predicate)).toEqual([
      "betrays",
      "mentors",
    ]);
  });

  it("refuses a blank display label in the DATABASE, past the domain guard", async () => {
    await expect(
      prisma.relationshipDefinition.create({
        data: {
          projectId,
          predicate: "blank_label",
          directionality: "directional",
          objectRequired: true,
          inverseLabel: "blank_label",
          displayLabel: "   ",
          inverseDisplayLabel: "ok",
        },
      }),
    ).rejects.toThrow(/display_label_present/);
  });
});
