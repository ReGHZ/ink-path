import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";

import {
  removeRuntimeEnvironment,
  writeRuntimeEnvironment,
} from "./runtimeEnvironment.js";

const execFileAsync = promisify(execFile);

const POSTGRES_IMAGE = "postgres:17-alpine";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "postgres";
const POSTGRES_DB = "ink_path_test";
const POSTGRES_PORT = 5432;

function buildDatabaseUrl(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);

  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${port}/${POSTGRES_DB}`;
}

async function runMigrations(databaseUrl: string): Promise<void> {
  await execFileAsync("pnpm", ["prisma", "migrate", "deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await removeRuntimeEnvironment();

  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_DB,
      POSTGRES_PASSWORD,
      POSTGRES_USER,
    })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections", 2),
    )
    .start();

  const databaseUrl = buildDatabaseUrl(container);

  await writeRuntimeEnvironment({ databaseUrl });
  await runMigrations(databaseUrl);

  return async () => {
    await container.stop();
    await removeRuntimeEnvironment();
  };
}
