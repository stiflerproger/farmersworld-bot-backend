import { TelegramService } from '../telegram.service';

export const withUser = async function (
  this: TelegramService,
  ctx: TelegramService['bot']['context'],
  next: Function,
  force?: boolean,
) {
  let user = this.users.get(String(ctx.from.id));

  if (!user || force) {
    // TODO: запросить юзера с базы данных
    user = await this.accountsService.getAccount(ctx.from.id);

    this.users.set(String(ctx.from.id), user);
  }

  ctx.$user = user;

  return next();
};
