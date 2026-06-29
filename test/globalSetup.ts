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

const RABBITMQ_IMAGE = "rabbitmq:management";
const RABBITMQ_PORT = 5672;

function buildDatabaseUrl(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);

  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${port}/${POSTGRES_DB}`;
}

function buildRabbitMqUrl(container: StartedTestContainer): string {
  const host = container.getHost();
  const port = container.getMappedPort(RABBITMQ_PORT);

  return `amqp://guest:guest@${host}:${port}`;
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

  const postgresContainer = await new GenericContainer(POSTGRES_IMAGE)
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

  const databaseUrl = buildDatabaseUrl(postgresContainer);

  const rabbitMqContainer = await new GenericContainer(RABBITMQ_IMAGE)
    .withExposedPorts(RABBITMQ_PORT)
    .withWaitStrategy(Wait.forLogMessage("Server startup complete"))
    .start();

  const rabbitMqUrl = buildRabbitMqUrl(rabbitMqContainer);

  await writeRuntimeEnvironment({ databaseUrl, rabbitMqUrl });
  await runMigrations(databaseUrl);

  return async () => {
    await rabbitMqContainer.stop();
    await postgresContainer.stop();

    await removeRuntimeEnvironment();
  };
}
