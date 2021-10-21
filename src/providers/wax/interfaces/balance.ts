import { Asset, SymbolCode, Name } from 'eos-common';

export interface ReserveBalanceOptions {
  quantity:
    | string
    | Asset
    | SymbolCode
    | {
        min?: string | Asset;
        max?: string | Asset;
      };
  key?: string | symbol;
  freshness?: number;
  schedule?: boolean;
  swap?:
    | boolean
    | {
        tokens?: string[];
      };
  timeout?: number;
}

export type ReserveBalanceClosure<T> = (quantity: Asset, contract: Name) => T | Promise<T>;

export interface ReserveBalanceResultWithRelease {
  quantity: Asset;
  contract: Name;
  release: () => void;
}
