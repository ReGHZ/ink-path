import { RabbitMqManager } from "./rabbitmqManager.js";

export function createRabbitMqConnection(): RabbitMqManager {
  const url = process.env.RABBITMQ_URL;

  if (!url) {
    throw new Error("Missing RABBITMQ_URL environment variable");
  }

  return new RabbitMqManager(url);
}
