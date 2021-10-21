import { totp } from 'notp';
import * as base32 from 'thirty-two';

export function gen2fa(secret: string): string {
  return totp.gen(base32.decode(secret.replace(/\s/g, '')));
}
