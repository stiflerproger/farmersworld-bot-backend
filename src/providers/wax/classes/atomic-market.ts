import { Wax } from '../wax';
import * as eosCommon from 'eos-common';
import { FetchFunction } from '@utils/custom-fetch';
import { ExplorerApi } from 'atomicmarket';
import { Sale, SaleParams } from 'atomicmarket/build/API/Explorer/Types';
import { waitFor } from '@utils/wait-for';
import { Asset } from 'eos-common';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';

const DEFAULT_ATOMIC_MARKET_RPC_ENDPOINT = 'https://wax.api.atomicassets.io';
const DEFAULT_ATOMIC_MARKET_NAMESPACE = 'atomicmarket';

export class AtomicMarket {
  // обратная зависимость
  readonly #wax: Wax;
  readonly atomic: ExplorerApi;

  constructor(wax: Wax, fetch: FetchFunction) {
    this.#wax = wax;

    this.atomic = new ExplorerApi(
      DEFAULT_ATOMIC_MARKET_RPC_ENDPOINT,
      DEFAULT_ATOMIC_MARKET_NAMESPACE,
      {
        fetch: fetch as any,
      },
    );
  }

  /**
   * Все выставленные на продажу предметы аккаунта
   */
  async getAccountSales(accountName?: string): Promise<Sale[]> {
    if (!accountName) {
      accountName = this.#wax.getAccountNameOrFail();
    }

    const sales: Sale[] = [],
      limit = 20;

    let page = 1;

    while (true) {
      const _sales = await this.getSales(
        {
          seller: [accountName],
          state: [0, 1, 4],
        },
        page,
        limit,
      );

      sales.push(..._sales);

      if (_sales.length < limit) break;

      page++;

      await waitFor(1000);
    }

    return sales;
  }

  /**
   * Отменить продажу предмета
   */
  async cancelListing(saleId: string) {
    this.#wax.getAccountNameOrFail();

    return await this.#wax.transact(
      {
        actions: [
          {
            account: 'atomicmarket',
            name: 'cancelsale',
            data: {
              sale_id: saleId,
            },
            authorization: [
              {
                actor: this.#wax.userAccount,
                permission: 'active',
              },
            ],
          },
        ],
      },
      {
        website: 'wax.atomichub.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Обновить цену предмета. (убрать с продажи, и создать снова)
   */
  async updateListing(sale: Sale, price: Asset) {
    this.#wax.getAccountNameOrFail();

    return this.sellByAssetId(String(sale.assets[0].asset_id), price, {
      account: 'atomicmarket',
      name: 'cancelsale',
      data: {
        sale_id: sale.sale_id,
      },
      authorization: [
        {
          actor: this.#wax.userAccount,
          permission: 'active',
        },
      ],
    });
  }

  /**
   * Выставить на продажу 1 предмет
   */
  async sellByAssetId(assetId: string, price: Asset, extraAction?: any) {
    if (typeof assetId !== 'string') {
      throw new Error('[assetId] must be an string');
    }
    if (!(price instanceof Asset)) {
      throw new Error('[price] must be an eos-common Asset instance');
    }

    const actions = [
      {
        account: 'atomicmarket',
        name: 'announcesale',
        data: {
          asset_ids: [assetId],
          listing_price: price.to_string(), // 8 цифр после запятой
          maker_marketplace: '.',
          seller: this.#wax.userAccount,
          settlement_symbol:
            price.symbol.precision() + ',' + price.symbol.code().to_string(),
        },
        authorization: [
          {
            actor: this.#wax.userAccount,
            permission: 'active',
          },
        ],
      },
      {
        account: 'atomicassets',
        name: 'createoffer',
        data: {
          memo: 'sale',
          recipient: 'atomicmarket',
          recipient_asset_ids: [],
          sender: this.#wax.userAccount,
          sender_asset_ids: [assetId],
        },
        authorization: [
          {
            actor: this.#wax.userAccount,
            permission: 'active',
          },
        ],
      },
    ];

    if (extraAction) actions.unshift(extraAction);

    return await this.#wax.transact(
      {
        actions: actions,
      },
      {
        website: 'wax.atomichub.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }

  /**
   * Загрузка списка продаж по фильтрам
   */
  async getSales(params?: SaleParams, page = 1, limit = 40): Promise<Sale[]> {
    const sales = await this.atomic.getSales(
      Object.assign(
        {
          order: 'asc',
          sort: 'price',
          show_seller_contracts: false,
          symbol: 'WAX',
        },
        params,
      ),
      page,
      limit,
    );

    return sales;
  }

  /**
   * Произвести закупку количества предметов из заданного массива (обязательно сравнить количество купленных предметов!)
   */
  async buyBySales(
    sales: Sale[],
    amountToBuy: number,
  ): Promise<TransactResult[]> {
    if (typeof amountToBuy !== 'number' || !amountToBuy)
      throw new Error('Set `amountToBuy` parameter');

    this.#wax.getAccountNameOrFail(); // Проверяем чтобы аккаунт был авторизован

    const bought: TransactResult[] = [];

    for (let i = 0; i < sales.length; i++) {
      try {
        const sale = await this.buyBySale(sales[i]);

        bought.push(sale);
      } catch (e) {}

      if (bought.length >= amountToBuy) break;
    }

    return bought;
  }

  /**
   * Производит покупку на маркете с заданным saleId
   */
  async buyBySale(sale: Sale) {
    this.#wax.getAccountNameOrFail(); // Проверяем чтобы аккаунт был авторизован

    const salePrice = eosCommon.asset(
      Number(sale.price.amount),
      eosCommon.symbol(sale.price.token_symbol.toUpperCase(), Number(8)),
    );

    return await this.#wax.transact(
      {
        actions: [
          {
            account: 'atomicmarket',
            name: 'assertsale',
            data: {
              sale_id: sale.sale_id,
              asset_ids_to_assert: sale.assets.map((e) => e.asset_id),
              listing_price_to_assert: salePrice.to_string(),
              settlement_symbol_to_assert:
                salePrice.symbol.precision() +
                ',' +
                salePrice.symbol.code().to_string(),
            },
            authorization: [
              {
                actor: this.#wax.userAccount,
                permission: 'active',
              },
            ],
          },
          {
            account: 'eosio.token',
            name: 'transfer',
            data: {
              from: this.#wax.userAccount,
              to: 'atomicmarket',
              quantity: salePrice.to_string(),
              memo: 'deposit',
            },
            authorization: [
              {
                actor: this.#wax.userAccount,
                permission: 'active',
              },
            ],
          },
          {
            account: 'atomicmarket',
            name: 'purchasesale',
            data: {
              buyer: this.#wax.userAccount,
              sale_id: sale.sale_id,
              intended_delphi_median: '0',
              taker_marketplace: '.',
            },
            authorization: [
              {
                actor: this.#wax.userAccount,
                permission: 'active',
              },
            ],
          },
        ],
      },
      {
        website: 'wax.atomichub.io',
        blocksBehind: 3,
        expireSeconds: 180,
      },
    );
  }
}
