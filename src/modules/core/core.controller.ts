import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';

@Controller()
export class CoreController {
  /** Блокчейн боты юзера */
  @MessagePattern(`farmersworld.bot.getUserBots`)
  async getUserBots() {
    // [cpu, ram, net], in game balance, tokens balance, in game stats (energy and tools conditions)
  }

  /** Получить определенного бота и данные по заданным фильтрам */
  @MessagePattern(`farmersworld.bot.getBotById`)
  async getBotById() {}

  /** Остановка работы бота в игре */
  @MessagePattern(`farmersworld.bot.stopById`)
  async stopBotById() {}

  /** Запуск бота в игре */
  @MessagePattern(`farmersworld.bot.startById`)
  async startBotById() {}

  /** Депозит предмета с блокчейна в игру */
  @MessagePattern(`farmersworld.bot.stakeTool`)
  async stakeBotTool() {}

  /** Вывод предмета из в игры на блокчейн аккаунт */
  @MessagePattern(`farmersworld.bot.unstakeTool`)
  async unstakeBotTool() {}

  /** Вывод wax баланса */
  @MessagePattern(`farmersworld.bot.sendToken`)
  async sendToken() {}

  /** Вывод NFT токена */
  @MessagePattern(`farmersworld.bot.sendNft`)
  async sendNft() {}
}
