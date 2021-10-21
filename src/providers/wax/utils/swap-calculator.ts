import * as eosCommon from 'eos-common';
import { AlcorAmmSwapInfo, AlcorAmmSwapPair } from '../interfaces';

export function createSwapCalculator(
  pairs: Map<string, AlcorAmmSwapPair>,
): AlcorAmmSwapInfo['calculate'] {
  return (input, output) => {
    if (typeof input === 'string') {
      if (input.split(' ').length > 1) {
        input = eosCommon.asset(input.toUpperCase());
      } else {
        input = eosCommon.symbol_code(input.toUpperCase());
      }
    } else if (!(input instanceof eosCommon.Asset || input instanceof eosCommon.SymbolCode)) {
      throw new Error('Invalid type for input');
    }

    if (typeof output === 'string') {
      if (output.split(' ').length > 1) {
        output = eosCommon.asset(output.toUpperCase());
      } else {
        output = eosCommon.symbol_code(output.toUpperCase());
      }
    } else if (!(output instanceof eosCommon.Asset || output instanceof eosCommon.SymbolCode)) {
      throw new Error('Invalid type for output');
    }

    if (input.typeof === output.typeof) {
      throw new Error('Input and output cannot be the same type');
    }

    const inputSymCode = input instanceof eosCommon.Asset ? input.symbol.code() : input;
    const outputSymCode = output instanceof eosCommon.Asset ? output.symbol.code() : output;
    const pair = pairs.get(`${inputSymCode}/${outputSymCode}`);

    if (!pair) {
      throw new Error(`No pair found for ${inputSymCode}/${outputSymCode}`);
    }

    const [poolIn, poolOut] = inputSymCode.isEqual(pair.pool1.quantity.symbol.code())
      ? [pair.pool1, pair.pool2]
      : [pair.pool2, pair.pool1];

    if (input instanceof eosCommon.Asset) {
      input = eosCommon.asset_to_precision(input, poolIn.quantity.symbol.precision());

      const amountInWithFee = input.amount.multiply(10000 - pair.fee);
      const numerator = amountInWithFee.multiply(poolOut.quantity.amount);
      const denominator = poolIn.quantity.amount.multiply(10000).add(amountInWithFee);
      const amountOut = numerator.divide(denominator);
      const minAmountOut = amountOut.minus(amountOut.multiply(50).divide(1000));

      return {
        pair,
        input: {
          quantity: input,
          contract: poolIn.contract,
        },
        output: {
          quantity: eosCommon.asset(amountOut, poolOut.quantity.symbol),
          minQuantity: eosCommon.asset(minAmountOut, poolOut.quantity.symbol),
          contract: poolOut.contract,
        },
      };
    }

    if (output instanceof eosCommon.Asset) {
      output = eosCommon.asset_to_precision(output, poolOut.quantity.symbol.precision());

      const amountOut = output.amount;
      const minAmountOut = amountOut.minus(amountOut.multiply(50).divide(1000));
      const amountOutWithFee = amountOut.multiply(10000 - pair.fee);
      const numerator = poolIn.quantity.amount.multiply(-10000).multiply(amountOut);
      const denominator = amountOutWithFee.minus(
        poolOut.quantity.amount.multiply(10000 - pair.fee),
      );
      const amountIn = numerator.divide(denominator);

      return {
        pair,
        input: {
          quantity: eosCommon.asset(amountIn, poolIn.quantity.symbol),
          contract: poolIn.contract,
        },
        output: {
          quantity: output,
          minQuantity: eosCommon.asset(minAmountOut, poolOut.quantity.symbol),
          contract: poolOut.contract,
        },
      };
    }

    throw new Error('Unexpected error. No Asset specified');
  };
}
