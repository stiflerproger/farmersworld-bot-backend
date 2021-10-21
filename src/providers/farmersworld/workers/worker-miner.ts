// пул для работы на карте "mining"

import {Worker} from "../interfaces/worker";
import * as eosCommon from 'eos-common';
import {Asset} from 'eos-common';
import {AccountFwTool} from "../interfaces/fw-tools";
import {waitFor} from "@utils/wait-for";
import {TransactResult} from "eosjs/dist/eosjs-api-interfaces";
import {FarmersWorld} from "@providers/farmersworld";
import PQueue from "p-queue";
import {clearTimeout} from "timers";

export const startWorker: Worker = function (farmer: FarmersWorld) {

  let stopped = false,
    timeoutId: NodeJS.Timeout,
    claimStarted = false, // первый запуск бота сначала чинит инструменты, потом в работает в 2 процесса
    claimTimeoutIds: {
      [key: string]: {
        startAt: number | null; // время когда таймаут запустится
        timeout: NodeJS.Timeout
      }
    } = {}; // для каждого инструмента свой таймаут

  const toolRepairLimit = 51, // ремонт инструмента если ниже этого
    toolSubRepairLimit = 70, // попутно ремонтировать инструмент
    energyRefillLimit = 350,
    energySubRefillLimit = 450;

  // инструменты что хотят копать кидаем сюда, и
  const pQueue = new PQueue({
    concurrency: 1,
  });

  start();

  return () => {
    if (stopped) return;

    stopped = true;

    clearTimeout(timeoutId);

    for (const assetId in claimTimeoutIds) {
      claimTimeoutIds[assetId].startAt = null;
      clearTimeout(claimTimeoutIds[assetId].timeout);
      delete claimTimeoutIds[assetId];
    }
  }

  /** перезапуск процесса */
  function rerun(ms) {
    if (stopped) return;

    clearTimeout(timeoutId);

    for (const assetId in claimTimeoutIds) {
      claimTimeoutIds[assetId].startAt = null;
      clearTimeout(claimTimeoutIds[assetId].timeout);
      delete claimTimeoutIds[assetId];
    }

    farmer.logger.log('Инициирован полный перезапуск!');
    timeoutId = setTimeout(start, ms);
  }

  // TODO: добавить обрабочиков исключений

  /** Восстановление энергии и починка инструментов, как отдельный процесс */
  function start() {
    // начало работы воркера
    farmer.logger.log('Старт...')
    if (stopped) return;

    getRefillInfo()
      .then(async refillData => {

        if (stopped) return;

        if (refillData.alcor?.length) {
          // обмениваем с алкора
          farmer.logger.log(`Нужно обменять ресурсы с Alcor: [${refillData.alcor.map(eosAsset => eosAsset.quantity.toString()).join(', ')}]`);

          // TODO: обмен с Alcor

          if (stopped) return;
          clearTimeout(timeoutId);
          timeoutId = setTimeout(start, 60 * 1000); // через минуту после обмена повторяем запуск
          return;
        }

        if (refillData.deposit?.length) {
          // депозитим баланс внутрь игры
          farmer.logger.log(`Нужно задепозитить ресурсы: [${refillData.deposit.map(eosAsset => eosAsset.quantity.toString()).join(', ')}]`);

          // TODO: депозит ресурсов
          await depositTokens(refillData.deposit);

          farmer.logger.log(`Депозит выполнен. Через минут перепроверка`);

          if (stopped) return;
          clearTimeout(timeoutId);
          timeoutId = setTimeout(start, 60 * 1000); // через минуту после обмена повторяем запуск
          return;
        }

        if (refillData.refill) {
          // чиним инструменты и поплняем энергию
          farmer.logger.log(`Нужно починиться и восполнить энергию`);

          // TODO: починка
          await repairAndRefill();

          farmer.logger.log(`Через минут перепроверка`);

          if (stopped) return;
          clearTimeout(timeoutId);
          timeoutId = setTimeout(start, 60 * 1000); // через минуту после обмена повторяем запуск
          return;
        }

        farmer.logger.log('Инструменты и энергия на достаточном уровне. Новая проверка через 5 часов!');

        clearTimeout(timeoutId);
        timeoutId = setTimeout(start, 5 * 60 * 60 * 1000); // раз в 5 часов проверять необходимость починки инструментов

        if (!claimStarted) {
          claimStarted = true;
          setTimeout(addAllToClaim, 5000); // запускаем отдельный процесс для сбора ресурсов
        }

      })
      .catch(e => {
        farmer.logger.error(e);

        return rerun(60 * 1000);
      })

  }

  /** Получить информацию о необходимости починки инструментов или восполнении энергии */
  async function getRefillInfo(): Promise<{
    alcor?: eosCommon.ExtendedAsset[], // нужно обменять с алкора
    deposit?: eosCommon.ExtendedAsset[], // нужно депнуть на внутриигровой счёт
    refill?: boolean, // нужно починиться или восстановить энергию
  }> {

    const goldNeeded = {
      repair: 0,
      subRepair: 0,
    }, foodNeeded = {
      refill: 0,
      subRefill: 0,
    };

    const stats = await farmer.getAccountStats();
    const tools = await farmer.getAccountTools();

    for (let tool of tools) {
      if (tool.current_durability < toolRepairLimit) {
        goldNeeded.repair += (tool.durability - tool.current_durability) * 0.2; // 0.2 GOLD за единицу починки
      } else if (tool.current_durability < toolSubRepairLimit) {
        goldNeeded.subRepair += (tool.durability - tool.current_durability) * 0.2;
      }
    }

    if (stats.energy.current < energyRefillLimit) {
      foodNeeded.refill += (stats.energy.max - stats.energy.current) * 0.2; // 0.2 FOOD за единицу энергии
    } else if (stats.energy.current < energySubRefillLimit) {
      foodNeeded.subRefill += (stats.energy.max - stats.energy.current) * 0.2;
    }

    if (foodNeeded.refill + goldNeeded.repair <= 0) {
      // всё окей, можно работать

      return {
        refill: false
      };
    }

    // общее количество недостающего ресурса для восполнения
    let depositGoldNeeded = (goldNeeded.repair + goldNeeded.subRepair),
      depositFoodNeeded = (foodNeeded.refill + foodNeeded.subRefill);

    // вычесть текущий внутриирговой баланс
    depositGoldNeeded -= stats.balance.gold;
    depositFoodNeeded -= stats.balance.food;

    if (depositGoldNeeded > 0 || depositFoodNeeded > 0) {

      // нужно задепозитить какое-то количество ресурсов в игру
      // вычисляем сколько ресурсов нужно обменять с алкора

      depositGoldNeeded *= 1.15; // планируем на 15% запас
      depositFoodNeeded *= 1.15;

      const exchange = await getExchangeInfo(
        eosCommon.asset(
          Math.pow(10, 4) * depositGoldNeeded,
          eosCommon.symbol('FWG', 4),
        ),
        eosCommon.asset(
          Math.pow(10, 4) * depositFoodNeeded,
          eosCommon.symbol('FWF', 4),
        ),
        null
      );

      return {
        refill: true,
        deposit: exchange.deposit,
        alcor: exchange.alcor,
      };

    }

    return {
      refill: true, // просто восстанавливаемся
    };

  }

  async function repairAndRefill() {

    const stats = await farmer.getAccountStats();
    const tools = await farmer.getAccountTools();

    if (stopped) return;

    for (let tool of tools) {
      if (
        (tool.current_durability < toolRepairLimit || tool.current_durability < toolSubRepairLimit)
        && stats.balance.gold >= (tool.durability - tool.current_durability) * 0.2
      ) {

        if (stopped) return;

        // починить и снять с текущего баланса
        await farmer.account.wax.transact({
          actions: [{
            account: "farmersworld",
            name: "repair",
            authorization: [{
              actor: farmer.account.wax.userAccount,
              permission: "active"
            }],
            data: {
              asset_id: tool.asset_id,
              asset_owner: farmer.account.wax.userAccount,
            }
          }]
        }, {
          blocksBehind: 3,
          expireSeconds: 30,
        });

        farmer.balance.gold -= (tool.durability - tool.current_durability) * 0.2;

        await waitFor(5000);

      }
    }

    if (
      (stats.energy.current < energyRefillLimit || stats.energy.current < energySubRefillLimit)
      && stats.balance.food >= (stats.energy.max - stats.energy.current) * 0.2
    ) {

      if (stopped) return;

      await farmer.account.wax.transact({
        actions: [{
          account: "farmersworld",
          name: "recover",
          authorization: [{
            actor: farmer.account.wax.userAccount,
            permission: "active"
          }],
          data: {
            energy_recovered: Math.floor(stats.energy.max - stats.energy.current),
            owner: farmer.account.wax.userAccount,
          }
        }]
      }, {
        blocksBehind: 3,
        expireSeconds: 30,
      });

      farmer.balance.food -= (stats.energy.max - stats.energy.current) * 0.2;

      await waitFor(5000);

    }

    farmer.logger.log('Инструменты успешно отремонтированы, и энергия восстановлена');

    return;

  }

  /** Функция принимает количество ресурсов что хочется видеть на балансе, и возвращает информацию как их получить */
  async function getExchangeInfo(
    fwg: Asset | null,
    fwf: Asset | null,
    fww: Asset | null,
  ): Promise<{
    alcor: eosCommon.ExtendedAsset[], // количество для обмена с алкора
    deposit: eosCommon.ExtendedAsset[] // количество для депозита
  }> {

    // баланс валют
    const tokens: { [key: string]: eosCommon.ExtendedAsset } = (await farmer.account.wax.getBalance({
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

    if (fwg) {
      if (tokens["FWG"].quantity.isGreaterThanOrEqual(fwg)) {
        // токенов на балансе достаточно
        tokens["FWG"].quantity.set_amount(fwg.amount);

        result["deposit"].push(tokens["FWG"]);
      } else {
        // нужно обменять с алкора
        tokens["FWG"].quantity.set_amount(fwg.amount.minus(tokens["FWG"].quantity.amount));

        result["alcor"].push(tokens["FWG"]);
      }
    }

    if (fwf) {
      if (tokens["FWF"].quantity.isGreaterThanOrEqual(fwf)) {
        // токенов на балансе достаточно
        tokens["FWF"].quantity.set_amount(fwf.amount);

        result["deposit"].push(tokens["FWF"]);
      } else {
        // нужно обменять с алкора
        tokens["FWF"].quantity.set_amount(fwf.amount.minus(tokens["FWF"].quantity.amount));

        result["alcor"].push(tokens["FWF"]);
      }
    }

    if (fww) {
      if (tokens["FWW"].quantity.isGreaterThanOrEqual(fww)) {
        // токенов на балансе достаточно
        tokens["FWW"].quantity.set_amount(fww.amount);

        result["deposit"].push(tokens["FWW"]);
      } else {
        // нужно обменять с алкора
        tokens["FWW"].quantity.set_amount(fww.amount.minus(tokens["FWW"].quantity.amount));

        result["alcor"].push(tokens["FWW"]);
      }
    }

    return result;

  }

  /** Кидаем в депозит весь баланс валют */
  async function depositTokens(tokens: eosCommon.ExtendedAsset[]) {
    // депозит без комиссий

    if (stopped) return;

    return await farmer.account.wax.transact({
      actions: [{
        account: "farmerstoken",
        name: "transfers",
        authorization: [{
          actor: farmer.account.wax.userAccount,
          permission: "active"
        }],
        data: {
          from: farmer.account.wax.userAccount,
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

  /** Добавление новых инструментов в очередь сбора ресурсов. Те что уже в очереди игнорируются (т.е. можно вызывать постоянно, ничего не дублируется) */
  function addAllToClaim() {

    if (stopped) return;

    farmer.getAccountTools()
      .then(tools => {

        if (stopped) return;

        for (const tool of tools) {

          if (claimTimeoutIds[tool.asset_id]?.startAt) continue;

          const claimOn = new Date((tool.next_availability * 1000) + Math.floor(Math.random() * (30000 - 2000)) + 2000); // +(2-30)sec

          // проверить инструмент на починку
          if (tool.current_durability - tool.template.durability_consumed < 0) {
            farmer.logger.error('Инструмент не может использоваться! ' + tool.asset_id);
            // TODO: ситуаиця теоритически невозможная, но можно будет обрабатывать
            continue;
          }

          const claimAfter = claimOn.getTime() - Date.now();

          const min = Math.floor(claimAfter / 1000 / 60),
            sec = Math.floor((claimAfter / 1000) - (min * 60));

          farmer.logger.log(`${tool.asset_id} использование через: ${min}:${sec}`);

          if (claimTimeoutIds[tool.asset_id]) delete claimTimeoutIds[tool.asset_id];

          claimTimeoutIds[tool.asset_id] = {
            startAt: claimOn.getTime(),
            timeout: setTimeout(() => claim(tool), claimAfter),
          }

        }

      })
      .catch(e => {
        farmer.logger.error(e);

        return rerun(60 * 1000);
      })

  }

  function claim(tool: AccountFwTool) {
    if (stopped) return;

    farmer.logger.log(`${tool.asset_id} сбор ресурсов...`);

    farmer.claim(Number(tool.asset_id))
      .then(res => {

        if (stopped) return;

        const inlineTraces = (res as TransactResult).processed.action_traces[0].inline_traces;

        let reward = '';

        for (let trace of inlineTraces) {
          if (trace.act.name === "logbonus") reward = reward + ` BONUS [${trace.act.data.bonus_rewards.join(", ")}]`;
          if (trace.act.name === "logclaim") reward = `[${trace.act.data.rewards.join(", ")}]` + reward;
        }

        if (!reward) throw 'Не получен reward. Перезапуск.';

        farmer.logger.log(`${tool.asset_id} сбор ресурсов...${reward}`);

        clearTimeout(claimTimeoutIds[tool.asset_id].timeout);
        delete claimTimeoutIds[tool.asset_id];

        // проверить есть ли в ближайшие 20 секунд другие сборы ресурсов, если есть, то новые claim запустят они
        for (let assetId in claimTimeoutIds) {
          if (claimTimeoutIds[assetId].startAt - Date.now() < 20000) return; // раньше чем через 20сек будет работать другой инструмент
        }

        if (stopped) return;

        setTimeout(addAllToClaim, 5000); // запросить с блокчейна актуальные кулдауны инструментов

      })
      .catch((e) => {
        // очищаем все таймеры и перезапускаем всё
        if (stopped) return;

        farmer.logger.error(e);

        return rerun(10 * 60 * 1000);
      });

  }

}