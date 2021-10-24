import {Injectable} from "@nestjs/common";

@Injectable()
export class AccountsService {

  // TODO: добавить глобальное объявление сервера

  /** Получить все аккаунты для сервера с установленным id */
  async getAllAccountsForServer(serverId: number = 1) {
    if (typeof serverId !== 'number' || serverId < 0) throw new Error("'serverId' must be set");

    // TODO: nats запрос к БД
  }

}