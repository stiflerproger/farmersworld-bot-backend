import { registerAs } from '@nestjs/config';
import { getEnv } from '@skinsmart/config';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

export const getBootstrapConfig = registerAs(
  'app/bootstrap',
  (): MicroserviceOptions => ({
    transport: Transport.NATS,
    options: {
      url: getEnv('APP_NATS_URL', String, 'nats://127.0.0.1:4222'),
    },
  }),
);

export default getBootstrapConfig;
