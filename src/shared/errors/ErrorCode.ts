export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  // Step 4b-5 langkah 7. The request was valid and nothing was committed — the
  // database refused this attempt because two writers contended (a deadlock
  // victim, a serialization failure). It is deliberately NOT `CONFLICT`: 409
  // states that the request disagrees with the resource's state, and on these
  // very routes 409 already means "already applied" / "already exists", so
  // reusing it would take away the caller's ability to tell "stop, think" from
  // "repeat this". It is deliberately not INTERNAL_ERROR either: that says
  // unknown, do not retry, page someone.
  //
  // It stays a 5xx on purpose (`errorHandler.ts` maps it to 503): contention IS a
  // server-side condition and a storm of it is exactly what an alarm should see.
  // What separates it from a bug is this code, not the status class.
  UNAVAILABLE = "UNAVAILABLE",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
