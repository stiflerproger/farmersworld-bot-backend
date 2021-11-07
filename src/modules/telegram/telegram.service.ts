import {Injectable, OnModuleInit} from "@nestjs/common";
import {ConfigService} from "@nestjs/config";
import { Context, Telegraf, Markup } from 'telegraf';
import {mBots, mDeposit, mHello, mProfile} from "./utils/messages";
import * as mTemplates from "./utils/messages";
import {AccountsService} from "../accounts/accounts.service";
import {withUser} from "./middlewares/with-user";
import {CoreService} from "../core/core.service";

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
    readonly coreService: CoreService,
  ) {

    this.#apiKey = this.config.get('telegram.apiKey');

    this.bot = new Telegraf(this.#apiKey);

  }

  async onModuleInit() {

    // TODO: Обработка ошибок
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

    // ===== PROFILE =====

    this.bot.hears(this.#menu.profile, async (ctx) => {
      // форсим обновление юзера
      await withUser.call(this, ctx, () => {}, true);

      ctx.reply(
        mProfile({
          balance: ctx.$user.balance
        }),
        Markup.inlineKeyboard([
          Markup.button.callback('➕ Пополнить', 'profile.deposit')
        ])
      );
    });

    this.bot.action('profile.deposit', async (ctx) => {
      const deposit = await this.accountsService.getAccountDeposit(ctx.from.id);

      await ctx.answerCbQuery();

      await ctx.reply(mDeposit({
        account: deposit.address,
        memo: deposit.memo,
        min: deposit.min,
      }), {
        parse_mode: 'HTML'
      });
    });

    // ===== BOTS =====

    this.bot.hears(this.#menu.bots, async (ctx) => {
      ctx.reply(
        mBots(),
        await getBotsPageKeyboard.call(this, ctx.from.id)
      );
    });

    this.bot.action('bots.page.*', async (ctx) => {
      console.log(ctx)
    })

    // TODO: test
    async function getBotsPageKeyboard(this: TelegramService, telegramId: number, page = 1) {
      const pageAmount = 10; // количество кнопок ботов на 1 странице
      const newBotPrice = 100; // цена нового бота в центах
      const botsIds = await this.accountsService.getAccountBotsIds(telegramId);
      const bots = await this.coreService.getBotsByIds(botsIds);

      const pagination = [];

      if ( bots[ (page - 1) * pageAmount - 1 ] ) pagination.push(Markup.button.callback('< Пред.', 'bots.page.' + (page - 1)))
      if ( bots[ (page - 1) * pageAmount + pageAmount + 1 ] ) pagination.push(Markup.button.callback('След. >', 'bots.page.' + (page + 1)))

      const keyboard: any = [
        Markup.button.callback( `➕ Создать -$${newBotPrice / 100}`, 'bots.create'),
        ...bots
          .slice((page-1) * pageAmount, (page-1) * pageAmount + pageAmount)
          .map(bot => Markup.button.callback( `#${bot.id} ${bot.wax.userAccount || ''}`, 'bots.load.' + bot.id)),
        ...(pagination.length ? [pagination] : []),
      ];

      return Markup.inlineKeyboard(keyboard);
    }

    await this.bot.launch();

  }

  /** Выслать сообщение юзеру, применив шаблон и его параметры */
  async sendMessageTemplate(to: number, template: string, args?: any) {
    const templateFunction = mTemplates[template];

    if (typeof templateFunction !== 'function') throw 'Template doesnt exists';

    return await this.bot.telegram.sendMessage(to, templateFunction(args || {}), {
      parse_mode: 'HTML'
    });
  }

  /** Выслать сообщение юзеру (парсер HTML) */
  async sendMessage(to: number, message: string) {
    return await this.bot.telegram.sendMessage(to, message, {
      parse_mode: "HTML"
    });
  }

}