import { argon2id, hash, verify } from "argon2";

import type { PasswordHasher } from "../application/ports/PasswordHasher.js";

type Argon2PasswordHasherConfig = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(
    private readonly argon2PasswordHasherConfig: Argon2PasswordHasherConfig,
  ) {}

  async hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: this.argon2PasswordHasherConfig.memoryCost,
      timeCost: this.argon2PasswordHasherConfig.timeCost,
      parallelism: this.argon2PasswordHasherConfig.parallelism,
    });
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return verify(hash, password);
  }
}

export function createArgon2PasswordHasher({
  argon2PasswordHasherConfig,
}: {
  argon2PasswordHasherConfig: Argon2PasswordHasherConfig;
}): PasswordHasher {
  return new Argon2PasswordHasher(argon2PasswordHasherConfig);
}
