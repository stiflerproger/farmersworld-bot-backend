import { Module, ValidationPipe } from '@nestjs/common';
import { CoreModule } from './modules/core/core.module';
import { RpcExceptionFilter } from './filters/rpc-exception.filter';
import { commonPipeOptions } from './pipes/common-options';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

@Module({
  imports: [CoreModule],
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
