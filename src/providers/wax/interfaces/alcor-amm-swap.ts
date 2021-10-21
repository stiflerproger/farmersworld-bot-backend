import { Asset, SymbolCode } from 'eos-common';

export interface AlcorAmmSwapPair {
  id: number;
  supply: Asset;
  pool1: {
    quantity: Asset;
    contract: string;
  };
  pool2: {
    quantity: Asset;
    contract: string;
  };
  fee: number;
  fee_contract: string;
}

export interface AlcorAmmSwapCalculateResult {
  pair: AlcorAmmSwapPair;
  input: {
    quantity: Asset;
    contract: string;
  };
  output: {
    quantity: Asset;
    minQuantity: Asset;
    contract: string;
  };
}

export interface AlcorAmmSwapInfo {
  pairs: Map<string, AlcorAmmSwapPair>;
  calculate: (
    input: string | Asset | SymbolCode,
    output: string | Asset | SymbolCode,
  ) => AlcorAmmSwapCalculateResult;
}
