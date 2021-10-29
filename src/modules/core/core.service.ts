import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Bot } from '@providers/bot';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class CoreService implements OnModuleInit {
  readonly #bots: Map<number, Bot> = new Map();

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

  /** Остановка dapps бота */
  async disableBotApps(botId: number, dapps: { farmersworld?: true } = {}) {

    const bot = this.#bots.get(botId);

    if (!bot) throw 'Nothing to stop';

    if (dapps?.farmersworld) await bot.farmersworld.disable();

  }

  /** Запуск dapps бота */
  async enableBotApps(botId: number, dapps: { farmersworld?: true } = {}) {

    const bot = this.#bots.get(botId);

    if (!bot) throw 'Nothing to start';

    if (dapps?.farmersworld) await bot.farmersworld.enable();

  }
}
