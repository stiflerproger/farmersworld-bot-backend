import { Module, ValidationPipe } from '@nestjs/common';
import { CoreModule } from './modules/core/core.module';
import { RpcExceptionFilter } from './filters/rpc-exception.filter';
import { commonPipeOptions } from './pipes/common-options';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import {readConfig} from "@utils/config";
import {ConfigModule} from "@nestjs/config";
import {NatsClientModule} from "./nats-client.module";
import {TelegramModule} from "./modules/telegram/telegram.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: readConfig([__dirname, 'config', '**', '*.config.{ts,js}']),
      ignoreEnvFile: true,
    }),
    NatsClientModule,
    TelegramModule,
    CoreModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: RpcExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe(commonPipeOptions),
    },
  ],
})
export class AppModule {}
