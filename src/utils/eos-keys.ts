import { Numeric } from 'eosjs';

export function convertPubKeysToNewFormat(keys: string[]): string[] {
  if (!Array.isArray(keys)) keys = [];

  return keys.map((key) => Numeric.publicKeyToString(Numeric.stringToPublicKey(key)));
}
