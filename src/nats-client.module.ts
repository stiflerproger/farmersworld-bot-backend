import { Global, Module } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  providers: [
    {
      provide: 'NATS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        const clientProxy: ClientProxy = ClientProxyFactory.create(
          configService.get('nats-client'),
        );

        await clientProxy.connect();

        return clientProxy;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['NATS_CLIENT'],
})
export class NatsClientModule {}
