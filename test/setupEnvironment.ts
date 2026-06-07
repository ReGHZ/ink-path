import { readRuntimeEnvironment } from "./runtimeEnvironment.js";

const runtimeEnvironment = await readRuntimeEnvironment();

process.env.DATABASE_URL = runtimeEnvironment.databaseUrl;
