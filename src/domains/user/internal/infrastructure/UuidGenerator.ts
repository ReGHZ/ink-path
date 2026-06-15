import { randomUUID } from "node:crypto";

import type { IdGenerator } from "../../../../shared/application/ports/IdGenerator.js";

export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}

export function createUuidGenerator(): IdGenerator {
  return new UuidGenerator();
}
