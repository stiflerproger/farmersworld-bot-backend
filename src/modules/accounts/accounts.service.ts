import {Inject, Injectable} from '@nestjs/common';
import {ClientProxy} from "@nestjs/microservices";

@Injectable()
export class AccountsService {

  constructor(
    @Inject('NATS_CLIENT')
    readonly natsClient: ClientProxy
  ) { }

  /** Запрос аккаунта с БД по telegramId */
  async getAccount(telegramId: number) {
    return {
      id: 1,
      balance: 125,
    }
  }

  /** Получить адрес для пополнения счёта аккаунта */
  async getAccountDeposit(telegramId: number) {
    return {
      address: 'waxonbackdeposit',
      memo: '246234',
      min: 3, // min wax для депозита (optional)
    }
  }

  /** Получить все аккаунты  */
  async getAllAccounts() {
    // TODO: nats запрос к БД
  }
}
