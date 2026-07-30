// Abstraction over "a long-running message consumer with a start/stop lifecycle" —
// deliberately NOT shaped like OutboxEventRepository (a single insert() call with no
// lifecycle at all). A consumer subscribes and keeps running until stopped, closer in
// shape to OutboxDispatcher's own start()/stop() than to a repository. RabbitMqConsumer
// implements this so callers (e.g. the embedding worker entrypoint) can depend on the
// port instead of the concrete RabbitMQ class — the same testability motivation that
// OutboxRepository already gave OutboxDispatcher (swap in a fake, no real broker needed).
export type Consumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};
