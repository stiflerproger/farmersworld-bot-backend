import { Api, JsonRpc, ApiInterfaces, RpcInterfaces, RpcError } from 'eosjs';
import { Action, JsonRpc as HyperionJsonRpc } from '@eoscafe/hyperion';
import * as eosCommon from 'eos-common';
import { ExplorerApi } from 'atomicassets';
import { ApiTemplate } from 'atomicassets/build/API/Explorer/Types';
import { CookieJar } from 'tough-cookie';
import { configureFetch, FetchFunction } from '@utils/custom-fetch';
import { waitFor } from '@utils/wait-for';
import { convertPubKeysToNewFormat } from '@utils/eos-keys';
import { createSwapCalculator } from './utils/swap-calculator';
import { AtomicMarket, WaxWallet } from './classes';
import { WaxWebError } from './exceptions';
import {
  WaxOptions,
  TransactOptions,
  PushTransactionOptions,
  BandwidthInfo,
  ReserveBalanceOptions,
  ReserveBalanceClosure,
  ReserveBalanceResultWithRelease,
  AlcorAmmSwapInfo,
  AlcorAmmSwapCalculateResult,
  HistoryActionsOptions,
} from './interfaces';

const DEFAULT_RPC_ENDPOINT = 'https://wax.greymass.com';
const DEFAULT_ATOMIC_RPC_ENDPOINT = 'https://wax.api.atomicassets.io';
const DEFAULT_ATOMIC_NAMESPACE = 'atomicassets';
const DEFAULT_HYPERION_RPC_ENDPOINT = 'https://wax.eosrio.io';

const PREDEFINED_TOKENS_INFO: {
  symbol: string;
  precision: number;
  contract: string;
}[] = [
  {
    symbol: 'WAX',
    precision: 8,
    contract: 'eosio.token',
  },
  {
    symbol: 'FWW',
    precision: 4,
    contract: 'farmerstoken',
  },
  {
    symbol: 'FWG',
    precision: 4,
    contract: 'farmerstoken',
  },
  {
    symbol: 'FWF',
    precision: 4,
    contract: 'farmerstoken',
  },
];
const PREDEFINED_TOKENS_INFO_LOOKUP: {
  [symbol: string]: typeof PREDEFINED_TOKENS_INFO[number];
} = Object.create(null);

for (let i = 0, l = PREDEFINED_TOKENS_INFO.length; i < l; i++) {
  const info = PREDEFINED_TOKENS_INFO[i];

  PREDEFINED_TOKENS_INFO_LOOKUP[info.symbol] = info;
}

// Глобальный кэш для информации о стоимости RAM
const RAM_COST_INFO: RamCostInfo = { updated: 0 };
// Глобальный кэш для информации об обменных парах
const SWAP_INFO: SwapInfo = { updated: 0 };
// Глобальный кэш шаблонов
const ATOMIC_TEMPLATES_CACHE: {
  collections: Map<
    string,
    {
      templates: ApiTemplate[];
      updating?: boolean; // чтобы не запускать одновременных обновлений, но иметь актуальную информацию
      refreshed?: number;
    }
  >;
} = {
  collections: new Map(),
};

export class Wax {
  readonly #fetch: FetchFunction;
  readonly #isWaxManagedAccount: boolean;
  readonly #fuelProvider?: WaxOptions['fuelProvider'];
  readonly #accountInfo: AccountInfo = {
    updated: 0,
  };
  readonly #balanceInfo: BalanceInfo = {
    updated: 0,
  };
  readonly #transactResources: TransactResources = {
    failedTransacts: 0,
    nextTransactAttemptAfter: 0,
  };

  readonly waxWallet?: WaxWallet;
  readonly api: Api;
  readonly rpc: JsonRpc;
  readonly atomic: ExplorerApi;
  readonly hyperionRpc: HyperionJsonRpc;
  readonly atomicMarket: AtomicMarket;

  userAccount?: string;

  get isWaxManagedAccount(): boolean {
    return this.#isWaxManagedAccount;
  }

  get balance(): number {
    return null; // TODO: убрать все обращения и удалить геттер
  }

  get staked(): number {
    return null; // TODO: убрать все обращения и удалить геттер
  }

  get canTransact(): boolean {
    return this.#transactResources.nextTransactAttemptAfter <= Date.now();
  }

  constructor(options: WaxOptions) {
    options = { ...options };

    const fetch = configureFetch({
      cookieJar: new CookieJar(),
      proxy: options.proxy,
      userAgent: options.userAgent,
    });

    this.#fetch = fetch;

    let signatureProvider: ApiInterfaces.SignatureProvider;

    if (options.waxManagedAccountOptions) {
      this.#isWaxManagedAccount = true;

      Object.defineProperties(this, {
        waxWallet: {
          configurable: true,
          enumerable: true,
          writable: false,
          value: new WaxWallet(fetch, options.waxManagedAccountOptions),
        },
        userAccount: {
          configurable: true,
          enumerable: true,
          get: () => this.waxWallet.userAccount,
        },
      });

      signatureProvider = {
        getAvailableKeys: this.waxWallet.getAvailableKeys.bind(this.waxWallet),
        sign: this.waxWallet.signTransaction.bind(this.waxWallet),
      };
    } else if (options.selfManagedAccountOptions) {
      this.#isWaxManagedAccount = false;

      Object.defineProperty(this, 'userAccount', {
        configurable: true,
        enumerable: true,
        writable: false,
        value: options.selfManagedAccountOptions.userAccount,
      });

      if (!this.userAccount) {
        throw new Error('No userAccount specified');
      }

      signatureProvider = options.selfManagedAccountOptions.signatureProvider;

      if (
        !signatureProvider ||
        !signatureProvider.getAvailableKeys ||
        !signatureProvider.sign
      ) {
        throw new Error('No signatureProvider specified');
      }
    } else {
      throw new Error(
        'No waxManagedAccountOptions and selfManagedAccountOptions properties specified. One of them is required',
      );
    }

    if (options.fuelProvider) {
      this.#fuelProvider = options.fuelProvider;
    }

    if (!Array.isArray(options.rpcEndpoint)) {
      if (typeof options.rpcEndpoint === 'string') {
        options.rpcEndpoint = [options.rpcEndpoint];
      } else if (options.rpcEndpoint) {
        throw new Error('Invalid rpcEndpoint type');
      }
    }

    if (!Array.isArray(options.hyperionRpcEndpoint)) {
      if (typeof options.hyperionRpcEndpoint === 'string') {
        options.hyperionRpcEndpoint = [options.hyperionRpcEndpoint];
      } else if (options.hyperionRpcEndpoint) {
        throw new Error('Invalid hyperionRpcEndpoint type');
      }
    }

    this.rpc = new JsonRpc(DEFAULT_RPC_ENDPOINT, {
      fetch: options.rpcEndpoint
        ? fetch.createEndpointRewriteProxy(options.rpcEndpoint, {
            category: 'rpc',
            attempts: 3,
          })
        : fetch,
    });

    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: signatureProvider,
    });

    this.atomic = new ExplorerApi(
      options.atomicRpcEndpoint || DEFAULT_ATOMIC_RPC_ENDPOINT,
      options.atomicNamespace || DEFAULT_ATOMIC_NAMESPACE,
      {
        fetch: fetch as any,
      },
    );
    this.hyperionRpc = new HyperionJsonRpc(DEFAULT_HYPERION_RPC_ENDPOINT, {
      fetch: options.hyperionRpcEndpoint
        ? fetch.createEndpointRewriteProxy(options.hyperionRpcEndpoint, {
            category: 'hyperionRpc',
            attempts: 3,
          })
        : (fetch as any),
    });

    this.atomicMarket = new AtomicMarket(this, fetch);
  }

  /**
   * Возвращает название аккаунта, или ошибку если аккаунт не авторизован (в случае WaxManagedAccount)
   */
  getAccountNameOrFail(): string {
    if (this.userAccount) return this.userAccount;

    throw new WaxWebError('Not logged in', 'NOT_LOGGED_IN');
  }

  /**
   * Создает и опционально подписывает и отправляет транзакцию
   */
  async transact(
    transaction: any,
    {
      website,
      partialSign,
      throwIfNoResources,
      broadcast,
      sign,
      compression,
      blocksBehind,
      useLastIrreversible,
      expireSeconds,
    }: TransactOptions & { broadcast: false },
  ): Promise<RpcInterfaces.PushTransactionArgs>;
  async transact(
    transaction: any,
    {
      website,
      partialSign,
      throwIfNoResources,
      broadcast,
      sign,
      compression,
      blocksBehind,
      useLastIrreversible,
      expireSeconds,
    }: TransactOptions,
  ): Promise<ApiInterfaces.TransactResult>;
  async transact(
    transaction: any,
    {
      website,
      partialSign,
      throwIfNoResources = true,
      broadcast = true,
      sign = true,
      compression,
      blocksBehind,
      useLastIrreversible,
      expireSeconds,
    }: TransactOptions,
  ): Promise<ApiInterfaces.TransactResult | RpcInterfaces.PushTransactionArgs> {
    this.getAccountNameOrFail(); // Проверяем чтобы аккаунт был авторизован

    let info: RpcInterfaces.GetInfoResult;

    if (typeof blocksBehind === 'number' && useLastIrreversible) {
      throw new Error('Use either blocksBehind or useLastIrreversible');
    }

    if (throwIfNoResources && !this.canTransact) {
      throw new WaxWebError('Not enough resources to transact', 'NO_RESOURCES');
    }

    if (!this.api.chainId) {
      info = await this.api.rpc.get_info();
      this.api.chainId = info.chain_id;
    }

    const fuelProvider =
      typeof this.#fuelProvider === 'function'
        ? await this.#fuelProvider.call(null)
        : this.#fuelProvider;

    if (fuelProvider) {
      // Клонируем необходимые объекты/массивы
      transaction = { ...transaction };
      transaction.actions = [...transaction.actions];

      // Добавляем в начале авторизацию, чтобы повесить комиссию на указанный аккаунт
      transaction.actions.unshift({
        account: 'greymassnoop',
        name: 'noop',
        authorization: [
          {
            actor: fuelProvider.userAccount,
            permission: fuelProvider.permission,
          },
        ],
        data: {},
      });
    }

    if (
      (typeof blocksBehind === 'number' || useLastIrreversible) &&
      expireSeconds
    ) {
      transaction = await (this.api as any).generateTapos(
        info,
        transaction,
        blocksBehind,
        useLastIrreversible,
        expireSeconds,
      );
    }

    if (!(this.api as any).hasRequiredTaposFields(transaction)) {
      throw new Error('Required configuration or TAPOS fields are not present');
    }

    const abis: ApiInterfaces.BinaryAbi[] = await this.api.getTransactionAbis(
      transaction,
    );
    transaction = {
      ...transaction,
      context_free_actions: await this.api.serializeActions(
        transaction.context_free_actions || [],
      ),
      actions: await this.api.serializeActions(transaction.actions),
    };
    const serializedTransaction = this.api.serializeTransaction(transaction);
    const serializedContextFreeData = this.api.serializeContextFreeData(
      transaction.context_free_data,
    );

    let pushTransactionArgs: RpcInterfaces.PushTransactionArgs = {
      serializedTransaction,
      serializedContextFreeData,
      signatures: [],
    };

    if (sign) {
      const availableKeys = convertPubKeysToNewFormat(
        await this.api.signatureProvider.getAvailableKeys(),
      );
      const fuelAvailableKeys = convertPubKeysToNewFormat(
        fuelProvider &&
          (await fuelProvider.signatureProvider.getAvailableKeys()),
      );
      const allAvailableKeys = Array.from(
        new Set([
          ...availableKeys,
          ...fuelAvailableKeys,
          ...convertPubKeysToNewFormat(partialSign?.availableKeys),
        ]),
      );

      const allRequiredKeys = convertPubKeysToNewFormat(
        await this.api.authorityProvider.getRequiredKeys({
          transaction,
          availableKeys: allAvailableKeys,
        }),
      );
      const restRequiredKeys: string[] = [];
      const fuelRequiredKeys: string[] = [];
      const requiredKeys: string[] = [];

      for (let i = 0, l = allRequiredKeys.length; i < l; i++) {
        const key = allRequiredKeys[i];

        if (availableKeys.includes(key)) {
          requiredKeys.push(key);

          continue;
        }

        if (fuelAvailableKeys.includes(key)) {
          fuelRequiredKeys.push(key);

          continue;
        }

        restRequiredKeys.push(key);
      }

      pushTransactionArgs = await (this.api.signatureProvider.sign as any)({
        website,
        chainId: this.api.chainId,
        requiredKeys,
        serializedTransaction,
        serializedContextFreeData,
        abis,
      });

      if (fuelProvider) {
        const fuelPushTransactionArgs: RpcInterfaces.PushTransactionArgs =
          await (fuelProvider.signatureProvider.sign as any)({
            website,
            chainId: this.api.chainId,
            requiredKeys: fuelRequiredKeys,
            serializedTransaction,
            serializedContextFreeData,
            abis,
          });

        // Добавляем и подписи аккаунта предоставляющего ресурсы
        pushTransactionArgs.signatures.push(
          ...fuelPushTransactionArgs.signatures,
        );
      }

      pushTransactionArgs[Symbol.for('SignOptions')] = {
        website,
        chainId: this.api.chainId,
        requiredKeys,
        restRequiredKeys,
        serializedTransaction,
        serializedContextFreeData,
        abis,
      };
    }

    if (broadcast) {
      return this.pushTransaction(pushTransactionArgs, { compression });
    }

    return pushTransactionArgs;
  }

  /**
   * Отправка подписанной транзакции
   */
  async pushTransaction(
    pushTransactionArgs: RpcInterfaces.PushTransactionArgs,
    { compression }: PushTransactionOptions = {},
  ): Promise<ApiInterfaces.TransactResult> {
    let result: ApiInterfaces.TransactResult;

    try {
      if (compression) {
        result = await this.api.pushCompressedSignedTransaction(
          pushTransactionArgs,
        );
      } else {
        result = await this.api.pushSignedTransaction(pushTransactionArgs);
      }
    } catch (e) {
      if (e instanceof RpcError) {
        if (
          ['tx_net_usage_exceeded', 'tx_cpu_usage_exceeded'].includes(
            e.json?.error?.name,
          )
        ) {
          const transactResources = this.#transactResources;

          // Обновляем только если пред. время прошло
          if (transactResources.nextTransactAttemptAfter <= Date.now()) {
            ++transactResources.failedTransacts;

            // Не ограничиваем пока количество ошибок подряд связанных с ресурсами меньше 3
            const attemptsOverrun = Math.max(
              0,
              transactResources.failedTransacts - 2,
            );

            if (attemptsOverrun) {
              // Ставим время ожидания с шагом в 5 минут, но не больше 30 минут
              transactResources.nextTransactAttemptAfter =
                Date.now() +
                Math.min(
                  1800000, // 30 минут
                  attemptsOverrun * 300000, // 5 минут
                );
            }
          }
        }
      }

      throw e;
    }

    const transactResources = this.#transactResources;

    transactResources.failedTransacts = 0;
    transactResources.nextTransactAttemptAfter = 0;

    return result;
  }

  /**
   * Получить информацию о транзакции
   */
  async getHistoryTransaction(options: {
    id: string;
    blockNumHint?: number;
    attempts?: number;
    interval?: number;
  }): Promise<RpcInterfaces.GetTransactionResult> {
    options = { ...options };

    options.attempts = Math.max(1, Math.round(options.attempts));
    if (Number.isNaN(options.attempts)) options.attempts = 1;

    options.interval = Math.max(1000, Math.round(options.interval));
    if (Number.isNaN(options.interval)) options.interval = 5000;

    for (let i = 0; i < options.attempts; i++) {
      if (i) {
        await waitFor(options.interval);
      }

      let transaction: RpcInterfaces.GetTransactionResult;

      try {
        transaction = await this.api.rpc.history_get_transaction(
          options.id,
          options.blockNumHint,
        );
      } catch (e) {
        if (e instanceof RpcError && e.json?.error === 'not found') {
          continue;
        }

        throw e;
      }

      return transaction;
    }

    throw new WaxWebError('Transaction not found', 'TRANSACTION_NOT_FOUND');
  }

  /**
   * Получить информацию об аккаунте
   */
  getAccount(options?: {
    userAccount?: string;
    freshness?: number;
  }): Promise<RpcInterfaces.GetAccountResult> {
    const accountInfo = this.#accountInfo;

    return new Promise((resolve, reject) => {
      options = { ...options };

      let isOwn: boolean;

      if (!options.userAccount) {
        options.userAccount = this.getAccountNameOrFail();

        isOwn = true;
      } else if (options.userAccount === this.userAccount) {
        isOwn = true;
      }

      // Если не наш аккаунт, то просто запрашиваем данные и не кэшируем
      if (!isOwn) {
        fetchAccount.call(this, options.userAccount).then(resolve, reject);

        return;
      }

      if (accountInfo.pending) {
        accountInfo.pending.push({
          handlers: [resolve, reject],
          options: {
            userAccount: options.userAccount,
          },
        });

        return;
      }

      let freshness = Math.max(0, Math.round(options.freshness));
      if (!Number.isFinite(freshness)) freshness = 10000; // По умолчанию используем кэш в 10 сек

      if (
        accountInfo.updated + freshness > Date.now() &&
        accountInfo.account.account_name === options.userAccount
      ) {
        resolve(accountInfo.account);

        return;
      }

      accountInfo.pending = [
        {
          handlers: [resolve, reject],
          options: {
            userAccount: options.userAccount,
          },
        },
      ];

      update.call(this, options.userAccount).then(
        () => {
          const pending = accountInfo.pending;
          accountInfo.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            if (
              accountInfo.account.account_name ===
              pending[i].options.userAccount
            ) {
              pending[i].handlers[0](accountInfo.account);
            } else {
              pending[i].handlers[1](
                new Error('Unexpected error. Logged account name changed'),
              );
            }
          }
        },
        (err) => {
          const pending = accountInfo.pending;
          accountInfo.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            pending[i].handlers[1](err);
          }
        },
      );
    });

    async function update(this: Wax, userAccount: string): Promise<void> {
      accountInfo.account = await fetchAccount.call(this, userAccount);
      accountInfo.updated = Date.now();
    }

    async function fetchAccount(
      this: Wax,
      userAccount: string,
    ): Promise<RpcInterfaces.GetAccountResult> {
      let account: RpcInterfaces.GetAccountResult;

      try {
        account = await this.api.rpc.get_account(userAccount);
      } catch (e) {
        if (e instanceof RpcError && Array.isArray(e.json?.error?.details)) {
          for (const details of e.json.error.details) {
            if (/^unknown key/i.test(details?.message)) {
              throw new WaxWebError(
                `Account "${userAccount}" not found`,
                'ACCOUNT_NOT_FOUND',
              );
            }
          }
        }

        throw e;
      }

      if (!account) {
        throw new WaxWebError(
          `Account "${userAccount}" not found`,
          'ACCOUNT_NOT_FOUND',
        );
      }

      return account;
    }
  }

  /**
   * Получить информацию о ресурсах для проведения транзакций
   */
  async getBandwidthInfo(options?: {
    userAccount?: string;
    freshness?: number;
  }): Promise<BandwidthInfo> {
    options = { ...options };

    const account = await this.getAccount({
      userAccount: options.userAccount,
      freshness: options.freshness,
    });
    const resources = {
      ram: {
        total: +account.ram_quota,
        used: +account.ram_usage,
      },
      net: {
        total: +account.net_limit.max,
        used: +account.net_limit.used,
      },
      cpu: {
        total: +account.cpu_limit.max,
        used: +account.cpu_limit.used,
      },
    };

    for (const k in resources) {
      if (!Object.prototype.hasOwnProperty.call(resources, k)) continue;

      if (
        !Number.isFinite(resources[k].total) ||
        !Number.isFinite(resources[k].used)
      ) {
        throw new WaxWebError(
          `Invalid account resource data (${k} = ${resources[k].used}/${resources[k].total})`,
        );
      }
    }

    const netWeight = eosCommon.asset(account.total_resources.net_weight);
    const cpuWeight = eosCommon.asset(account.total_resources.cpu_weight);

    return {
      ram: {
        total: resources.ram.total,
        used: resources.ram.used,
        available: Math.max(0, resources.ram.total - resources.ram.used),
        overdraft: Math.max(0, resources.ram.used - resources.ram.total),
      },
      net: {
        total: resources.net.total,
        used: resources.net.used,
        available: Math.max(0, resources.net.total - resources.net.used),
        overdraft: Math.max(0, resources.net.used - resources.net.total),
        pricePerUnit: {
          amount: netWeight.amount.toJSNumber() / resources.net.total,
          symbol: netWeight.symbol,
        },
      },
      cpu: {
        total: resources.cpu.total,
        used: resources.cpu.used,
        available: Math.max(0, resources.cpu.total - resources.cpu.used),
        overdraft: Math.max(0, resources.cpu.used - resources.cpu.total),
        pricePerUnit: {
          amount: cpuWeight.amount.toJSNumber() / resources.cpu.total,
          symbol: cpuWeight.symbol,
        },
      },
    };
  }

  /**
   * Получить информацию о балансе
   */
  getBalance(options?: {
    tokens?: string[];
    freshness?: number;
    ignoreReservations?: boolean;
  }): Promise<eosCommon.ExtendedAsset[]>;
  getBalance(options: {
    tokens?: string[];
    freshness?: number;
    ignoreReservations?: boolean;
    convertTo: string;
  }): Promise<eosCommon.ExtendedAsset>;
  getBalance(options: {
    token: string;
    freshness?: number;
    ignoreReservations?: boolean;
    convertTo?: string;
  }): Promise<eosCommon.ExtendedAsset>;
  getBalance(options?: {
    token?: string;
    tokens?: string[];
    freshness?: number;
    ignoreReservations?: boolean;
    convertTo?: string;
  }): Promise<eosCommon.ExtendedAsset | eosCommon.ExtendedAsset[]> {
    const balanceInfo = this.#balanceInfo;

    return new Promise((resolve, reject) => {
      options = { ...options };

      if (options.token && typeof options.token !== 'string') {
        reject(new Error('Property token must be a string'));

        return;
      }

      if (
        options.tokens &&
        !(Array.isArray(options.tokens) && options.tokens.length)
      ) {
        reject(new Error('Property tokens must be a non empty array'));

        return;
      }

      if (typeof options.convertTo === 'string') {
        options.convertTo = options.convertTo.toUpperCase();
      } else if (options.convertTo) {
        reject(new Error('Property convertTo must be a string'));

        return;
      }

      if (balanceInfo.pending) {
        balanceInfo.pending.push({
          handlers: [resolve, reject],
          options,
        });

        return;
      }

      let freshness = Math.max(0, Math.round(options.freshness));
      if (!Number.isFinite(freshness)) freshness = 10000; // По умолчанию используем кэш в 10 сек

      if (balanceInfo.updated + freshness > Date.now()) {
        const pending: BalanceInfo['pending'] = [
          {
            handlers: [resolve, reject],
            options,
          },
        ];

        if (options.convertTo) {
          this.getSwapInfo().then(() => {
            resolvePending(pending);
          }, reject);
        } else {
          resolvePending(pending);
        }

        return;
      }

      const userAccount = this.getAccountNameOrFail();

      balanceInfo.pending = [
        {
          handlers: [resolve, reject],
          options,
        },
      ];

      update.call(this, userAccount).then(
        async () => {
          if (balanceInfo.pending.some((op) => !!op.options.convertTo)) {
            try {
              // Обновляем инфу при необходимости
              await this.getSwapInfo();
            } catch (e) {
              // В случае ошибки обновления, обрабатываем только запросы без конвертации
              const pending = balanceInfo.pending;
              balanceInfo.pending = null;

              resolvePending(
                pending,
                e || new Error('Unknown error fetching swap info'),
              );

              return;
            }
          }

          const pending = balanceInfo.pending;
          balanceInfo.pending = null;

          resolvePending(pending);
        },
        (err) => {
          const pending = balanceInfo.pending;
          balanceInfo.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            pending[i].handlers[1](err);
          }
        },
      );
    });

    async function update(this: Wax, userAccount: string): Promise<void> {
      const tokens: {
        symbol: string;
        precision: number;
        amount: bigint;
        contract: string;
      }[] = [];

      let hyperionFailed: boolean;

      if ((balanceInfo.hyperionLastFailTime || 0) + 600000 > Date.now()) {
        hyperionFailed = true;
      } else {
        try {
          const response = await this.hyperionRpc.get_tokens(userAccount);

          for (let i = response.tokens.length - 1; i >= 0; i--) {
            const precision = +response.tokens[i].precision || 0;

            tokens.push({
              symbol: response.tokens[i].symbol.toUpperCase(),
              precision,
              amount: BigInt(
                (+response.tokens[i].amount || 0)
                  .toFixed(precision)
                  .replace('.', ''),
              ),
              contract: response.tokens[i].contract,
            });
          }
        } catch (e) {
          balanceInfo.hyperionLastFailTime = Date.now();

          hyperionFailed = true;
        }
      }

      // Прибегаем к запасному способу загрузки балансов
      if (hyperionFailed) {
        const response = await this.#fetch(
          `https://lightapi.eosamsterdam.net/api/balances/wax/${userAccount}`,
          {
            method: 'GET',
          },
        );
        const body = await response.json();

        if (!Array.isArray(body.balances)) {
          throw new Error('Malformed lightapi.eosamsterdam.net response');
        }

        for (let i = body.balances.length - 1; i >= 0; i--) {
          const precision = +body.balances[i].decimals || 0;

          let amount: bigint;

          if (
            typeof body.balances[i].amount === 'string' &&
            (body.balances[i].amount.split('.')[1]?.length ?? 0) === precision
          ) {
            amount = +body.balances[i].amount
              ? BigInt(body.balances[i].amount.replace('.', ''))
              : BigInt(0);
          } else {
            amount = BigInt(
              (+body.balances[i].amount || 0)
                .toFixed(precision)
                .replace('.', ''),
            );
          }

          tokens.push({
            symbol: body.balances[i].currency.toUpperCase(),
            precision,
            amount,
            contract: body.balances[i].contract,
          });
        }
      }

      // Добавляем предопределенные данные об основных токенах, если их нету
      for (let i = 0, l = PREDEFINED_TOKENS_INFO.length; i < l; i++) {
        const token = PREDEFINED_TOKENS_INFO[i];

        if (tokens.some((existing) => token.symbol === existing.symbol))
          continue;

        tokens.push({
          ...token,
          amount: BigInt(0),
        });
      }

      const formatted: BalanceInfo['tokens'] = new Map();

      for (let i = tokens.length - 1; i >= 0; i--) {
        const oldTokenInfo =
          balanceInfo.tokens && balanceInfo.tokens.get(tokens[i].symbol);
        const reservations: BalanceToken['_reservations'] = [];

        if (oldTokenInfo) {
          let precisionDiffMultiply: bigint;
          let precisionDiffDivide: bigint;

          if (tokens[i].precision > oldTokenInfo.precision) {
            precisionDiffMultiply = BigInt(
              Math.pow(10, tokens[i].precision - oldTokenInfo.precision),
            );
          } else if (oldTokenInfo.precision > tokens[i].precision) {
            precisionDiffDivide = BigInt(
              Math.pow(10, oldTokenInfo.precision - tokens[i].precision),
            );
          }

          const timeNow = Date.now();

          for (let y = 0, l = oldTokenInfo._reservations.length; y < l; y++) {
            const reserv = oldTokenInfo._reservations[y];

            if (
              reserv.expired ||
              (reserv.expireAt != null && reserv.expireAt <= timeNow)
            )
              continue;

            // Корректируем в случае изменения precision
            if (precisionDiffMultiply) {
              reserv.amount = reserv.amount * precisionDiffMultiply;

              if (reserv.scheduled) {
                reserv.scheduled.filled =
                  reserv.scheduled.filled * precisionDiffMultiply;
              }
            } else if (precisionDiffDivide) {
              reserv.amount = reserv.amount / precisionDiffDivide;

              if (reserv.scheduled) {
                reserv.scheduled.filled =
                  reserv.scheduled.filled / precisionDiffDivide;
              }
            }

            reservations.push(reserv);
          }
        }

        formatted.set(tokens[i].symbol, {
          ...tokens[i],
          _reservations: reservations,
        });
      }

      balanceInfo.tokens = formatted;
      balanceInfo.updated = Date.now();
    }

    function resolvePending(
      pending: BalanceInfo['pending'],
      convertErr?: any,
    ): void {
      for (let i = 0, l = pending.length; i < l; i++) {
        if (convertErr && pending[i].options.convertTo) {
          pending[i].handlers[1](convertErr);

          continue;
        }

        let result: eosCommon.ExtendedAsset | eosCommon.ExtendedAsset[];

        try {
          result = formatResult(pending[i].options);
        } catch (e) {
          pending[i].handlers[1](e);

          continue;
        }

        pending[i].handlers[0](result);
      }
    }

    function formatResult(
      options: BalanceInfo['pending'][number]['options'],
    ): eosCommon.ExtendedAsset | eosCommon.ExtendedAsset[] {
      if (options.token) {
        const token = balanceInfo.tokens.get(options.token.toUpperCase());

        if (!token) return null;

        const asset = eosCommon.extended_asset(
          options.ignoreReservations
            ? token.amount
            : getBalanceTokenFreeAmount(token),
          eosCommon.extended_symbol(
            eosCommon.symbol(token.symbol, token.precision),
            eosCommon.name(token.contract),
          ),
        );

        if (!options.convertTo || token.symbol === options.convertTo) {
          return asset;
        }

        const converted = SWAP_INFO.calculate(
          asset.quantity,
          options.convertTo,
        );

        return eosCommon.extended_asset(
          converted.output.quantity,
          eosCommon.name(converted.output.contract),
        );
      }

      let tokens: BalanceToken[];
      let allTokens: boolean;

      if (Array.isArray(options.tokens)) {
        tokens = [];

        for (let i = 0, l = options.tokens.length; i < l; i++) {
          const token = balanceInfo.tokens.get(options.tokens[i].toUpperCase());

          if (token) {
            tokens.push(token);
          }
        }
      } else {
        tokens = Array.from(balanceInfo.tokens.values());
        allTokens = true;
      }

      const results: eosCommon.ExtendedAsset[] = [];

      for (let i = 0, l = tokens.length; i < l; i++) {
        const token = tokens[i];
        const asset = eosCommon.extended_asset(
          options.ignoreReservations
            ? token.amount
            : getBalanceTokenFreeAmount(token),
          eosCommon.extended_symbol(
            eosCommon.symbol(token.symbol, token.precision),
            eosCommon.name(token.contract),
          ),
        );

        if (!options.convertTo || token.symbol === options.convertTo) {
          results.push(asset);

          continue;
        }

        try {
          const converted = SWAP_INFO.calculate(
            asset.quantity,
            options.convertTo,
          );

          results.push(
            eosCommon.extended_asset(
              converted.output.quantity,
              eosCommon.name(converted.output.contract),
            ),
          );
        } catch (e) {
          if (!allTokens) throw e;

          // Игнорируем ошибки конвертации в случае запроса всех токенов,
          // так как всех нужных пар для обмена может не существовать
        }
      }

      // Суммируем все сконвертированные токены
      if (options.convertTo) {
        if (!results.length) return null;

        const asset = results[0];

        for (let i = 1, l = results.length; i < l; i++) {
          asset.plus(results[i]);
        }

        return asset;
      }

      return results;
    }

    function getBalanceTokenFreeAmount(token: BalanceToken): bigint {
      let amount = token.amount;

      for (let i = 0, l = token._reservations.length; i < l; i++) {
        amount -= token._reservations[i].amount;
      }

      if (amount > 0) {
        return amount;
      }

      return BigInt(0);
    }
  }

  /**
   * Резервирование баланса
   */
  async reserveBalance(
    options: ReserveBalanceOptions,
  ): Promise<ReserveBalanceResultWithRelease>;
  async reserveBalance<T>(
    options: ReserveBalanceOptions,
    closure: ReserveBalanceClosure<T>,
  ): Promise<T>;
  async reserveBalance<T>(
    options: ReserveBalanceOptions,
    closure?: ReserveBalanceClosure<T>,
  ): Promise<ReserveBalanceResultWithRelease | T> {
    if (closure && typeof closure !== 'function') {
      throw new Error('Argument closure must be a function');
    }

    options = { ...options };

    if (
      options.key != null &&
      typeof options.key !== 'string' &&
      typeof options.key !== 'symbol'
    ) {
      throw new Error('If specified, property key must be a string or symbol');
    }

    let quantity: {
      min?: eosCommon.Asset;
      max?: eosCommon.Asset;
    };
    let symCode: eosCommon.SymbolCode;

    if (typeof options.quantity === 'string') {
      if (options.quantity.split(' ').length > 1) {
        quantity = {
          min: eosCommon.asset(options.quantity.toUpperCase()),
        };
        quantity.max = quantity.min;

        symCode = quantity.min.symbol.code();
      } else {
        symCode = eosCommon.symbol_code(options.quantity.toUpperCase());
      }
    } else if (options.quantity instanceof eosCommon.Asset) {
      quantity = {
        min: options.quantity,
        max: options.quantity,
      };

      symCode = options.quantity.symbol.code();
    } else if (options.quantity instanceof eosCommon.SymbolCode) {
      symCode = options.quantity;
    } else if (options.quantity) {
      quantity = {};

      ['min', 'max'].forEach((key: 'min' | 'max') => {
        if (typeof options.quantity[key] === 'string') {
          quantity[key] = eosCommon.asset(options.quantity[key].toUpperCase());
        } else if (options.quantity[key] instanceof eosCommon.Asset) {
          quantity[key] = options.quantity[key];
        } else if (options.quantity[key]) {
          throw new Error(`Invalid quantity.${key} value`);
        } else {
          return;
        }

        const quantitySymCode = quantity[key].symbol.code();

        if (!symCode) {
          symCode = quantitySymCode;
        } else if (symCode.isNotEqual(quantitySymCode)) {
          throw new Error(
            'Both quantity.min and quantity.max must have the same symbol code',
          );
        }
      });

      if (!symCode) {
        throw new Error(
          'No quantity.min or quantity.max property specified. At least one of them is required',
        );
      }
    } else {
      throw new Error('No quantity property specified');
    }

    if (options.schedule) {
      if (options.key == null) {
        throw new Error('Property key required with schedule');
      }

      if (
        !quantity ||
        !quantity.min ||
        !quantity.max ||
        quantity.min.isNotEqual(quantity.max)
      ) {
        throw new Error(
          'Property quantity must be a fixed asset with schedule',
        );
      }
    }

    // Запрашиваем данные чтобы они обновились
    await this.getBalance({
      freshness: options.freshness,
    });

    const token = this.#balanceInfo.tokens.get(symCode.toString());

    if (!token) {
      throw new WaxWebError(
        `Token ${symCode.toString()} not found`,
        'NO_TOKEN',
      );
    }

    let amount = token.amount;
    let reservation: BalanceToken['_reservations'][number];

    for (let i = 0, l = token._reservations.length; i < l; i++) {
      const reserv = token._reservations[i];

      if (reserv.scheduled) {
        amount -= reserv.scheduled.filled;
      } else {
        amount -= reserv.amount;
      }

      if (
        options.key != null &&
        options.key === reserv.key &&
        !reserv.expired
      ) {
        reservation = reserv;
      }
    }

    if (reservation) {
      if (reservation.scheduled) {
        reservation.amount = BigInt(
          eosCommon
            .asset_to_precision(quantity.max, token.precision)
            .amount.toString(10),
        );

        // Если новая сумма резервации меньше чем уже заполнено, возвращаем лишнее в сумму баланса
        if (reservation.scheduled.filled > reservation.amount) {
          amount += reservation.scheduled.filled - reservation.amount;
          reservation.scheduled.filled = reservation.amount;
        }
      }
    } else if (options.schedule) {
      reservation = {
        amount: BigInt(
          eosCommon
            .asset_to_precision(quantity.max, token.precision)
            .amount.toString(10),
        ),
        key: options.key,
        scheduled: {
          filled: BigInt(0),
        },
      };

      token._reservations.push(reservation);
    }

    let requiredAmount = amount < 0 ? amount * BigInt(-1) : BigInt(0);

    // Заполняем запланированные резервации в порядке их очереди
    for (let i = 0, l = token._reservations.length, m = false; i < l; i++) {
      const reserv = token._reservations[i];

      if (reservation === reserv) {
        m = true;
      }

      if (!reserv.scheduled || reserv.scheduled.filled >= reserv.amount) {
        continue;
      }

      const amountToFill = reserv.amount - reserv.scheduled.filled;
      const availableAmountToFill =
        amountToFill <= amount ? amountToFill : amount;

      if (!m) {
        requiredAmount +=
          amountToFill -
          (availableAmountToFill < 0 ? BigInt(0) : availableAmountToFill);
      }

      if (availableAmountToFill > 0) {
        reserv.scheduled.filled += availableAmountToFill;
        amount -= availableAmountToFill;
      }

      if (amount <= 0 && m) break;
    }

    if (reservation && reservation.scheduled) {
      reservation.expireAt = Number.isFinite(options.timeout)
        ? Date.now() + options.timeout
        : null;

      if (reservation.scheduled.filled < reservation.amount) {
        const requiredQuantity = eosCommon.asset(
          reservation.amount - reservation.scheduled.filled + requiredAmount,
          eosCommon.symbol(token.symbol, token.precision),
        );

        if (options.swap) {
          // Клонируем и добавляем 3% к необходимой сумме, чтобы компенсировать волатильность курса
          const requiredQuantityForSwap = eosCommon.asset(
            (BigInt(requiredQuantity.amount.toString()) * BigInt(103)) /
              BigInt(100),
            requiredQuantity.symbol,
          );

          const swapInfo = await this.getSwapInfo(options.freshness);
          const balancesToConvert = await this.getBalance({
            tokens:
              typeof options.swap === 'object' ? options.swap.tokens : null,
            freshness: options.freshness,
          });
          const convertedInfo: (AlcorAmmSwapCalculateResult & {
            output: { _sortIndex: number };
          })[] = [];

          for (let i = 0, l = balancesToConvert.length; i < l; i++) {
            try {
              const converted = swapInfo.calculate(
                balancesToConvert[i].quantity,
                token.symbol,
              );

              converted['_sortIndex'] =
                converted.output.quantity.amount.toJSNumber();

              convertedInfo.push(converted as any);
            } catch (e) {
              // Игнорируем
            }
          }

          // Сортируем по убыванию
          convertedInfo.sort(
            (a, b) => b.output._sortIndex - a.output._sortIndex,
          );

          const swapTasks: {
            input: {
              quantity: string;
              contract: string;
            };
            output: {
              quantity: string;
              contract: string;
            };
            reservation: ReserveBalanceResultWithRelease;
          }[] = [];

          for (let i = 0, l = convertedInfo.length; i < l; i++) {
            let acquiredReservation: ReserveBalanceResultWithRelease;
            let convertedOutput: AlcorAmmSwapCalculateResult['output'];

            try {
              const needConverted = swapInfo.calculate(
                balancesToConvert[i].quantity.symbol.code(),
                requiredQuantityForSwap,
              );

              if (
                needConverted.input.quantity.isLessThan(
                  convertedInfo[i].input.quantity,
                )
              ) {
                acquiredReservation = await this.reserveBalance({
                  quantity: needConverted.input.quantity,
                  timeout: 300000, // 5 минут
                });
                convertedOutput = needConverted.output;
              } else {
                acquiredReservation = await this.reserveBalance({
                  quantity: convertedInfo[i].input.quantity,
                  timeout: 300000, // 5 минут
                });
                convertedOutput = convertedInfo[i].output;
              }
            } catch (e) {
              continue;
            }

            try {
              requiredQuantityForSwap.minus(convertedOutput.quantity);
            } catch (e) {
              acquiredReservation.release();

              continue;
            }

            swapTasks.push({
              input: {
                quantity: acquiredReservation.quantity.toString(),
                contract: acquiredReservation.contract.toString(),
              },
              output: {
                quantity: convertedOutput.minQuantity.toString(),
                contract: convertedOutput.contract,
              },
              reservation: acquiredReservation,
            });

            if (requiredQuantityForSwap.amount.lesserOrEquals(0)) {
              await Promise.all(
                swapTasks.map((task) => {
                  return this.swapTokens(task.input, task.output).finally(
                    task.reservation.release,
                  );
                }),
              );

              await waitFor(10000); // Ждем 10 секунд чтобы данные на блокчейне успели синхронизироваться

              delete options.swap; // Удаляем чтобы при повторном вызове уже не менять токены

              return this.reserveBalance(options, closure);
            }
          }
        }

        throw new WaxWebError(
          `Reservation "${String(
            reservation.key,
          )}" for ${symCode.toString()} is not fulfilled yet`,
          'NOT_FULFILLED',
          { requiredQuantity },
        );
      }

      delete reservation.scheduled;
    } else {
      if (reservation) {
        amount = (amount > 0 ? amount : BigInt(0)) + reservation.amount;
      }

      if (amount <= 0) {
        throw new WaxWebError(
          `Not enough balance for ${symCode.toString()}`,
          'NO_BALANCE',
        );
      }

      if (quantity) {
        if (quantity.min) {
          quantity.min = eosCommon.asset_to_precision(
            quantity.min,
            token.precision,
          );

          if (quantity.min.amount.greater(amount)) {
            throw new WaxWebError(
              `Not enough balance for ${symCode.toString()}`,
              'NO_BALANCE',
            );
          }
        }

        if (quantity.max) {
          quantity.max = eosCommon.asset_to_precision(
            quantity.max,
            token.precision,
          );

          if (quantity.max.amount.lesser(amount)) {
            amount = BigInt(quantity.max.amount.toString(10));
          }
        }
      }

      if (reservation) {
        reservation.amount = amount;
      } else {
        reservation = { amount };

        if (options.key != null) {
          reservation.key = options.key;
        }

        token._reservations.push(reservation);
      }

      reservation.expireAt = Number.isFinite(options.timeout)
        ? Date.now() + options.timeout
        : null;
    }

    const asset = eosCommon.asset(
      reservation.amount,
      eosCommon.symbol(token.symbol, token.precision),
    );
    const contract = eosCommon.name(token.contract);

    if (closure) {
      try {
        return await closure(asset, contract);
      } finally {
        reservation.expired = true;
      }
    }

    return {
      quantity: asset,
      contract,
      release: () => {
        reservation.expired = true;
      },
    };
  }

  /**
   * Перевод токенов другому аккаунту
   */
  async sendTokens(details: {
    contract: string;
    to: string;
    quantity: string;
    memo?: string;
  }): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    await this.transact(
      {
        actions: [
          {
            account: details.contract,
            name: 'transfer',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              from: userAccount,
              to: details.to,
              quantity: details.quantity,
              memo: details.memo || '',
            },
          },
        ],
      },
      {
        website: 'wallet.wax.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Стейкинг ресурсов
   */
  async stakeResources(
    resources: { netQuantity?: string; cpuQuantity?: string },
    options?: {
      receiver?: string;
      transfer?: boolean;
    },
  ): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    options = { ...options };

    if (!options.receiver) {
      options.receiver = userAccount;
    }

    await this.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'delegatebw',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              from: userAccount,
              receiver: options.receiver,
              stake_net_quantity: resources.netQuantity || '0.00000000 WAX',
              stake_cpu_quantity: resources.cpuQuantity || '0.00000000 WAX',
              transfer: !!options.transfer,
            },
          },
        ],
      },
      {
        website: 'wallet.wax.io',
        throwIfNoResources: false, // При стейкинге не ограничиваем транзакцию
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Анстейкинг ресурсов
   */
  async unstakeResources(
    resources: { netQuantity?: string; cpuQuantity?: string },
    options?: {
      receiver?: string;
    },
  ): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    options = { ...options };

    if (!options.receiver) {
      options.receiver = userAccount;
    }

    await this.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'undelegatebw',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              from: userAccount,
              receiver: options.receiver,
              unstake_net_quantity: resources.netQuantity || '0.00000000 WAX',
              unstake_cpu_quantity: resources.cpuQuantity || '0.00000000 WAX',
            },
          },
        ],
      },
      {
        website: 'wax.bloks.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Возврат анстейкнутых токенов после периода ожидания
   */
  async refund(): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    await this.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'refund',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              owner: userAccount,
            },
          },
        ],
      },
      {
        website: 'wax.bloks.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Покупка RAM
   */
  async buyRam(quant: string, receiver?: string): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    if (!receiver) {
      receiver = userAccount;
    }

    await this.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'buyram',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              payer: userAccount,
              receiver,
              quant,
            },
          },
        ],
      },
      {
        website: 'wallet.wax.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Покупка RAM
   */
  async buyRamBytes(bytes: number, receiver?: string): Promise<void> {
    const userAccount = this.getAccountNameOrFail();

    if (!receiver) {
      receiver = userAccount;
    }

    await this.transact(
      {
        actions: [
          {
            account: 'eosio',
            name: 'buyrambytes',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              payer: userAccount,
              receiver,
              bytes,
            },
          },
        ],
      },
      {
        website: 'wax.bloks.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Подсчет стоимости RAM
   */
  calculateRamCost(options: {
    bytes: number;
    freshness?: number;
  }): Promise<eosCommon.Asset>;
  calculateRamCost(options: {
    quantity: string | eosCommon.Asset;
    freshness?: number;
  }): Promise<number>;
  calculateRamCost(options: {
    bytes?: number;
    quantity?: string | eosCommon.Asset;
    freshness?: number;
  }): Promise<eosCommon.Asset | number> {
    return new Promise((resolve, reject) => {
      options = { ...options };

      if (typeof options.quantity === 'string') {
        options.quantity = eosCommon.asset(options.quantity.toUpperCase());
      }

      const pendingOptions: RamCostInfo['pending'][number]['options'] = {};

      if (Number.isFinite(options.bytes)) {
        pendingOptions.bytes = options.bytes;
      } else if (options.quantity instanceof eosCommon.Asset) {
        pendingOptions.quantity = options.quantity;
      } else {
        reject(
          new Error(
            'No bytes or quantity property specified. One of them is required',
          ),
        );

        return;
      }

      if (RAM_COST_INFO.pending) {
        RAM_COST_INFO.pending.push({
          handlers: [resolve, reject],
          options: pendingOptions,
        });

        return;
      }

      let freshness = Math.max(0, Math.round(options.freshness));
      if (!Number.isFinite(freshness)) freshness = 10000; // По умолчанию используем кэш в 10 сек

      if (RAM_COST_INFO.updated + freshness > Date.now()) {
        resolve(formatResult(pendingOptions));

        return;
      }

      RAM_COST_INFO.pending = [
        {
          handlers: [resolve, reject],
          options: pendingOptions,
        },
      ];

      update
        .call(this)
        .then(() => {
          const pending = RAM_COST_INFO.pending;
          RAM_COST_INFO.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            let result: eosCommon.Asset | number;

            try {
              result = formatResult(pending[i].options);
            } catch (e) {
              pending[i].handlers[1](e);

              continue;
            }

            pending[i].handlers[0](result);
          }
        })
        .catch((err) => {
          const pending = RAM_COST_INFO.pending;
          RAM_COST_INFO.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            pending[i].handlers[1](err);
          }
        });
    });

    async function update(this: Wax): Promise<void> {
      const { rows } = await this.api.rpc.get_table_rows({
        code: 'eosio',
        scope: 'eosio',
        table: 'rammarket',
      });

      if (rows.length) {
        const baseAsset = eosCommon.asset(rows[0].base.balance);
        const quoteAsset = eosCommon.asset(rows[0].quote.balance);
        const baseBalance = baseAsset.amount.toJSNumber();
        const quoteBalance = quoteAsset.amount.toJSNumber();

        if (baseBalance > 0 && Number.isFinite(quoteBalance)) {
          RAM_COST_INFO.quoteSymbol = quoteAsset.symbol.code().toString();
          RAM_COST_INFO.quotePrecision = quoteAsset.symbol.precision();
          RAM_COST_INFO.pricePerByte = quoteBalance / baseBalance;
          RAM_COST_INFO.updated = Date.now();

          return;
        }
      }

      throw new WaxWebError('Cannot update RAM cost info. Malformed response');
    }

    function formatResult(
      options: RamCostInfo['pending'][number]['options'],
    ): eosCommon.Asset | number {
      if (options.bytes != null) {
        return eosCommon.asset(
          Math.ceil(options.bytes * RAM_COST_INFO.pricePerByte),
          eosCommon.symbol(
            RAM_COST_INFO.quoteSymbol,
            RAM_COST_INFO.quotePrecision,
          ),
        );
      }
      if (options.quantity != null) {
        return Math.floor(
          options.quantity.amount.toJSNumber() / RAM_COST_INFO.pricePerByte,
        );
      }

      // До этого не должно доходить, так как проверяется перед добавлением
      throw new Error(
        'Unexpected error. No bytes or quantity property specified',
      );
    }
  }

  /**
   * Загрузка информации о парах для обмена
   */
  getSwapInfo(freshness?: number): Promise<AlcorAmmSwapInfo> {
    return new Promise((resolve, reject) => {
      if (SWAP_INFO.pending) {
        SWAP_INFO.pending.push([resolve, reject]);

        return;
      }

      freshness = Math.max(0, Math.round(freshness));
      if (!Number.isFinite(freshness)) freshness = 10000; // По умолчанию используем кэш в 10 сек

      if (SWAP_INFO.updated + freshness > Date.now()) {
        resolve({
          pairs: SWAP_INFO.pairs,
          calculate: SWAP_INFO.calculate,
        });

        return;
      }

      SWAP_INFO.pending = [[resolve, reject]];

      update.call(this).then(
        () => {
          const pending = SWAP_INFO.pending;
          SWAP_INFO.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            pending[i][0]({
              pairs: SWAP_INFO.pairs,
              calculate: SWAP_INFO.calculate,
            });
          }
        },
        (err) => {
          const pending = SWAP_INFO.pending;
          SWAP_INFO.pending = null;

          for (let i = 0, l = pending.length; i < l; i++) {
            pending[i][1](err);
          }
        },
      );
    });

    async function update(this: Wax): Promise<void> {
      const { rows } = await this.api.rpc.get_table_rows({
        code: 'alcorammswap',
        scope: 'alcorammswap',
        table: 'pairs',
        limit: 1000,
      });
      const pairs: SwapInfo['pairs'] = new Map();

      for (let i = 0, l = rows.length; i < l; i++) {
        const pair = {
          id: rows[i].id,
          supply: eosCommon.asset(rows[i].supply),
          pool1: {
            quantity: eosCommon.asset(rows[i].pool1.quantity),
            contract: rows[i].pool1.contract,
          },
          pool2: {
            quantity: eosCommon.asset(rows[i].pool2.quantity),
            contract: rows[i].pool2.contract,
          },
          fee: rows[i].fee,
          fee_contract: rows[i].fee_contract,
        };

        if (isAssetNotLegit(pair.pool1) || isAssetNotLegit(pair.pool2))
          continue;

        const symCode1 = pair.pool1.quantity.symbol.code();
        const symCode2 = pair.pool2.quantity.symbol.code();

        pairs.set(`${symCode1}/${symCode2}`, pair);
        pairs.set(`${symCode2}/${symCode1}`, pair);
      }

      SWAP_INFO.pairs = pairs;
      SWAP_INFO.calculate = createSwapCalculator(pairs);
      SWAP_INFO.updated = Date.now();
    }

    function isAssetNotLegit(asset: {
      quantity: eosCommon.Asset;
      contract: string;
    }): boolean {
      const tokenInfo =
        PREDEFINED_TOKENS_INFO_LOOKUP[asset.quantity.symbol.code().toString()];

      return tokenInfo && asset.contract !== tokenInfo.contract;
    }
  }

  /**
   * Обмен токенов
   */
  async swapTokens(
    input: {
      quantity: string;
      contract: string;
    },
    output: {
      quantity: string;
      contract: string;
    },
  ): Promise<{ received: number }> {
    if (
      !output ||
      typeof output.quantity !== 'string' ||
      typeof output.contract !== 'string'
    ) {
      throw new Error('Invalid output');
    }

    const userAccount = this.getAccountNameOrFail();

    const transaction = await this.transact(
      {
        actions: [
          {
            account: input.contract,
            name: 'transfer',
            authorization: [
              {
                actor: userAccount,
                permission: 'active',
              },
            ],
            data: {
              from: userAccount,
              to: 'alcorammswap',
              quantity: input.quantity,
              memo: `${output.quantity}@${output.contract}`,
            },
          },
        ],
      },
      {
        website: 'wax.alcor.exchange',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );

    let received = 0;

    const inlineTraces =
      transaction?.processed?.action_traces?.[0]?.inline_traces;

    if (Array.isArray(inlineTraces)) {
      for (let i = 0, l = inlineTraces.length; i < l; i++) {
        const trace = inlineTraces[i];

        if (
          trace.act?.name !== 'transfer' ||
          trace.act.data?.to !== userAccount
        )
          continue;

        received = parseFloat(trace.act.data.quantity);

        if (!Number.isFinite(received)) {
          throw new WaxWebError(
            `Invalid received value "${trace.act.data.quantity}"`,
          );
        }

        break;
      }
    }

    return { received };
  }

  /** Метод меняет список переданных токенов на Wax */
  async swapToWax(tokens: eosCommon.ExtendedAsset[]): Promise<{
    received: eosCommon.ExtendedAsset;
    unswapped?: eosCommon.ExtendedAsset[];
  }> {
    if (!this.canTransact) throw "Can't transact. Try later!";

    const result = {
      received: new eosCommon.ExtendedAsset(
        0,
        new eosCommon.ExtendedSymbol(
          new eosCommon.Sym('WAX', 8),
          'eosio.token',
        ),
      ),
      unswapped: [],
    };

    // получаем актуальный баланс
    const balances = await this.getBalance({
      tokens: tokens.map((e) => e.quantity.symbol.code().toString()),
    });

    // проверим хватает ли текущего баланса
    for (const token of tokens) {
      const tokenInBalance = balances.find((e) =>
        e.quantity.symbol.isEqual(token.quantity.symbol),
      );

      if (!tokenInBalance)
        throw (
          "Can't find token in balance: " +
          token.quantity.symbol.code().toString()
        );

      if (tokenInBalance.quantity.isLessThan(token.quantity))
        throw `Not enough token balance. Need: ${parseFloat(
          token.toString(),
        )} Has: ${parseFloat(tokenInBalance.toString())}`;
    }

    for (const token of tokens) {
      try {
        const { received } = await this.swapTokens(
          {
            quantity: token.quantity.toString(),
            contract: token.contract.toString(),
          },
          {
            quantity: '0.00000000 WAX',
            contract: result.received.contract.toString(),
          },
        );

        if (+received) {
          result.received.quantity.set_amount(
            result.received.quantity.amount.plus(
              Math.floor(
                received *
                  Math.pow(10, result.received.quantity.symbol.precision()),
              ),
            ),
          );
        } else {
          result.unswapped.push(token);
        }
      } catch (e) {
        console.error(e);
        result.unswapped.push(token);
      }
    }

    return result;
  }

  /**
   * Метод покупает за Wax список переданных токенов. Может купиться больше планированного токена, но не меньше
   * @slippage - на сколько процентов больше WAX потратить, чем по текущей цене.
   */
  async swapFromWax(
    tokens: eosCommon.ExtendedAsset[],
    { slippage = 5 }: { slippage?: number },
  ): Promise<{
    received: eosCommon.ExtendedAsset[];
    unswapped?: eosCommon.ExtendedAsset[];
    spent: number;
  }> {
    if (!this.canTransact) throw "Can't transact. Try later!";

    // получаем актуальный баланс
    let balance =
      parseFloat(
        (
          await this.getBalance({
            token: 'WAX',
          })
        )?.quantity.toString(),
      ) || 0;

    const result = {
      received: [],
      unswapped: [],
      spent: 0,
    };

    const swapInfo = await this.getSwapInfo();

    for (const token of tokens) {
      const swapPreview = swapInfo.calculate('WAX', token.quantity);

      swapPreview.input.quantity.set_amount(
        Math.floor(
          swapPreview.input.quantity.amount.toJSNumber() * (1 + slippage / 100),
        ),
      );

      const waxAmountNeeded = new eosCommon.ExtendedAsset(
        swapPreview.input.quantity.amount,
        new eosCommon.ExtendedSymbol(
          swapPreview.input.quantity.symbol,
          'eosio.token',
        ),
      );

      const waxBalanceNeeded = parseFloat(waxAmountNeeded.quantity.toString());

      if (balance < waxBalanceNeeded) {
        result.unswapped.push(token); // не хватает баланса для обмена
        continue;
      }

      try {
        // делаем обмен токена
        const { received } = await this.swapTokens(
          {
            quantity: waxAmountNeeded.quantity.toString(),
            contract: waxAmountNeeded.contract.toString(),
          },
          {
            quantity: swapPreview.output.quantity.toString(),
            contract: swapPreview.output.contract.toString(),
          },
        );

        if (+received) {
          const outputPrecision =
            swapPreview.output.quantity.symbol.precision();

          token.quantity.set_amount(
            Math.floor(received * Math.pow(10, outputPrecision)),
          );

          result.received.push(token);

          balance -= waxBalanceNeeded;

          result.spent += waxBalanceNeeded;
        } else {
          result.unswapped.push(token);
        }
      } catch (e) {
        console.error(e);
        result.unswapped.push(token);
      }
    }

    return result;
  }

  /** Массив actions с истории транзакций аккаунта */
  async getHistoryActions(
    options: HistoryActionsOptions,
  ): Promise<Action<any>[]> {
    const userAccount = this.getAccountNameOrFail();

    if (typeof options !== 'object') {
      options = {};
    }

    const result: Action<any>[] = [];

    let i = 0;

    while (true) {
      const limit = 100;
      const skip = i * limit;

      const { total, actions } = await this.hyperionRpc.get_actions(
        userAccount,
        {
          ...options,
          sort: 'desc',
          skip,
          limit,
        },
      );

      if (typeof total?.value !== 'number') {
        throw new Error(
          `Incorrect hyperionRpc response! total.value is not a number | ${total?.value}`,
        );
      }

      result.push(...actions);

      if (total.value <= skip + limit) break;

      i++;

      await waitFor(2000);
    }

    return result;
  }

  async getAtomicTemplates(
    collectionName: string,
    filters?: {
      schemaName: string;
    },
  ): Promise<ApiTemplate[]> {
    let collection = ATOMIC_TEMPLATES_CACHE.collections.get(collectionName);

    if (!collection) {
      ATOMIC_TEMPLATES_CACHE.collections.set(collectionName, {
        templates: [],
      });

      collection = ATOMIC_TEMPLATES_CACHE.collections.get(collectionName);
    }

    if (collection.updating) {
      // другой аккаунт инициировал обновление
      await waitFor(2000);
      return this.getAtomicTemplates(collectionName, filters);
    }

    if (Date.now() - (collection.refreshed || 0) > 10800000) {
      // обновлять не раньше чем через 3 часа

      collection.updating = true;

      // нужно обновить данные
      try {
        const temp: ApiTemplate[] = [],
          limit = 1000;
        let page = 1;

        while (true) {
          const _templates = await this.atomic.getTemplates(
            {
              collection_name: collectionName,
            },
            page,
            limit,
          );

          temp.push(..._templates);

          if (_templates.length >= limit) {
            // есть ещё страницы
            page++;
            await waitFor(1000);
          } else {
            break;
          }
        }

        collection.templates = temp;
      } catch (e) {
        collection.updating = false;
        throw e;
      }

      collection.updating = false;
      collection.refreshed = Date.now();
    }

    if (!filters?.schemaName || typeof filters.schemaName !== 'string')
      return collection.templates;

    return collection.templates.filter(
      (e) => e.schema.schema_name === filters.schemaName,
    );
  }
}

interface RamCostInfo {
  quoteSymbol?: string;
  quotePrecision?: number;
  pricePerByte?: number;
  updated: number;
  pending?: {
    handlers: [
      (value: eosCommon.Asset | number) => void,
      (reason?: any) => void,
    ];
    options: {
      bytes?: number;
      quantity?: eosCommon.Asset;
    };
  }[];
}

interface SwapInfo {
  pairs?: AlcorAmmSwapInfo['pairs'];
  calculate?: AlcorAmmSwapInfo['calculate'];
  updated: number;
  pending?: [(value: AlcorAmmSwapInfo) => void, (reason?: any) => void][];
}

interface AccountInfo {
  account?: RpcInterfaces.GetAccountResult;
  updated: number;
  pending?: {
    handlers: [
      (value: RpcInterfaces.GetAccountResult) => void,
      (reason?: any) => void,
    ];
    options: {
      userAccount: string;
    };
  }[];
}

interface BalanceToken {
  symbol: string;
  precision: number;
  amount: bigint;
  contract: string;
  _reservations: {
    amount: bigint;
    key?: string | symbol;
    scheduled?: {
      filled: bigint;
    };
    expireAt?: number;
    expired?: boolean;
  }[];
}

interface BalanceInfo {
  tokens?: Map<string, BalanceToken>;
  updated: number;
  pending?: {
    handlers: [
      (value: eosCommon.ExtendedAsset | eosCommon.ExtendedAsset[]) => void,
      (reason?: any) => void,
    ];
    options: {
      token?: string;
      tokens?: string[];
      ignoreReservations?: boolean;
      convertTo?: string;
    };
  }[];
  hyperionLastFailTime?: number;
}

interface TransactResources {
  failedTransacts: number;
  nextTransactAttemptAfter: number;
}
