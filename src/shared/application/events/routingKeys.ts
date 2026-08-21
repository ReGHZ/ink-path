// THE ROUTING KEY CONTRACT — one source for every key this system publishes and
// every pattern a queue binds to it.
//
// WHY THIS FILE EXISTS AT ALL (gerbang G1, T-1 + A-1 + A-2, 2026-08-19). The keys
// used to be string literals at the three call sites that publish them, and the
// binding pattern a fourth literal in the one consumer that exists. Nothing tied
// the four together, and the result was a claim — repeated in `.ai/current.md`,
// `notes/tech-debt.md` and in a comment next to the publish itself — that
// `content.relationship.asserted` "matches the binding the one existing consumer
// already uses". It does not. The exchange is a TOPIC exchange
// (`../../../infrastructure/queue/publisher.ts`, `assertExchange(…, "topic")`), and
// in a topic exchange `*` stands for EXACTLY ONE word while `#` stands for zero or
// more. `content.*` cannot match a three-word key. The event was published to an
// exchange where no queue was listening, and every document said otherwise.
//
// A comment cannot prevent that from recurring; a shared constant plus a test that
// applies the broker's own matching rule can, and `routingKeys.test.ts` is that
// test. Nothing here is a runtime mechanism — this module is a CONTRACT, and its
// value is that a producer, a binding and a document can no longer drift apart in
// silence.
//
// SCOPE, and it is enforced rather than asserted (gerbang G1-P, P-1): every producer
// in `src/` imports from here, and `routingKeys.test.ts` walks production sources and
// fails on any routing-key literal left outside this file. Two exemptions, both
// deliberate: `*.test.ts` may spell the wire value out — a test asserting
// `routingKey === "content.created"` is what pins the constant to the string the broker
// actually sees — and comment lines may name keys in prose.

// ---------------------------------------------------------------------------
// Keys that are published today
// ---------------------------------------------------------------------------

// Content entity lifecycle (Phase 4-6). Two words, and they must STAY two words:
// the embedding worker binds `content.*`, and §17's contract is that the worker
// consumes all three off one binding.
export const CONTENT_CREATED = "content.created";
export const CONTENT_UPDATED = "content.updated";
export const CONTENT_DELETED = "content.deleted";

// A relationship fact was asserted through the CRUD path (step 4b-1), and
// withdrawn through it (step 4b-2). Three words, deliberately: the second word
// names the aggregate the event is about, which is what lets a projector bind
// `content.relationship.*` without also swallowing entity text changes.
//
// ⚠ DO NOT shorten either of these to two words. `content.relationshipAsserted`
// would start matching the embedding worker's `content.*`, be cast to
// `ContentEventType`, match no branch, and dead-letter — a failure that looks like
// a broker problem and is really a naming problem.
export const CONTENT_RELATIONSHIP_ASSERTED = "content.relationship.asserted";
export const CONTENT_RELATIONSHIP_RETRACTED = "content.relationship.retracted";

// A narrative transition assertion was applied (step 7.7). Not `content.updated`
// (decision D6): no entity text changed, so the embedding worker must never see
// it; what it exists for is the evaluation graph of the Validation domain.
export const NARRATIVE_ASSERTION_APPLIED = "narrative.assertion.applied";

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

// The embedding worker's binding, unchanged since §17. Exported so the test can
// assert the ISOLATION — that no relationship or narrative key ever falls into
// this queue — instead of that assertion living only in a comment.
export const EMBEDDING_WORKER_BINDING = "content.*";

// DECIDED 2026-08-19 (blokir gerbang G1 T-1). What `GraphProjector` binds at step
// 4b-4. Two patterns, and the reasoning for each rejected alternative matters more
// than the choice:
//
//   REJECTED `content.#` + `narrative.#` — `#` matches zero or more words, so
//   `content.#` also delivers `content.created`/`updated`/`deleted`: every entity
//   text change in the system, arriving at a projector that has no branch for it.
//   "Receive it and ignore it" is precisely where silent bugs live, and it would
//   put the projector on the hot path of the highest-volume traffic there is.
//
//   REJECTED an explicit list of the three keys — correct today, and wrong the
//   first time an event is added: a new key would need a broker binding change in
//   lockstep with the producer, and the failure mode of forgetting is again silence.
//
//   CHOSEN two-word prefix + `*`. The prefix is the part the producer guarantees
//   (`content.relationship.` = a fact about a relationship; `narrative.assertion.` = a
//   consequence of a transition); the last word is the verb, which is the part that
//   grows. So a new verb — `content.relationship.terminated`, which step 4b-3 is
//   likely to add — is delivered without touching the binding, while entity
//   lifecycle traffic stays out.
//
// ⚠ MECHANICAL WORK THIS IMPLIES AT 4b-4, and it is not written yet on purpose
// (there is no consumer to carry it): `createRabbitMqConsumer` takes ONE
// `routingKeyPattern` and issues ONE `bindQueue`. Two patterns means looping the
// bind. Adding that parameter before a caller exists would be dead code, so it is
// recorded here and in `notes/tech-debt.md` instead of stubbed.
export const GRAPH_PROJECTOR_BINDINGS = [
  "content.relationship.*",
  "narrative.assertion.*",
] as const;

// ---------------------------------------------------------------------------
// Broker semantics, as a function
// ---------------------------------------------------------------------------

// AMQP 0-9-1 topic matching: keys and patterns are dot-separated words, `*`
// matches exactly one word, `#` matches zero or more.
//
// Reimplemented rather than trusted: the whole failure this module exists to
// prevent was a HUMAN applying the rule wrongly, so the rule is written once, in
// executable form, and the test asserts every producer/binding pair against it. It
// is used by no production code path — RabbitMQ does the real matching — and that
// is the point: this is the spec, kept honest by the fact that it can be run.
export function matchesTopicPattern(pattern: string, routingKey: string): boolean {
  const patternWords = pattern.split(".");
  const keyWords = routingKey.split(".");

  // Plain recursive match with the three cases spelled out, rather than a regex
  // translation: `#` needs backtracking (it may consume zero words or many), and
  // the version whose correctness is obvious by inspection is worth more here than
  // the compact one. Depth is bounded by the number of words in a routing key.
  const match = (patternIndex: number, keyIndex: number): boolean => {
    if (patternIndex === patternWords.length) {
      return keyIndex === keyWords.length;
    }

    const word = patternWords[patternIndex];

    if (word === "#") {
      // Zero words consumed, or one more — the OR is the backtracking.
      return (
        match(patternIndex + 1, keyIndex) ||
        (keyIndex < keyWords.length && match(patternIndex, keyIndex + 1))
      );
    }

    if (keyIndex === keyWords.length) {
      return false;
    }

    if (word !== "*" && word !== keyWords[keyIndex]) {
      return false;
    }

    return match(patternIndex + 1, keyIndex + 1);
  };

  return match(0, 0);
}
