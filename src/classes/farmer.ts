import {WithUser} from "./decorators/with-user";
import {EOSIOAccount} from "../modules/eosio-account";
import {startWorker as startMinerWorker} from "./workers/farmer-miner";
import {AccountFwTool, FwTool} from "./interfaces/fw-tools";

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

export class Farmer {

  balance: Balance = {
    wood: 0,
    gold: 0,
    food: 0,
  };

  energy: Energy = {
    current: 0,
    max: 0,
  };

  #isEnabled = false;

  #wMinerStopHook: Function;

  tools: AccountFwTool[] = [];

  constructor(public readonly eosio: EOSIOAccount) {
  }

  /** Включение бота */
  @WithUser()
  async enable() {
    if (this.#isEnabled) return;

    this.#wMinerStopHook = startMinerWorker(this);

    this.#isEnabled = true;
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

    const res = await this.eosio.rpc.get_table_rows({
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

  @WithUser()
  async getAccountTools(userAccount?: string): Promise<AccountFwTool[]> {

    const tools: AccountFwTool[] = [];

    const res = await this.eosio.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "tools",
      key_type: "i64",
      index_position: 2,
      lower_bound: userAccount || this.eosio.userAccount,
      upper_bound: userAccount || this.eosio.userAccount,
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

    if (!userAccount || userAccount === this.eosio.userAccount) {
      this.tools = tools;
    }

    return tools;

  }

  @WithUser()
  async getAccountStats(userAccount?: string): Promise<{balance: Balance, energy: Energy}> {

    const res = await this.eosio.rpc.get_table_rows({
      code: "farmersworld",
      scope: "farmersworld",
      table: "accounts",
      lower_bound: userAccount || this.eosio.userAccount,
      upper_bound: userAccount || this.eosio.userAccount,
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

    if (!userAccount || userAccount === this.eosio.userAccount) {
      this.balance = result.balance;
      this.energy = result.energy;
    }

    return result;
  }

  /**
   * Собрать ресурс
   */
  @WithUser()
  async claim(assetId: number) {

    return;
    const result = await this.eosio.api.transact({
      actions: [{
        account: "farmersworld",
        name: "claim",
        authorization: [{
          actor: this.eosio.userAccount,
          permission: "active"
        }],
        data: {
          owner: this.eosio.userAccount,
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