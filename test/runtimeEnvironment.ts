import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const runtimeEnvironmentPath = resolve("test/.runtime/test-environment.json");

type RuntimeEnvironment = {
  databaseUrl: string;
  rabbitMqUrl: string;
  rabbitMqManagementUrl: string;
  qdrantUrl: string;
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

  const { databaseUrl, rabbitMqUrl, rabbitMqManagementUrl, qdrantUrl } = parsed;

  if (!databaseUrl || !rabbitMqUrl || !rabbitMqManagementUrl || !qdrantUrl) {
    const missing: string[] = [];

    if (!databaseUrl) {
      missing.push("DATABASE_URL");
    }

    if (!rabbitMqUrl) {
      missing.push("RABBITMQ_URL");
    }

    if (!rabbitMqManagementUrl) {
      missing.push("RABBITMQ_MANAGEMENT_URL");
    }

    if (!qdrantUrl) {
      missing.push("QDRANT_URL");
    }

    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  return {
    databaseUrl,
    rabbitMqUrl,
    rabbitMqManagementUrl,
    qdrantUrl,
  };
}

export async function removeRuntimeEnvironment(): Promise<void> {
  await rm(dirname(runtimeEnvironmentPath), { force: true, recursive: true });
}
