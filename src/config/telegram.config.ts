import { registerAs } from '@nestjs/config';
import { getEnvOrFail } from '@skinsmart/config';

export default registerAs('telegram', () => ({
  apiKey: getEnvOrFail('TELEGRAM_API_KEY', String),
}));
