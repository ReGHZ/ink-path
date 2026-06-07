import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const runtimeEnvironmentPath = resolve("test/.runtime/test-environment.json");

type RuntimeEnvironment = {
  databaseUrl: string;
};

export async function writeRuntimeEnvironment(
  runtimeEnvironment: RuntimeEnvironment,
): Promise<void> {
  await mkdir(dirname(runtimeEnvironmentPath), { recursive: true });
  await writeFile(
    runtimeEnvironmentPath,
    JSON.stringify(runtimeEnvironment),
    "utf8",
  );
}

export async function readRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  const raw = await readFile(runtimeEnvironmentPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<RuntimeEnvironment>;

  if (!parsed.databaseUrl) {
    throw new Error("Missing databaseUrl in test runtime environment");
  }

  return {
    databaseUrl: parsed.databaseUrl,
  };
}

export async function removeRuntimeEnvironment(): Promise<void> {
  await rm(dirname(runtimeEnvironmentPath), { force: true, recursive: true });
}
