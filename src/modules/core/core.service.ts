import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Bot } from '@providers/bot';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class CoreService implements OnModuleInit {
  readonly #bots: Map<string, Bot> = new Map();

  readonly logger = new Logger(CoreService.name);

  constructor(
    @Inject(AccountsService)
    private readonly accountsService: AccountsService,
  ) {}

  async onModuleInit() {
    const userAccounts = await this.accountsService.getAllAccounts();

    // TODO: из полученных с БД аккаунтов, создавать ботов
    //const bot = new Bot()
  }
}
