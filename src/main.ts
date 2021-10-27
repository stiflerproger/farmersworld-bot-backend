// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@skinsmart/config').loadEnv();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions } from '@nestjs/microservices';
import { getBootstrapConfig } from './config/bootstrap.config';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    getBootstrapConfig(),
  );

  await app.listen();
}
bootstrap();
