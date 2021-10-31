import {Module} from "@nestjs/common";
import {TelegramService} from "./telegram.service";
import {AccountsModule} from "../accounts/accounts.module";
import {CoreModule} from "../core/core.module";

@Module({
  imports: [AccountsModule, CoreModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {
  
}