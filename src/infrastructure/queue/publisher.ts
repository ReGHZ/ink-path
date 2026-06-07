import type { RabbitMqChannel, RabbitMqManager } from "./rabbitmqManager.js";

const DEFAULT_EXCHANGE = "ink-path.events";

type RabbitMqPublisherOptions = {
  exchange?: string;
};

export class RabbitMqPublisher {
  private channel: RabbitMqChannel | null = null;

  private readonly exchange: string;

  constructor(
    private readonly rabbitmq: RabbitMqManager,
    options: RabbitMqPublisherOptions = {},
  ) {
    this.exchange = options.exchange ?? DEFAULT_EXCHANGE;
  }

  async start(): Promise<void> {
    if (this.channel?.isOpen()) {
      return;
    }

    this.channel = await this.rabbitmq.createChannel(async (channel) => {
      await channel.assertExchange(this.exchange, "topic", { durable: true });
    });
  }

  async stop(): Promise<void> {
    await this.channel?.close();
    this.channel = null;
  }

  async publish(routingKey: string, payload: unknown): Promise<boolean> {
    const channel = this.requireChannel();
    const body = Buffer.from(JSON.stringify(payload));

    return channel.run((activeChannel) =>
      activeChannel.publish(this.exchange, routingKey, body, {
        contentType: "application/json",
        persistent: true,
      }),
    );
  }

  private requireChannel(): RabbitMqChannel {
    if (!this.channel) {
      throw new Error("RabbitMQ publisher channel not available");
    }

    return this.channel;
  }
}

export function createRabbitMqPublisher(
  { rabbitmq }: { rabbitmq: RabbitMqManager },
): RabbitMqPublisher {
  return new RabbitMqPublisher(rabbitmq);
}
