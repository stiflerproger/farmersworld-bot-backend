import * as crypto from 'crypto';

const EOS_NAME_FIRST_SYMBOL_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const EOS_NAME_BASIC_CHARS = EOS_NAME_FIRST_SYMBOL_CHARS + '12345';

// Статичный ключ для генерации сидов
const SEED_HMAC_KEY = crypto.createSecretKey(
  Buffer.from('2QM9JyDhE0YLh4yVLnjD'),
);

export function randomAccountName(): string {
  return genAccountName(crypto.randomBytes(12));
}

export function seedAccountName(seed: string): string {
  return genAccountName(
    crypto.createHmac('sha1', SEED_HMAC_KEY).update(seed).digest(),
  );
}

function genAccountName(bytes: Buffer): string {
  if (bytes.length < 12) {
    throw new Error('Buffer must contains 12 bytes');
  }

  const results: string[] = new Array(12);

  results[0] = EOS_NAME_FIRST_SYMBOL_CHARS.charAt(
    bytes[0] % EOS_NAME_FIRST_SYMBOL_CHARS.length,
  );

  for (let i = 1, l = results.length; i < l; i++) {
    results[i] = EOS_NAME_BASIC_CHARS.charAt(
      bytes[i] % EOS_NAME_BASIC_CHARS.length,
    );
  }

  return results.join('');
}
