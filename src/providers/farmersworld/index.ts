import {startWorker as startMinerWorker} from "./workers/worker-miner";
import {AccountFwTool, FwTool} from "./interfaces/fw-tools";
import {Logger} from "@nestjs/common";
import {Bot} from "@providers/bot";
import * as eosCommon from "eos-common";
import {Asset} from "eos-common";
import {TransactResult} from "eosjs/dist/eosjs-api-interfaces";
import {waitFor} from "@utils/wait-for";

const FW_TOOLS_CACHE: {
  refreshed: number;
  tools: FwTool[];
} = {
  refreshed: 0,
  tools: []
};

interface Balance {
  wood: number,
  gold: number,
  food: number,
}

interface Energy {
  current: number,
  max: number,
}

export class FarmersWorld {

  /** Внутриигровой баланс */
  balance: Balance = {
    wood: 0,
    gold: 0,
    food: 0,
  };

  /** Внутриигровая энергия */
  energy: Energy = {
    current: 0,
    max: 0,
  };

  #isEnabled = false;

  // процесс работы с инструментами на карте Mining
  #wMinerStopHook: Function;

  tools: AccountFwTool[] = [];

  logger: Logger;

  constructor(public readonly bot: Bot) {
    this.logger = new Logger(bot.wax.userAccount + '.');
  }

  /** Включение бота */
  async enable() {
    if (this.#isEnabled) return;

    if (!await this.#isUserRegistered()) {
      this.logger.log('Регистрация нового аккаунта...');
      await this.#regNewUser();
    }

    this.logger.log('Аккаунт в игре создан');

    this.#wMinerStopHook = startMinerWorker(this);

    this.#isEnabled = true;
  }

  async #isUserRegistered() {
    const res = await this.bot.wax.rpc.get_table_rows({
      code: "farmersworld",
      index_position: 1,
      json: true,
      key_type: "i64",
      limit: 100,
      lower_bound: this.bot.wax.userAccount,
      upper_bound: this.bot.wax.userAccount,
      reverse: false,
      scope: "farmersworld",
      show_payer: false,
      table: "accounts",
    });

    if (res.rows?.length) return true;

    return false;
  }

  async #regNewUser(referral?: string) {

    const result = await this.bot.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "newuser",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          owner: this.bot.wax.userAccount,
          referral_partner: referral || '',
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

    return result;

  }

  /** Выключение бота */
  async disable() {
    if (!this.#isEnabled) return;

    if (typeof this.#wMinerStopHook === 'function') this.#wMinerStopHook();

    this.#isEnabled = false;
  }

  /** Загрузка конфигураций всех инструментов */
  async filterToolsAssets(filters?: any) {
    // TODO: если нужны фильтры, то добавить

    // Обновляем ассеты, если прошло больше часа
    let tools: FwTool[];

    if (Date.now() - (FW_TOOLS_CACHE.refreshed || 0) > 3600000) {
      tools = await this.#loadToolsAssets();
    } else {
      tools = FW_TOOLS_CACHE.tools;
    }

    return tools;
  }

  async #loadToolsAssets(): Promise<FwTool[]> {

    const res = await this.bot.wax.rpc.get_table_rows({
      code: "farmersworld",
      limit: 100,
      lower_bound: "",
      upper_bound: "",
      scope: "farmersworld",
      table: "toolconfs",
    });

    if (!res?.rows?.length) return [];

    FW_TOOLS_CACHE.tools = res.rows;
    FW_TOOLS_CACHE.refreshed = Date.now();

    return res.rows;
  }

  async getAccountTools(userAccount?: string): Promise<AccountFwTool[]> {

    const tools: AccountFwTool[] = [];

    const res = await this.bot.wax.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "tools",
      key_type: "i64",
      index_position: 2,
      lower_bound: userAccount || this.bot.wax.userAccount,
      upper_bound: userAccount || this.bot.wax.userAccount,
      limit: 100,
    });

    const rows = res.rows?.length ? res.rows : [];

    const assets = await this.filterToolsAssets();

    for (const tool of rows) {
      const template = assets.find(e => e.template_id === tool.template_id);

      if (!template) {
        console.log(`Can't find asset template ${tool.template_id}`);
        continue;
      }

      tools.push(Object.assign(tool, { template }));
    }

    if (!userAccount || userAccount === this.bot.wax.userAccount) {
      this.tools = tools;
    }

    return tools;

  }

  async getAccountStats(userAccount?: string): Promise<{balance: Balance, energy: Energy}> {

    const res = await this.bot.wax.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "accounts",
      lower_bound: userAccount || this.bot.wax.userAccount,
      upper_bound: userAccount || this.bot.wax.userAccount,
      limit: 1,
    });

    const row = res.rows?.length ? res.rows[0] : null;

    if (!row) throw 'AccountStats load error. Empty rows';

    const balance: any = {};

    for (const bal of row.balances) { // "16.6540 WOOD", "16.6540 GOLD", "16.6540 FOOD"
      const [amount, label] = (bal as string).split(' ');

      if (!Object(this.balance).hasOwnProperty(label.toLowerCase())) {
        console.log(`New unprocessed balance token: ${label} [ignored]`);
        continue;
      }

      balance[label.toLowerCase()] = Number(amount);
    }

    const result = {
      balance,
      energy: {
        current: row.energy,
        max: row.max_energy
      }
    };

    if (!userAccount || userAccount === this.bot.wax.userAccount) {
      this.balance = result.balance;
      this.energy = result.energy;
    }

    return result;
  }

  /** Функция принимает количество ресурсов что хочется видеть на балансе, и возвращает информацию как их получить */
  async getExchangeInfo(
    fwg: Asset | null,
    fwf: Asset | null,
    fww: Asset | null,
  ): Promise<{
    alcor: eosCommon.ExtendedAsset[], // количество для обмена с алкора
    deposit: eosCommon.ExtendedAsset[] // количество для депозита
  }> {

    // баланс валют
    const tokens: { [key: string]: eosCommon.ExtendedAsset } = (await this.bot.wax.getBalance({
      tokens: ["FWG", "FWW", "FWF"]
    })).reduce((total, cur) => {
      total[cur.quantity.symbol.code().toString()] = cur; //parseFloat(cur.toString());
      return total;
    }, {});

    const result = {
      deposit: [],
      alcor: [],
    };

    // чтобы получить количество с алкора, нужно от запрашиваемого баланса, отнять текущий

    if (fwg && fwg.amount.gt(0)) {
      if (tokens["FWG"]?.quantity.isGreaterThanOrEqual(fwg)) {
        // токенов на балансе достаточно
        tokens["FWG"].quantity.set_amount(fwg.amount);

        result["deposit"].push(tokens["FWG"]);
      } else {
        // нужно обменять с алкора
        if (!tokens["FWG"]) tokens["FWG"] = new eosCommon.ExtendedAsset(0, new eosCommon.ExtendedSymbol(eosCommon.symbol('FWG', 4)));

        tokens["FWG"].quantity.set_amount(fwg.amount.minus(tokens["FWG"].quantity.amount));

        result["alcor"].push(tokens["FWG"]);
      }
    }

    if (fwf && fwf.amount.gt(0)) {
      if (tokens["FWF"]?.quantity.isGreaterThanOrEqual(fwf)) {
        // токенов на балансе достаточно
        tokens["FWF"].quantity.set_amount(fwf.amount);

        result["deposit"].push(tokens["FWF"]);
      } else {
        // нужно обменять с алкора
        if (!tokens["FWF"]) tokens["FWF"] = new eosCommon.ExtendedAsset(0, new eosCommon.ExtendedSymbol(eosCommon.symbol('FWF', 4)));

        tokens["FWF"].quantity.set_amount(fwf.amount.minus(tokens["FWF"].quantity.amount));

        result["alcor"].push(tokens["FWF"]);
      }
    }

    if (fww && fww.amount.gt(0)) {
      if (tokens["FWW"]?.quantity.isGreaterThanOrEqual(fww)) {
        // токенов на балансе достаточно
        tokens["FWW"].quantity.set_amount(fww.amount);

        result["deposit"].push(tokens["FWW"]);
      } else {
        // нужно обменять с алкора
        if (!tokens["FWW"]) tokens["FWW"] = new eosCommon.ExtendedAsset(0, new eosCommon.ExtendedSymbol(eosCommon.symbol('FWW', 4)));

        tokens["FWW"].quantity.set_amount(fww.amount.minus(tokens["FWW"].quantity.amount));

        result["alcor"].push(tokens["FWW"]);
      }
    }

    return result;

  }

  /** Кидаем в депозит весь баланс валют */
  async depositTokens(tokens: eosCommon.ExtendedAsset[]) {
    // депозит без комиссий

    return await this.bot.wax.transact({
      actions: [{
        account: "farmerstoken",
        name: "transfers",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          from: this.bot.wax.userAccount,
          memo: "deposit",
          quantities: tokens.map(eosAsset => eosAsset.quantity.toString()),
          to: "farmersworld"
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

  }

  /**
   * Вывод списка токенов. Если комиссия не подходит, то вывод откладывается
   */
  async withdrawTokens(tokens: eosCommon.ExtendedAsset[], options: {
    fee?: number;
    timeout?: true;
  }): Promise<Function | TransactResult>;
  async withdrawTokens(tokens: eosCommon.ExtendedAsset[], options: {
    fee?: number;
    timeout?: false;
  }): Promise<TransactResult>;
  async withdrawTokens(tokens: eosCommon.ExtendedAsset[], options: {
    fee?: number;
    // При True, вывод выполнится когда fee будет подходящим. Можно отменить из возвращенной функции
    timeout?: boolean;
  }): Promise<Function | TransactResult> {

    if (typeof options?.fee !== "number") options.fee = 5;

    const config = await this.currentConfig();

    let canceled = false; // если вывод откладывается, то нужен хук отмены

    if (config.fee > options.fee) {
      // сейчас не выводим, ожидаем другую комиссию
      this.logger.log(`Комиссия на вывод ${config.fee}%. Ожидается меньше ${options.fee}%. Проверка через 10 минут`);

      if (options.timeout === true) {

        (async () => {
          while (true) {

            await waitFor(10 * 60 * 1000); // проверяем через 10 минут

            if (canceled) return false;

            this.logger.log('Проверка комиссии и вывод..');

            try {

              await this.withdrawTokens(tokens, {...options, timeout: false});

              this.logger.log(`Вывод токенов успешно выполнен! [${tokens.map(eosAsset => eosAsset.quantity.toString()).join(', ')}]`);

              return;

            } catch (e) {

              if (canceled) return;
              this.logger.error(e);
              this.logger.log('Попытка вывода через 10 минут');

            }

          }
        })().then();

        return () => {
          canceled = true;
        }

      }

      throw 'Current fee is higher then you want. Fee: ' + config.fee;

    }

    // комиссия подходит, выводим

    return await this.bot.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "withdraw",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          fee: config.fee,
          owner: this.bot.wax.userAccount,
          quantities: tokens.map(eosAsset => eosAsset.quantity.toString()
            .replace('FWW', 'WOOD')
            .replace('FWG', 'GOLD')
            .replace('FWF', 'FOOD')
          ),
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

  }

  /**
   * Актуальные данные конфига (комиссия, макс. энергии и тп)
   */
  async currentConfig(): Promise<{
    fee: number;
    init_energy: number;
    init_max_energy: number;
    last_fee_updated: number;
    max_fee: number;
    min_fee: number;
    reward_noise_max: number;
    reward_noise_min: number;
  }> {

    const res = await this.bot.wax.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "config",
      lower_bound: "",
      upper_bound: "",
      limit: 1,
    });

    const row = res.rows?.length ? res.rows[0] : null;

    if (!row) throw 'Cant load fee data';

    return row;

  }

  /**
   * Починка инструмента
   */
  async repair(tool: AccountFwTool) {

    await this.bot.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "repair",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          asset_id: tool.asset_id,
          asset_owner: this.bot.wax.userAccount,
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

    this.balance.gold -= (tool.durability - tool.current_durability) * 0.2;

  }

  /**
   * Восстановление энергии
   */
  async energyRecover(amount: number) {

    await this.bot.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "recover",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          energy_recovered: Math.floor(amount),
          owner: this.bot.wax.userAccount,
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

    this.balance.food -= Math.floor(amount) * 0.2;

  }

  /**
   * Собрать ресурс
   */
  async claim(assetId: number) {

    const result = await this.bot.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "claim",
        authorization: [{
          actor: this.bot.wax.userAccount,
          permission: "active"
        }],
        data: {
          owner: this.bot.wax.userAccount,
          asset_id: assetId,
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

    return result;

  }

}