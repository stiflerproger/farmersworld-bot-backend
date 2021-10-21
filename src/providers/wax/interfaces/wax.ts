import { ApiInterfaces } from 'eosjs';
import { AntiCaptcha } from '@providers/anticaptcha';

export interface FuelProvider {
  userAccount: string;
  permission: string;
  signatureProvider: ApiInterfaces.SignatureProvider;
}

export interface WaxOptions {
  /**
   * Параметры если это аккаунт WAX Wallet
   */
  waxManagedAccountOptions?: {
    anticaptcha: AntiCaptcha;
    recaptchaWebsiteKey?: string;
  };
  /**
   * Параметры если это самоуправляемый аккаунт
   */
  selfManagedAccountOptions?: {
    userAccount: string;
    signatureProvider: ApiInterfaces.SignatureProvider;
  };
  /**
   * Оплата транзакций другим аккаунтом
   */
  fuelProvider?: FuelProvider | (() => FuelProvider | Promise<FuelProvider>);
  rpcEndpoint?: string | string[];
  hyperionRpcEndpoint?: string | string[];
  atomicRpcEndpoint?: string;
  atomicNamespace?: string;
  proxy?: string;
  userAgent?: string;
}
