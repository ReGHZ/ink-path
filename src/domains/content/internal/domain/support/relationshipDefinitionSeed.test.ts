import { describe, expect, it } from "vitest";

import { isDedicatedHierarchyPair } from "./relationshipDefinition.js";
import {
  PREDICATE_NAME_PATTERN,
  RELATIONSHIP_DEFINITION_SEED,
} from "./relationshipDefinitionSeed.js";

// What this file can and cannot prove, stated up front so nobody reads more
// assurance into it than it carries.
//
// The matrix itself is tied to `05-implementation-policy/02_relation_type_registry.md`
// by the exhaustiveness suite in `relationshipDefinition.test.ts`, which
// transcribes the frozen document by hand and compares it against these rows —
// that is where "the seed matches the document" is proved, and it is not
// re-proved here.
//
// What is worth asserting is everything the derivation does NOT give for free:
// the count, the two hand-written addendum entries, and the invariants the
// database will enforce on all 19 once they are written.

const byPredicate = new Map(
  RELATIONSHIP_DEFINITION_SEED.map((seed) => [seed.predicate, seed]),
);

describe("relationship definition seed", () => {
  it("seeds 19 predicates: the frozen matrix's 17 plus the 2026-08-17 addendum", () => {
    expect(RELATIONSHIP_DEFINITION_SEED).toHaveLength(19);
  });

  // The invariant survived step 4; only its enforcement site moved. It used to
  // guard a scheduled collision — adding `owns`/`rules` to the closed union
  // while the addendum list still carried them would have produced two `owns`
  // seeds — and the union is gone, so that particular collision cannot happen.
  // What remains is the same rule the DATABASE now holds for every project:
  // `@@unique([projectId, predicate])`. A duplicate here would make the seeder
  // fail halfway through a project's vocabulary, after some definitions had
  // already been written; failing at `pnpm test` instead is the point.
  it("declares each predicate exactly once", () => {
    expect(byPredicate.size).toBe(RELATIONSHIP_DEFINITION_SEED.length);
  });

  it("carries the `owns` matrix as the addendum writes it", () => {
    const owns = byPredicate.get("owns");

    expect(owns).toEqual({
      predicate: "owns",
      objectRequired: true,
      directionality: "directional",
      inverseLabel: "owned_by",
      transitive: false,
      signatures: [
        { subjectEntityType: "character", objectEntityType: "world_element" },
        { subjectEntityType: "faction", objectEntityType: "world_element" },
      ],
    });
  });

  // `character -> map` and `faction -> map` are the pairs that make `rules`
  // territorial authority rather than a synonym for `member_of`, and `layer` is
  // absent on purpose (§2 `rules`: a layer is an organising tier of
  // worldbuilding, not a polity). Spelling the whole object out means dropping
  // either fact turns this red.
  it("carries the `rules` matrix as the addendum writes it", () => {
    const rules = byPredicate.get("rules");

    expect(rules).toEqual({
      predicate: "rules",
      objectRequired: true,
      directionality: "directional",
      inverseLabel: "ruled_by",
      transitive: false,
      signatures: [
        { subjectEntityType: "character", objectEntityType: "faction" },
        { subjectEntityType: "character", objectEntityType: "map" },
        { subjectEntityType: "faction", objectEntityType: "faction" },
        { subjectEntityType: "faction", objectEntityType: "map" },
      ],
    });
  });

  it("never seeds a dedicated hierarchy pair", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      for (const signature of seed.signatures) {
        if (signature.objectEntityType === null) {
          continue;
        }

        expect(
          isDedicatedHierarchyPair(
            signature.subjectEntityType,
            signature.objectEntityType,
          ),
          `${seed.predicate} declares hierarchy pair ${signature.subjectEntityType}/${signature.objectEntityType}`,
        ).toBe(false);
      }
    }
  });

  it("never repeats a signature inside one predicate", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      const keys = seed.signatures.map(
        (signature) =>
          `${signature.subjectEntityType}->${signature.objectEntityType ?? "∅"}`,
      );

      expect(new Set(keys).size, `${seed.predicate} repeats a signature`).toBe(
        keys.length,
      );
    }
  });

  it("gives every predicate at least one signature", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      expect(
        seed.signatures.length,
        `${seed.predicate} accepts nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("uses predicate names the database column will accept", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      expect(PREDICATE_NAME_PATTERN.test(seed.predicate)).toBe(true);
    }
  });

  // Both are decisions rather than defaults (see the note above FROM_REGISTRY),
  // and both are read by the engine: arity by AST safety rule 3, transitivity
  // by the projection that materialises closures. A seed that flipped either
  // would change what rules mean, not just what the table holds.
  it("seeds every predicate binary and non-transitive", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      expect(seed.objectRequired, seed.predicate).toBe(true);
      expect(seed.transitive, seed.predicate).toBe(false);
    }
  });

  it("gives non-directional predicates themselves as inverse label", () => {
    for (const seed of RELATIONSHIP_DEFINITION_SEED) {
      if (seed.directionality === "non_directional") {
        expect(seed.inverseLabel).toBe(seed.predicate);
      }
    }
  });
});
