import type { AppCradle } from "../../infrastructure/container.js";
import type { AwilixContainer } from "awilix";

export type AppEnvironment = {
  Variables: {
    requestId: string;
    container: AwilixContainer<AppCradle>;
  };
};
