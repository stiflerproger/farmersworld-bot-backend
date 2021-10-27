import { registerAs } from '@nestjs/config';
import { getEnv } from '@skinsmart/config';
import { Transport, ClientOptions } from '@nestjs/microservices';

export default registerAs(
  'nats-client',
  (): ClientOptions => ({
    transport: Transport.NATS,
    options: {
      url: getEnv('APP_NATS_CLIENT_URL', String, 'nats://127.0.0.1:4222'),
    },
  }),
);
