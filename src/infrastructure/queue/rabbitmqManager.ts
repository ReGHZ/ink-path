import amqp, {
  type Channel,
  type ChannelModel,
} from "amqplib";

import { logger } from "../logger.js";

type ChannelSetup = (channel: Channel) => Promise<void>;
type ChannelOperation<Result> = (channel: Channel) => Promise<Result> | Result;

export type RabbitMqChannel = {
  close: () => Promise<void>;
  isOpen: () => boolean;
  run: <Result>(operation: ChannelOperation<Result>) => Promise<Result>;
};

class ManagedRabbitMqChannel implements RabbitMqChannel {
  private channel: Channel | null = null;

  constructor(
    private readonly setup: ChannelSetup | undefined,
    private readonly onClose: (channel: ManagedRabbitMqChannel) => void,
  ) {}

  async close(): Promise<void> {
    const channel = this.channel;

    this.channel = null;

    await channel?.close();
    this.onClose(this);
  }

  isOpen(): boolean {
    return this.channel !== null;
  }

  async run<Result>(operation: ChannelOperation<Result>): Promise<Result> {
    if (!this.channel) {
      throw new Error("RabbitMQ channel not available");
    }

    return operation(this.channel);
  }

  async restore(connection: ChannelModel): Promise<void> {
    const channel = await connection.createChannel();

    channel.on("close", () => {
      if (this.channel === channel) {
        this.channel = null;
      }
    });

    channel.on("error", (error) => {
      logger.error({ err: error }, "RabbitMQ channel error");
    });

    try {
      await this.setup?.(channel);
      this.channel = channel;
    } catch (error) {
      await channel.close();

      throw error;
    }
  }

  detach(): void {
    this.channel = null;
  }
}

export class RabbitMqManager {
  private connection: ChannelModel | null = null;

  private reconnectTimer: NodeJS.Timeout | null = null;

  private readonly channels = new Set<ManagedRabbitMqChannel>();

  private readonly reconnectDelay = 5000;

  private connecting = false;

  private stopped = false;

  constructor(private readonly url: string) {}

  async start(): Promise<void> {
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    await this.connection?.close();
  }

  isConnected(): boolean {
    return this.connection !== null;
  }

  async createChannel(setup?: ChannelSetup): Promise<RabbitMqChannel> {
    const connection = this.requireConnection();
    const channel = new ManagedRabbitMqChannel(setup, (closedChannel) => {
      this.channels.delete(closedChannel);
    });

    await channel.restore(connection);
    this.channels.add(channel);

    return channel;
  }

  private requireConnection(): ChannelModel {
    if (!this.connection) {
      throw new Error("RabbitMQ not connected");
    }

    return this.connection;
  }

  private async connect(): Promise<void> {
    if (this.connecting || this.stopped) {
      return;
    }

    this.connecting = true;

    try {
      const connection = await amqp.connect(this.url);

      this.connection = connection;

      logger.info("Connected to RabbitMQ");

      connection.on("error", (error) => {
        logger.error({ err: error }, "RabbitMQ connection error");
      });

      connection.on("close", () => {
        logger.warn("RabbitMQ connection closed");

        this.connection = null;
        this.detachChannels();

        this.scheduleReconnect();
      });

      await this.restoreChannels();
    } catch (error) {
      logger.error({ err: error }, "Failed to connect to RabbitMQ");

      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      await this.connect();
    }, this.reconnectDelay);
  }

  private async restoreChannels(): Promise<void> {
    if (!this.connection) {
      return;
    }

    for (const channel of this.channels) {
      try {
        await channel.restore(this.connection);

        logger.info("RabbitMQ channel restored");
      } catch (error) {
        logger.error({ err: error }, "Failed to restore RabbitMQ channel");
      }
    }
  }

  private detachChannels(): void {
    for (const channel of this.channels) {
      channel.detach();
    }
  }
}
