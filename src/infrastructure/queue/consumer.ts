import { logger } from "../logger.js";

import type { RabbitMqChannel, RabbitMqManager } from "./rabbitmqManager.js";
import type { ConsumeMessage } from "amqplib";

const DEFAULT_EXCHANGE = "ink-path.events";

export type RabbitMqMessage<Payload = unknown> = {
  payload: Payload;
  routingKey: string;
};

export type RabbitMqMessageHandler<Payload = unknown> = (
  message: RabbitMqMessage<Payload>,
) => Promise<void> | void;

type RabbitMqConsumerOptions<Payload = unknown> = {
  exchange?: string;
  prefetch?: number;
  queue: string;
  routingKeyPattern: string;
  handleMessage: RabbitMqMessageHandler<Payload>;
};

export class RabbitMqConsumer<Payload = unknown> {
  private channel: RabbitMqChannel | null = null;

  private readonly exchange: string;

  private readonly handleMessage: RabbitMqMessageHandler<Payload>;

  private readonly prefetch: number | undefined;

  private readonly queue: string;

  private readonly routingKeyPattern: string;

  constructor(
    private readonly rabbitmq: RabbitMqManager,
    options: RabbitMqConsumerOptions<Payload>,
  ) {
    this.exchange = options.exchange ?? DEFAULT_EXCHANGE;
    this.handleMessage = options.handleMessage;
    this.prefetch = options.prefetch;
    this.queue = options.queue;
    this.routingKeyPattern = options.routingKeyPattern;
  }

  async start(): Promise<void> {
    if (this.channel?.isOpen()) {
      return;
    }

    this.channel = await this.rabbitmq.createChannel(async (channel) => {
      await channel.assertExchange(this.exchange, "topic", { durable: true });
      await channel.assertQueue(this.queue, { durable: true });
      await channel.bindQueue(
        this.queue,
        this.exchange,
        this.routingKeyPattern,
      );

      if (this.prefetch !== undefined) {
        await channel.prefetch(this.prefetch);
      }

      await channel.consume(
        this.queue,
        (message) => {
          void this.consumeMessage(message);
        },
        { noAck: false },
      );
    });
  }

  async stop(): Promise<void> {
    await this.channel?.close();
    this.channel = null;
  }

  private async consumeMessage(message: ConsumeMessage | null): Promise<void> {
    if (!message) {
      return;
    }

    const channel = this.requireChannel();

    try {
      const payload = JSON.parse(message.content.toString("utf8")) as Payload;

      await this.handleMessage({
        payload,
        routingKey: message.fields.routingKey,
      });

      await channel.run((activeChannel) => {
        activeChannel.ack(message);
      });
    } catch (error) {
      logger.error(
        { err: error, routingKey: message.fields.routingKey },
        "Failed to process RabbitMQ message",
      );

      await channel.run((activeChannel) => {
        activeChannel.nack(message, false, false);
      });
    }
  }

  private requireChannel(): RabbitMqChannel {
    if (!this.channel) {
      throw new Error("RabbitMQ consumer channel not available");
    }

    return this.channel;
  }
}

export function createRabbitMqConsumer<Payload = unknown>(
  rabbitmq: RabbitMqManager,
  options: RabbitMqConsumerOptions<Payload>,
): RabbitMqConsumer<Payload> {
  return new RabbitMqConsumer(rabbitmq, options);
}
