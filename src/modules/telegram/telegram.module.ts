import {Module} from "@nestjs/common";
import {TelegramService} from "./telegram.service";
import {AccountsModule} from "../accounts/accounts.module";

@Module({
  imports: [AccountsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {
  
}