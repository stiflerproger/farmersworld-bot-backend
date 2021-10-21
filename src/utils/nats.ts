import { Client as NatsClient } from 'nats';

export function getNativeNatsClient(client: any): NatsClient {
  if (client.natsClient) {
    client = client.natsClient;
  }

  if (
    typeof client.subscribe === 'function' &&
    typeof client.publish === 'function' &&
    typeof client.request === 'function'
  ) {
    return client;
  }

  throw new Error('Cannot get native nats client');
}
