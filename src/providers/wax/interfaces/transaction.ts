import { ApiInterfaces } from 'eosjs';

export interface TransactOptions extends ApiInterfaces.TransactConfig {
  /**
   * Домен сайта, с которого выполняется транзакция (по умолчанию `wax.bloks.io`).
   * Нужен при подписи транзакции через WAX Wallet
   */
  website?: string;
  /**
   * Частичная подпись транзакции. Для проведения транзакций с подписями нескольких аккаунтов
   */
  partialSign?: {
    /**
     * Дополнительные публичные ключи от других аккаунтов что участвуют в транзакции
     */
    availableKeys: string[];
  };
  /**
   * Не проводить транзакцию если не хватает ресурсов (по умолчанию `true`)
   */
  throwIfNoResources?: boolean;
}

export interface PushTransactionOptions {
  compression?: boolean;
}
