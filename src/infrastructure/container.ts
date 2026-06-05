import {
  createContainer,
  InjectionMode,
  asFunction,
  type AwilixContainer,
} from "awilix";

import { createPrismaClient } from "./prisma.js";

import type { PrismaClient } from "../generated/prisma/client.js";

export type AppCradle = {
  prisma: PrismaClient;
};

export function createAppContainer(): AwilixContainer<AppCradle> {
  const container = createContainer<AppCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register("prisma", asFunction(createPrismaClient).singleton());

  return container;
}
