// пул для работы на карте "mining"

import { Worker } from '../interfaces/worker';
import * as eosCommon from 'eos-common';
import { AccountFwTool } from '../interfaces/fw-tools';
import { waitFor } from '@utils/wait-for';
import { TransactResult } from 'eosjs/dist/eosjs-api-interfaces';
import { FarmersWorld } from '@providers/farmersworld';
import {FarmersWorldError} from "@providers/farmersworld/exceptions/farmersworld-error";

export const startWorker: Worker = function (farmer: FarmersWorld) {
  let stopped = false,
    timeoutId: NodeJS.Timeout,
    withdrawStopHook: Function,
    claimStarted = false, // первый запуск бота сначала чинит инструменты, потом в работает в 2 процесса
    claimTimeoutIds: {
      [key: string]: {
        startAt: number | null; // время когда таймаут запустится
        timeout: NodeJS.Timeout;
      };
    } = {}; // для каждого инструмента свой таймаут

  const toolRepairLimit = 51, // ремонт инструмента если ниже этого
    toolSubRepairLimit = 70, // попутно ремонтировать инструмент
    energyRefillLimit = 350,
    energySubRefillLimit = 450,
    woodWithdrawLimit = 50, // при достижении ресурса этой отметки, будет инициирован вывод
    woodToWaxLimit = 40; // при достижении этого числа ресурса на балансе блокчейна, менять его на WAX

  farmer.wMinerStopHook?.(); // удаляем дубликат процесса

  start();

  return (reason?: string) => {
    if (stopped) return;

    stopped = true;

    clearTimeout(timeoutId);

    for (const assetId in claimTimeoutIds) {
      claimTimeoutIds[assetId].startAt = null;
      clearTimeout(claimTimeoutIds[assetId].timeout);
      delete claimTimeoutIds[assetId];
    }

    withdrawStopHook?.(); // отменяем запланированный вывод токенов

    farmer.wMinerStopReason = reason || null;
  };

  /** Перезапуск процесса */
  function rerun(ms) {
    if (stopped) return;

    clearTimeout(timeoutId);

    for (const assetId in claimTimeoutIds) {
      claimTimeoutIds[assetId].startAt = null;
      clearTimeout(claimTimeoutIds[assetId].timeout);
      delete claimTimeoutIds[assetId];
    }

    claimStarted = false;

    withdrawStopHook?.(); // отменяем запланированный вывод токенов

    farmer.logger.log('Инициирован полный перезапуск!');
    timeoutId = setTimeout(start, ms);
  }

  /** Использование всех инструментов на карте mining */
  function start() {
    // начало работы воркера
    farmer.logger.log('Проверка доступа к контракту...');

    if (stopped) return;

    farmer.hasPermissions()
      .then(async have => {
        if (!have) {
          throw new FarmersWorldError('Account dont have "farmersworld::" permission', 'PERMISSION_DENIED')
        }

        if (!claimStarted) {
          claimStarted = true;
          addAllToClaim(); // запускаем отдельный процесс для сбора ресурсов
        }
      })
      .catch(e => {
        if (e.code === 'PERMISSION_DENIED') {
          farmer.logger.error('У аккаунта нет доступа к "farmersworld::"');
          return farmer.wMinerStopHook?.(e.code);
        }

        return rerun(60 * 1000);
      })

  }

  /** Добавление новых инструментов в очередь сбора ресурсов. Те что уже в очереди игнорируются (т.е. можно вызывать постоянно, ничего не дублируется) */
  function addAllToClaim() {
    if (stopped) return;

    farmer
      .getAccountTools()
      .then((tools) => {
        if (stopped) return;

        for (const tool of tools) {
          if (claimTimeoutIds[tool.asset_id]?.startAt) continue;

          const claimOn = new Date(
            tool.next_availability * 1000 +
              Math.floor(Math.random() * (30000 - 2000)) +
              2000,
          ); // +(2-30)sec

          // проверить инструмент на починку
          if (tool.current_durability - tool.template.durability_consumed < 0) {
            farmer.logger.error(`Инструмент не может использоваться! ${tool.asset_id}`);
            // TODO: если в процессе починки инструмент был полностью сломан, то инициировать перезапуск майнера
            continue;
          }

          const claimAfter = claimOn.getTime() - Date.now();

          const min = Math.floor(claimAfter / 1000 / 60),
            sec = Math.floor(claimAfter / 1000 - min * 60);

          farmer.logger.log(`${tool.asset_id} использование через: ${min}:${sec}`);

          if (claimTimeoutIds[tool.asset_id]) {
            delete claimTimeoutIds[tool.asset_id];
          }

          claimTimeoutIds[tool.asset_id] = {
            startAt: claimOn.getTime(),
            timeout: setTimeout(() => claim(tool), claimAfter),
          };
        }
      })
      .catch((e) => {
        farmer.logger.error(e);

        return rerun(60 * 1000);
      });
  }

  function claim(tool: AccountFwTool) {
    if (stopped) return;

    farmer.logger.log(`${tool.asset_id} сбор ресурсов...`);

    farmer
      .claim(Number(tool.asset_id))
      .then((res) => {
        if (stopped) return;

        const inlineTraces = (res as TransactResult).processed.action_traces[0]
          .inline_traces;

        let reward = '';

        for (const trace of inlineTraces) {
          if (trace.act.name === 'logbonus')
            reward =
              reward + ` BONUS [${trace.act.data.bonus_rewards.join(', ')}]`;
          if (trace.act.name === 'logclaim')
            reward = `[${trace.act.data.rewards.join(', ')}]` + reward;
        }

        if (!reward) throw 'Не получен reward. Перезапуск.';

        farmer.logger.log(`${tool.asset_id} сбор ресурсов...${reward}`);

        clearTimeout(claimTimeoutIds[tool.asset_id].timeout);
        delete claimTimeoutIds[tool.asset_id];

        // проверить есть ли в ближайшие 30 секунд другие сборы ресурсов, если есть, то новые claim запустят они
        for (const assetId in claimTimeoutIds) {
          if (claimTimeoutIds[assetId].startAt - Date.now() < 30000) return; // раньше чем через 30сек будет работать другой инструмент
        }

        if (stopped) return;

        setTimeout(addAllToClaim, 5000); // запросить с блокчейна актуальные кулдауны инструментов
      })
      .catch((e) => {
        // добавить проверку и какую-то обработку для CPU
        if (e.code === 'PERMISSION_DENIED') {
          farmer.logger.error('У аккаунта нет доступа к "farmersworld::"');
          return farmer.wMinerStopHook?.(e.code);
        }

        if (stopped) return;

        farmer.logger.error(e);

        return rerun(10 * 60 * 1000);
      });
  }
};
