import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { SendMessageTemplateDto } from './dto/send-message-template.dto';
import { TelegramService } from './telegram.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller()
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  /** Отправка сообщения по шаблону */
  @MessagePattern(`telegram.message.sendTemplate`)
  async sendMessageTemplate(@Payload() data: SendMessageTemplateDto) {
    return this.telegramService.sendMessageTemplate(
      data.to,
      data.template,
      data.arguments || {},
    );
  }

  /** Отправка сообщения */
  @MessagePattern(`telegram.message.sendMessage`)
  async sendMessage(@Payload() data: SendMessageDto) {
    return this.telegramService.sendMessage(data.to, data.message);
  }
}
