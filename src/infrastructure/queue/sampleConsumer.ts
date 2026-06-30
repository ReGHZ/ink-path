import {
    createRabbitMqConsumer,
    type RabbitMqConsumer,
    type RabbitMqMessage,
} from "./consumer.js";

import type { RabbitMqManager } from "./rabbitmqManager.js";


const SAMPLE_QUEUE = "sample-consumer";

const SAMPLE_ROUTING_KEY_PATTERN = "content.created";

type SampleMessage = RabbitMqMessage;

export type SampleConsumerOptions = {
    rabbitmq: RabbitMqManager;
    onMessage: (message: SampleMessage) => void;
};

export function createSampleConsumer(
    options: SampleConsumerOptions,
): RabbitMqConsumer {
    return createRabbitMqConsumer(options.rabbitmq, {
        queue: SAMPLE_QUEUE,
        routingKeyPattern: SAMPLE_ROUTING_KEY_PATTERN,
        handleMessage: (message: SampleMessage) => {
            options.onMessage(message);
        },
    });
}