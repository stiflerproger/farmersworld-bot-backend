import {Controller} from "@nestjs/common";
import {MessagePattern} from "@nestjs/microservices";

@Controller()
export class AccountsController {

  /** Информация юзера, не привязанная к блокчейну,  */
  @MessagePattern(`server.account.getUser`)
  async getUserByTelegramId() {}

  /** Адрес аккаунта и его memo для пополнения баланса юзера */
  @MessagePattern(`server.account.getDepositAddress`)
  async getDepositAddress() {}

  /** Создание нового аккаунта в eosio и привязка к юзеру */
  @MessagePattern(`server.account.createEos`)
  async createEosioAccount() {}

  /** Eosio аккаунты юзеры */
  @MessagePattern(`server.account.getUserEos`)
  async getUserEosioAccounts() {
    // у каждого аккаунта есть список активных игр
  }

}