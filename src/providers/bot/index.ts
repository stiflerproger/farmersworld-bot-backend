import { FarmersWorld } from '@providers/farmersworld';
import { Wax, WaxOptions } from '@providers/wax';
import { Logger } from '@nestjs/common';

interface DApps {
  farmersworld: boolean;
}

interface Settings {
  dapps?: {
    farmersworld?: {
      enabled?: boolean;
    };
  };
}

/** Инстанс бота. Управление wax, и всеми DApps */
export class Bot {
  readonly wax;
  readonly farmersworld: FarmersWorld;
  readonly logger: Logger;
  /** Настройки юзера */
  private readonly settings: Settings;

  constructor(
    options: {
      wax: WaxOptions;
      dapps?: DApps;
    },
    settings?: Settings,
  ) {
    if (!options.wax) throw 'Wax options must be set';

    this.wax = new Wax(options.wax);
    this.settings = settings || {};

    this.logger = new Logger(this.wax.userAccount);

    this.logger.log(`dapps: ${Object.keys(options.dapps || {}).join(', ')}`);

    if (options?.dapps?.farmersworld) {
      this.farmersworld = new FarmersWorld(this);
    }
  }

  /** Запуск всех DAPPS */
  async init() {
    if (this.settings?.dapps?.farmersworld?.enabled) {
      await this.farmersworld?.enable();
    }
  }
}
