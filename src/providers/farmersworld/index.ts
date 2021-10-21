import {startWorker as startMinerWorker} from "./workers/worker-miner";
import {AccountFwTool, FwTool} from "./interfaces/fw-tools";
import {Logger} from "@utils/logger";
import {Account} from "@modules/account";

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

  logger = new Logger(FarmersWorld.name);

  constructor(public readonly account: Account) {

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
    const res = await this.account.wax.rpc.get_table_rows({
      code: "farmersworld",
      index_position: 1,
      json: true,
      key_type: "i64",
      limit: 100,
      lower_bound: this.account.wax.userAccount,
      upper_bound: this.account.wax.userAccount,
      reverse: false,
      scope: "farmersworld",
      show_payer: false,
      table: "accounts",
    });

    if (res.rows?.length) return true;

    return false;
  }

  async #regNewUser(referral?: string) {

    const result = await this.account.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "newuser",
        authorization: [{
          actor: this.account.wax.userAccount,
          permission: "active"
        }],
        data: {
          owner: this.account.wax.userAccount,
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

    const res = await this.account.wax.rpc.get_table_rows({
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

    const res = await this.account.wax.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "tools",
      key_type: "i64",
      index_position: 2,
      lower_bound: userAccount || this.account.wax.userAccount,
      upper_bound: userAccount || this.account.wax.userAccount,
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

    if (!userAccount || userAccount === this.account.wax.userAccount) {
      this.tools = tools;
    }

    return tools;

  }

  async getAccountStats(userAccount?: string): Promise<{balance: Balance, energy: Energy}> {

    const res = await this.account.wax.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "accounts",
      lower_bound: userAccount || this.account.wax.userAccount,
      upper_bound: userAccount || this.account.wax.userAccount,
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

    if (!userAccount || userAccount === this.account.wax.userAccount) {
      this.balance = result.balance;
      this.energy = result.energy;
    }

    return result;
  }

  /**
   * Собрать ресурс
   */
  async claim(assetId: number) {

    const result = await this.account.wax.transact({
      actions: [{
        account: "farmersworld",
        name: "claim",
        authorization: [{
          actor: this.account.wax.userAccount,
          permission: "active"
        }],
        data: {
          owner: this.account.wax.userAccount,
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