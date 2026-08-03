import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAppContainer } from "../../src/infrastructure/container.js";
import { createRabbitMqConsumer } from "../../src/infrastructure/queue/consumer.js";
import { RabbitMqManager } from "../../src/infrastructure/queue/rabbitmqManager.js";

import type { RabbitMqPublisher } from "../../src/infrastructure/queue/publisher.js";

// Exercises the retry/dead-letter behavior added to RabbitMqConsumer against a real
// RabbitMQ instance (testcontainers, see globalSetup.ts) — same convention as
// outbox-dispatcher.smoke.test.ts, not a mocked unit test, because the thing under
// test IS the broker interaction (nack/requeue, DLX routing, queue arguments).
let rabbitmq: RabbitMqManager;
let publisher: RabbitMqPublisher;

const RABBITMQ_MANAGEMENT_AUTH = `Basic ${Buffer.from("guest:guest").toString("base64")}`;

type ManagementConnection = {
  name: string;
  client_properties?: { connection_name?: string };
};

// Finds the broker-assigned connection id for a connection we opened with a known
// client_properties.connection_name (see RabbitMqManager's connectionName option) —
// needed because the management API's own "name" field is broker-generated, not
// something we control at connect time. Polls because the management plugin's
// stats collector refreshes on its own interval (empirically ~2s in this
// container), not in real time as connections open — a brand new connection is
// routinely invisible to /api/connections for a second or two after connecting.
async function findManagementConnectionName(
  managementUrl: string,
  connectionName: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${managementUrl}/api/connections`, {
      headers: { Authorization: RABBITMQ_MANAGEMENT_AUTH },
    });

    const connections = (await response.json()) as ManagementConnection[];
    const match = connections.find(
      (connection) =>
        connection.client_properties?.connection_name === connectionName,
    );

    if (match) {
      return match.name;
    }

    await sleep(250);
  }

  throw new Error(
    `No RabbitMQ connection found with connection_name=${connectionName} within ${timeoutMs}ms`,
  );
}

// Force-closes a connection via the management API — the real-world equivalent of
// a network blip or a broker restart severing an established AMQP connection.
async function forceCloseConnection(
  managementUrl: string,
  brokerConnectionName: string,
): Promise<void> {
  await fetch(
    `${managementUrl}/api/connections/${encodeURIComponent(brokerConnectionName)}`,
    { method: "DELETE", headers: { Authorization: RABBITMQ_MANAGEMENT_AUTH } },
  );
}

describe("RabbitMqConsumer retry + dead-letter behavior", () => {
  beforeAll(async () => {
    const container = createAppContainer();
    rabbitmq = container.resolve("rabbitmq");
    publisher = container.resolve("rabbitMqPublisher");

    await rabbitmq.start();
    await publisher.start();
  });

  afterAll(async () => {
    await publisher.stop();
    await rabbitmq.stop();
  });

  it("preserves original behavior by default: one attempt, no retry, no DLX configured", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    let callCount = 0;

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue: `consumer-test-backward-compat-${randomUUID()}`,
      routingKeyPattern: routingKey,
      handleMessage: () => {
        callCount += 1;
        throw new Error("always fails");
      },
    });

    await consumer.start();

    try {
      await publisher.publish(routingKey, { test: true });

      await expect.poll(() => callCount, { timeout: 5_000 }).toBe(1);

      // Confirm it stays at 1 — no broker requeue, no in-process retry.
      await sleep(500);
      expect(callCount).toBe(1);
    } finally {
      await consumer.stop();
    }
  });

  it("retries a caller-classified-retryable failure in-process and eventually succeeds", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    let callCount = 0;
    let succeeded = false;

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue: `consumer-test-retry-success-${randomUUID()}`,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 3,
      retryBaseDelayMs: 50,
      isRetryableError: () => true,
      handleMessage: () => {
        callCount += 1;

        if (callCount < 3) {
          throw new Error("simulated transient failure");
        }

        succeeded = true;
      },
    });

    await consumer.start();

    try {
      await publisher.publish(routingKey, { test: true });

      await expect.poll(() => succeeded, { timeout: 5_000 }).toBe(true);
      expect(callCount).toBe(3);
    } finally {
      await consumer.stop();
    }
  });

  it("routes a message to the dead-letter queue once retries are exhausted", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    const queue = `consumer-test-exhausted-${randomUUID()}`;
    const deadLetterExchange = `${queue}.dlx`;
    let callCount = 0;

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 2,
      retryBaseDelayMs: 50,
      isRetryableError: () => true,
      deadLetterExchange,
      handleMessage: () => {
        callCount += 1;
        throw new Error("simulated persistent failure");
      },
    });

    await consumer.start();

    try {
      await publisher.publish(routingKey, { test: true });

      await expect.poll(() => callCount, { timeout: 5_000 }).toBe(2);

      const dlqChannel = await rabbitmq.createChannel();

      try {
        await expect
          .poll(
            () =>
              dlqChannel.run((channel) =>
                channel.get(`${queue}.dlq`, { noAck: true }),
              ),
            { timeout: 5_000 },
          )
          .not.toBe(false);
      } finally {
        await dlqChannel.close();
      }
    } finally {
      await consumer.stop();
    }
  });

  it("routes a non-retryable failure to dead-letter immediately, without any retry", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    const queue = `consumer-test-permanent-${randomUUID()}`;
    const deadLetterExchange = `${queue}.dlx`;
    let callCount = 0;

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 3,
      retryBaseDelayMs: 50,
      isRetryableError: () => false,
      deadLetterExchange,
      handleMessage: () => {
        callCount += 1;
        throw new Error("simulated permanent failure");
      },
    });

    await consumer.start();

    try {
      await publisher.publish(routingKey, { test: true });

      await expect.poll(() => callCount, { timeout: 5_000 }).toBe(1);

      // Give it a beat — despite maxProcessingAttempts: 3, isRetryableError: false
      // must skip retry entirely and go straight to dead-letter on the first failure.
      await sleep(300);
      expect(callCount).toBe(1);

      const dlqChannel = await rabbitmq.createChannel();

      try {
        await expect
          .poll(
            () =>
              dlqChannel.run((channel) =>
                channel.get(`${queue}.dlq`, { noAck: true }),
              ),
            { timeout: 5_000 },
          )
          .not.toBe(false);
      } finally {
        await dlqChannel.close();
      }
    } finally {
      await consumer.stop();
    }
  });

  it("a malformed (non-JSON) payload is routed to dead-letter without ever calling the handler", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    const queue = `consumer-test-malformed-${randomUUID()}`;
    const deadLetterExchange = `${queue}.dlx`;
    let callCount = 0;

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 3,
      isRetryableError: () => true,
      deadLetterExchange,
      handleMessage: () => {
        callCount += 1;
      },
    });

    await consumer.start();

    try {
      // Bypass the JSON-encoding publisher deliberately — publish a raw non-JSON body.
      const rawChannel = await rabbitmq.createChannel();

      try {
        await rawChannel.run((channel) =>
          channel.publish(
            "ink-path.events",
            routingKey,
            Buffer.from("not valid json"),
            { contentType: "application/json", persistent: true },
          ),
        );
      } finally {
        await rawChannel.close();
      }

      const dlqChannel = await rabbitmq.createChannel();

      try {
        await expect
          .poll(
            () =>
              dlqChannel.run((channel) =>
                channel.get(`${queue}.dlq`, { noAck: true }),
              ),
            { timeout: 5_000 },
          )
          .not.toBe(false);
      } finally {
        await dlqChannel.close();
      }

      expect(callCount).toBe(0);
    } finally {
      await consumer.stop();
    }
  });

  // Regression test for a real bug (found by mentors review): stop() used to close
  // the channel immediately without waiting for a message that was mid-retry-sleep.
  // Once that sleep finished, the retry loop's ack/nack call threw against the
  // now-closed channel, and since consumeMessage runs fire-and-forget from the raw
  // consume() callback, that exception escaped as an unhandled promise rejection —
  // which crashes the process by default (Node >= 15) since nothing in the codebase
  // registers a process-level unhandledRejection handler. The same code path is hit
  // by a RabbitMqManager reconnect (connection drop detaches every channel wrapper)
  // without stop() ever being called at all — this test exercises the more easily
  // reproducible half (explicit stop()), which shares the exact same fix.
  it("never lets stop() during a retry backoff escape as an unhandled promise rejection", async () => {
    const routingKey = `test.consumer.${randomUUID()}`;
    let attempts = 0;
    let unhandledRejection: unknown = null;

    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejection = reason;
    };

    process.on("unhandledRejection", onUnhandledRejection);

    const consumer = createRabbitMqConsumer(rabbitmq, {
      queue: `consumer-test-shutdown-race-${randomUUID()}`,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 2,
      retryBaseDelayMs: 1_000,
      isRetryableError: () => true,
      handleMessage: () => {
        attempts += 1;
        throw new Error("always fails");
      },
    });

    try {
      await consumer.start();
      await publisher.publish(routingKey, { test: true });

      // Let attempt 1 fail and enter its ~1000ms backoff sleep, then stop() mid-sleep —
      // exactly the race mentor reproduced.
      await expect.poll(() => attempts, { timeout: 5_000 }).toBe(1);
      await sleep(150);

      await consumer.stop();

      // Give the interrupted retry loop time to run its course (it should return
      // immediately once the sleep is aborted, well before the original 1000ms
      // backoff would have elapsed on its own).
      await sleep(1_500);

      expect(unhandledRejection).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  // The reconnect-race variant of the same bug class: no stop() call at all — a
  // network blip / broker restart drops the connection while a message sits in
  // its retry backoff. RabbitMqManager's own reconnect handling
  // (connection.on("close", ...) -> detachChannels()) nulls the exact channel
  // wrapper consumeMessage captured, the same way stop() does — so this hits the
  // identical settle() catch as the test above, but through a different trigger
  // that doesn't require anyone to call stop() at all. Forces a REAL connection
  // drop via the RabbitMQ management HTTP API (a dedicated, uniquely-named
  // connection so only this test's connection gets closed) rather than an
  // in-process simulation, since the thing worth proving is that the real broker
  // behavior here is handled, not just our assumption about it.
  it("never lets a mid-retry connection drop (reconnect race) escape as an unhandled promise rejection", async () => {
    const managementUrl = process.env.RABBITMQ_MANAGEMENT_URL;

    if (!managementUrl) {
      throw new Error("RABBITMQ_MANAGEMENT_URL not set");
    }

    const rabbitMqUrl = process.env.RABBITMQ_URL;

    if (!rabbitMqUrl) {
      throw new Error("RABBITMQ_URL not set");
    }

    const connectionName = `reconnect-race-test-${randomUUID()}`;
    const dedicatedRabbitmq = new RabbitMqManager(rabbitMqUrl, connectionName);

    await dedicatedRabbitmq.start();

    // Resolve the broker-assigned connection id up front (this can take a couple
    // of seconds — see findManagementConnectionName) so the actual force-close
    // later happens immediately once we're in the retry-sleep window, instead of
    // racing the management stats collector's own refresh interval.
    const brokerConnectionName = await findManagementConnectionName(
      managementUrl,
      connectionName,
    );

    const routingKey = `test.consumer.${randomUUID()}`;
    let attempts = 0;
    let unhandledRejection: unknown = null;

    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejection = reason;
    };

    process.on("unhandledRejection", onUnhandledRejection);

    // Consumer lives on the dedicated connection (the one we're about to kill);
    // publishing happens over the shared connection so only the consumer side
    // is affected by the forced disconnect.
    const consumer = createRabbitMqConsumer(dedicatedRabbitmq, {
      queue: `consumer-test-reconnect-race-${randomUUID()}`,
      routingKeyPattern: routingKey,
      maxProcessingAttempts: 2,
      retryBaseDelayMs: 1_000,
      isRetryableError: () => true,
      handleMessage: () => {
        attempts += 1;
        throw new Error("always fails");
      },
    });

    try {
      await consumer.start();
      await publisher.publish(routingKey, { test: true });

      await expect.poll(() => attempts, { timeout: 5_000 }).toBe(1);
      await sleep(150);

      await forceCloseConnection(managementUrl, brokerConnectionName);

      // Give RabbitMqManager's close handler time to run (detachChannels — nulls
      // the same channel wrapper consumeMessage captured), then let attempt 2
      // fire after its ~1000ms backoff and reach the now-dead channel.
      await sleep(2_500);

      expect(unhandledRejection).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
      await consumer.stop().catch((error: unknown) => {
        console.warn("consumer.stop() cleanup failed", error);
      });
      await dedicatedRabbitmq.stop().catch((error: unknown) => {
        console.warn("dedicatedRabbitmq.stop() cleanup failed", error);
      });
    }
  });
});
