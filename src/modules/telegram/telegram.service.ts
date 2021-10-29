import {Injectable, OnModuleInit} from "@nestjs/common";
import {ConfigService} from "@nestjs/config";
import { Context, Telegraf, Markup } from 'telegraf';
import {mDeposit, mHello, mProfile} from "./utils/messages";
import {AccountsService} from "../accounts/accounts.service";
import {withUser} from "./middlewares/with-user";

interface MyContext extends Context {
  $user?: any;
}

@Injectable()
export class TelegramService implements OnModuleInit {

  readonly #apiKey: string;

  readonly bot: Telegraf<MyContext>;
  readonly users: Map<string, any> = new Map();

  readonly #menu = {
    'profile': '🧓 Мой профиль',
    'bots': '🤖 Мои Боты',
    'faq': '📚 FAQ',
  };

  constructor(
    readonly config: ConfigService,
    readonly accountsService: AccountsService,
  ) {

    this.#apiKey = this.config.get('telegram.apiKey');

    this.bot = new Telegraf(this.#apiKey);

  }

  async onModuleInit() {

    // к каждому юзеру добавляем $user. Первый запрос с БД, оставльные через this.users
    this.bot.use(withUser.bind(this));

    this.bot.start((ctx) => {
      ctx.reply(
        mHello(),
        Markup.keyboard(Object.values(this.#menu), {
          wrap: (btn, index, currentRow) => currentRow.length >= (index + 1) / 2
        }).resize(true)
      );
    });

    this.bot.hears(this.#menu.profile, async (ctx) => {
      // форсим обновление юзера
      await withUser.call(this, ctx, () => {}, true);

      ctx.reply(
        mProfile(ctx.$user.balance),
        Markup.inlineKeyboard([
          Markup.button.callback('➕ Пополнить', 'profile.deposit')
        ])
      );
    });


    // ===== PROFILE =====

    this.bot.action('profile.deposit', async (ctx) => {
      const deposit = await this.accountsService.getAccountDeposit(ctx.from.id);

      await ctx.reply(mDeposit(deposit.address, deposit.memo, deposit.min), {
        parse_mode: 'HTML'
      });
    });


    await this.bot.launch();

  }



}