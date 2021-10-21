import {Wax, WaxOptions} from "../providers/wax";
import {FarmersWorld} from "@providers/farmersworld";

interface DApps {
  farmersworld: boolean
}

export class Account {

  readonly wax: Wax;
  readonly farmersworld: FarmersWorld;

  constructor(options: {wax: WaxOptions, dapps?: DApps}) {

    if (!options?.wax) throw 'Wax options must be set';

    this.wax = new Wax(options.wax);

    if (options?.dapps?.farmersworld) this.farmersworld = new FarmersWorld(this);

  }

  /** Запуск всех DAPPS */
  async init() {
    await this.farmersworld?.enable();
  }
}