import * as crypto from 'crypto';

export class AccountNonceGenerator {
  readonly #salt: crypto.KeyObject;

  constructor(salt: string | Buffer) {
    if (typeof salt === 'string') {
      salt = Buffer.from(salt);
    } else if (!Buffer.isBuffer(salt)) {
      throw new Error('salt must be a string or buffer');
    }

    this.#salt = crypto.createSecretKey(salt);
  }

  genNonce(accountName: string, permission: string, tag?: string): string {
    accountName = accountName.toLowerCase();
    permission = permission.toLowerCase();
    tag = tag ? tag.toLowerCase() : 'default';

    return crypto
      .createHmac('sha256', this.#salt)
      .update(`${accountName}_${permission}_${tag}`)
      .digest('hex');
  }
}
