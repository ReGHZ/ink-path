import {
  createContainer,
  InjectionMode,
  asFunction,
  type AwilixContainer,
} from "awilix";

import { createPrismaClient } from "./database/prisma.js";
import { createRabbitMqConnection } from "./queue/connection.js";

import type { RabbitMqManager } from "./queue/rabbitmqManager.js";
import type { PrismaClient } from "../generated/prisma/client.js";

export type AppCradle = {
  prisma: PrismaClient;
  rabbitmq: RabbitMqManager;
};

export function createAppContainer(): AwilixContainer<AppCradle> {
  const container = createContainer<AppCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register("prisma", asFunction(createPrismaClient).singleton());
  container.register(
    "rabbitmq",
    asFunction(createRabbitMqConnection).singleton(),
  );

  return container;
}
