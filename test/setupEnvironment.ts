import { readRuntimeEnvironment } from "./runtimeEnvironment.js";

const runtimeEnvironment = await readRuntimeEnvironment();

process.env.DATABASE_URL = runtimeEnvironment.databaseUrl;
process.env.RABBITMQ_URL = runtimeEnvironment.rabbitMqUrl;
process.env.RABBITMQ_MANAGEMENT_URL = runtimeEnvironment.rabbitMqManagementUrl;
process.env.QDRANT_URL = runtimeEnvironment.qdrantUrl;
