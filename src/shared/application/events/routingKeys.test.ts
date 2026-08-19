import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTENT_CREATED,
  CONTENT_DELETED,
  CONTENT_RELATIONSHIP_ASSERTED,
  CONTENT_RELATIONSHIP_RETRACTED,
  CONTENT_UPDATED,
  EMBEDDING_WORKER_BINDING,
  GRAPH_PROJECTOR_BINDINGS,
  NARRATIVE_EFFECT_APPLIED,
  matchesTopicPattern,
} from "./routingKeys.js";

// The guard gerbang G1 asked for (T-1 + A-1 + A-2). Three routing keys were being
// published while every document claimed a binding matched them that could not, and
// nothing anywhere could go red about it. These assertions can.
//
// Read the two suites as different jobs: the first pins the BROKER RULE (so the
// matcher below cannot be quietly wrong and take the second suite with it), the
// second pins the SYSTEM'S OWN keys against the bindings that are supposed to carry
// them.
describe("matchesTopicPattern — AMQP 0-9-1 topic semantics", () => {
  it("treats `*` as exactly one word", () => {
    expect(matchesTopicPattern("content.*", "content.created")).toBe(true);
    // The whole of T-1 in one line: one wildcard word cannot swallow two.
    expect(matchesTopicPattern("content.*", "content.relationship.asserted")).toBe(
      false,
    );
    // And it cannot swallow zero either — `content` alone is not `content.<word>`.
    expect(matchesTopicPattern("content.*", "content")).toBe(false);
  });

  it("treats `#` as zero or more words", () => {
    expect(matchesTopicPattern("content.#", "content")).toBe(true);
    expect(matchesTopicPattern("content.#", "content.created")).toBe(true);
    expect(matchesTopicPattern("content.#", "content.relationship.asserted")).toBe(
      true,
    );
    // A bare `#` is the catch-all binding — every key, any number of words. Pinned
    // because it is the pattern someone reaches for to "just make it work", and the
    // projector rejecting it was a deliberate choice, not an oversight.
    expect(matchesTopicPattern("#", "anything.at.all")).toBe(true);
    expect(matchesTopicPattern("#", "anything")).toBe(true);
  });

  it("matches wildcards in the middle and refuses the wrong prefix", () => {
    expect(
      matchesTopicPattern("content.*.asserted", "content.relationship.asserted"),
    ).toBe(true);
    expect(
      matchesTopicPattern("content.relationship.*", "narrative.relationship.x"),
    ).toBe(false);
    expect(matchesTopicPattern("content.created", "content.created")).toBe(true);
    expect(matchesTopicPattern("content.created", "content.created.extra")).toBe(
      false,
    );
  });
});

function matchesAnyProjectorBinding(key: string): boolean {
  return GRAPH_PROJECTOR_BINDINGS.some((pattern) =>
    matchesTopicPattern(pattern, key),
  );
}

describe("the routing key contract", () => {
  const entityLifecycle = [CONTENT_CREATED, CONTENT_UPDATED, CONTENT_DELETED];
  const graphFacts = [
    CONTENT_RELATIONSHIP_ASSERTED,
    CONTENT_RELATIONSHIP_RETRACTED,
    NARRATIVE_EFFECT_APPLIED,
  ];

  it.each(entityLifecycle)(
    "delivers %s to the embedding worker and NOT to the projector",
    (key) => {
      expect(matchesTopicPattern(EMBEDDING_WORKER_BINDING, key)).toBe(true);
      // The reason `content.#` was rejected for the projector: it would have made
      // this false, and put every entity text change through a projector with no
      // branch for it.
      expect(matchesAnyProjectorBinding(key)).toBe(false);
    },
  );

  it.each(graphFacts)(
    "delivers %s to the projector and NEVER to the embedding worker",
    (key) => {
      expect(matchesAnyProjectorBinding(key)).toBe(true);
      // Not merely "wrong queue". The worker casts the routing key to
      // `ContentEventType` and dead-letters what it cannot branch on, so a match
      // here would turn every relationship write into a DLQ message.
      expect(matchesTopicPattern(EMBEDDING_WORKER_BINDING, key)).toBe(false);
    },
  );

  it("covers the verb step 4b-3 is likely to add, without a binding change", () => {
    // The forward-compatibility claim the two-word-prefix decision rests on. If
    // 4b-3 writes `terminate` as its own event, this is already delivered — and if
    // someone instead invents `content.relationshipTerminated`, the assertion below
    // fails and says why.
    expect(matchesAnyProjectorBinding("content.relationship.terminated")).toBe(true);
    expect(
      matchesTopicPattern(EMBEDDING_WORKER_BINDING, "content.relationship.terminated"),
    ).toBe(false);
  });

  it("keeps every published key free of wildcards and at least two words", () => {
    // A key is not a pattern. A `*` or `#` reaching `publish()` would be published
    // literally and match nothing at all — the same silent failure from a third
    // direction.
    for (const key of [...entityLifecycle, ...graphFacts]) {
      expect(key).not.toMatch(/[*#]/);
      expect(key.split(".").length).toBeGreaterThanOrEqual(2);
    }
  });
});

// P-1 (gerbang G1-P). The claim at the top of `routingKeys.ts` — "one source for every
// key this system publishes" — was false when it was written: three files imported the
// constants while ten services still spelled `content.created` and friends as literals,
// and the one binding that has a LIVE consumer (`content.*`, embedding worker) was the
// half left unguarded. Mutating `EventService`'s routing key to three words survived the
// whole suite.
//
// A claim that no test can falsify is how the original T-1 happened. This is that test:
// it walks production sources and fails on any routing-key literal outside this contract.
//
// SCOPE, stated rather than implied. Test files are exempt on purpose — a test asserting
// the literal wire value (`expect(event.routingKey).toBe("content.created")`) is what pins
// the constant to the string the broker actually sees, so replacing those with the
// constant would make the pair self-confirming. Comment lines are skipped: prose has to be
// able to name a key.
describe("no routing key literals outside this contract", () => {
  const CONTRACT_FILE = "routingKeys.ts";
  const LITERAL = /["'`](?:content|narrative)\.[a-z]/i;

  function productionSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        // `generated/` is Prisma output; nothing in it is hand-written.
        return entry.name === "generated" ? [] : productionSources(full);
      }

      if (!entry.name.endsWith(".ts")) return [];
      if (entry.name.endsWith(".test.ts")) return [];
      if (entry.name === CONTRACT_FILE) return [];

      return [full];
    });
  }

  it("finds none", () => {
    const offenders = productionSources("src").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => {
          const trimmed = line.trim();
          const isComment =
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*");

          return !isComment && LITERAL.test(line);
        })
        .map(({ number, line }) => `${file}:${number} ${line.trim()}`),
    );

    // Named in the failure, not just counted: the point of this test is to say WHICH call
    // site drifted, because the fix is always "import the constant".
    expect(offenders).toEqual([]);
  });
});
