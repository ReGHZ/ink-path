import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CHUNKER_MODULE_URL } from "./chunker.js";

// 05-implementation-policy/03_qdrant_point_id_chunking.md addendum 2026-08-03 point 2 —
// `chunker_source_hash` (§5 payload, §18 skip-decision) identifies which chunking
// implementation produced a point. Hashes chunker.ts's OWN reported module URL
// (CHUNKER_MODULE_URL, chunker.ts's `import.meta.url`) rather than guessing a relative
// path from this file — that reads whichever file is actually executing (chunker.ts
// under tsx/vitest in dev, chunker.js under dist/ in production) without needing to
// know which environment is active; a raw filesystem read has no awareness of the
// .js-specifier-resolves-to-.ts-source mapping `import` statements get from the loader,
// so only chunker.ts itself can correctly name its own currently-loaded path.
//
// Deliberately hashes the raw file bytes, comment and whitespace included, rather than
// trying to strip them first: a comment-only edit triggering an unnecessary reindex is a
// wasted-but-safe outcome, whereas a normalizer with an edge-case bug that misses a real
// algorithm change is a silent, unsafe one. Chunking constants (max_chunk_tokens,
// chunk_overlap_tokens, min_chunk_tokens — §12) live as chunker.ts's own internal
// defaults rather than caller-supplied overrides, precisely so every value that affects
// chunking behavior is captured by this one file's hash.
let cachedHash: string | null = null;

export function computeChunkerSourceHash(): string {
  cachedHash ??= createHash("sha256")
    .update(readFileSync(new URL(CHUNKER_MODULE_URL)))
    .digest("hex");

  return cachedHash;
}
