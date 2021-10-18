// пул для работы на карте "mining"

import {Worker} from "../interfaces/worker";
import {Farmer} from "../farmer";
import * as eosCommon from 'eos-common';
import {AccountFwTool} from "../interfaces/fw-tools";
import {sleep} from "../../utils/sleep";

export const startWorker: Worker = function(farmer: Farmer) {

  let stopped = false,
    timeoutId: NodeJS.Timeout;

  const toolRepairLimit = 51, // ремонт инструмента если ниже этого
    toolSubRepairLimit = 70, // попутно ремонтировать инструмент
    energyRefillLimit = 350,
    energySubRefillLimit = 450;

  start();

  return () => {
    if (stopped) return;

    stopped = true;

    // обработчики остановки воркера
  }

  // TODO: добавить обрабочиков исключений

  function start() {
    // начало работы воркера
    if (stopped) return;

    farmer.getAccountStats()
      .then(async stats => {

        if (stopped) return;

        const tools = await farmer.getAccountTools();

        if (stopped) return;

        console.log(stats, tools);

        // проверить состояние инструментов
        const goldNeeded = {
          repair: 0,
          subRepair: 0,
        }, foodNeeded = {
          refill: 0,
          subRefill: 0,
        };

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

        if (goldNeeded.repair > 0 || foodNeeded.refill > 0) {
          // нужно либо чиниться, либо пополнять энергию
          let totalGoldNeeded = (goldNeeded.repair + goldNeeded.subRepair);
          let totalFoodNeeded = (foodNeeded.refill + foodNeeded.subRefill);

          // вычесть текущий баланс
          totalGoldNeeded -= stats.balance.gold;
          totalFoodNeeded -= stats.balance.food;

          if (totalGoldNeeded > 0 || totalFoodNeeded > 0) {

            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              exchangeResources(totalGoldNeeded * 1.15, totalFoodNeeded * 1.15); // планируем на 15% запас
            }, 5000);

          } else {

            // ресурсов хватает на счету
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => repairAndRefill(tools), 6000);

          }
          return;
        }

        // всё ок, запуск сбора ресурсов
        console.log('ok');

      })

  }

  function repairAndRefill(tools: AccountFwTool[]) {

    if (stopped) return;

    farmer.getAccountStats()
      .then(async stats => {

        if (stopped) return;

        for (let tool of tools) {
          if (
            (tool.current_durability < toolRepairLimit || tool.current_durability < toolSubRepairLimit)
            && stats.balance.gold >= (tool.durability - tool.current_durability) * 0.2
          ) {

            if (stopped) return;

            // починить и снять с текущего баланса
            await farmer.eosio.api.transact({
              actions: [{
                account: "farmersworld",
                name: "repair",
                authorization: [{
                  actor: farmer.eosio.userAccount,
                  permission: "active"
                }],
                data: {
                  asset_id: tool.asset_id,
                  asset_owner: farmer.eosio.userAccount,
                }
              }]
            }, {
              blocksBehind: 3,
              expireSeconds: 30,
            });

            farmer.balance.gold -= (tool.durability - tool.current_durability) * 0.2;

            await sleep(5000);

          }
        }

        if (
          (stats.energy.current < energyRefillLimit || stats.energy.current < energySubRefillLimit)
          && stats.balance.food >= (stats.energy.max - stats.energy.current) * 0.2
        ) {

          if (stopped) return;

          await farmer.eosio.api.transact({
            actions: [{
              account: "farmersworld",
              name: "recover",
              authorization: [{
                actor: farmer.eosio.userAccount,
                permission: "active"
              }],
              data: {
                energy_recovered: Math.floor(stats.energy.max - stats.energy.current),
                owner: farmer.eosio.userAccount,
              }
            }]
          }, {
            blocksBehind: 3,
            expireSeconds: 30,
          });

          farmer.balance.food -= (stats.energy.max - stats.energy.current) * 0.2;

          await sleep(5000);

        }

        console.log('repaired and refilled');
        clearTimeout(timeoutId);
        timeoutId = setTimeout(start, 30000);

      })
      .catch(e => {
        console.log(e)
      })

  }

  /** Обмен ресурсов с кошельков и обмен вакса на ресурсы при необходимости */
  function exchangeResources(gold?: number, food?: number, wood?: number) {

    if (stopped) return;

    const fromAlcor = {
      wood: 0,
      gold: 0,
      food: 0,
    };

    farmer.eosio.rpc.get_currency_balance('farmerstoken', farmer.eosio.userAccount)
      .then(async currencies => {
        if (stopped) return;

        for (const currency of currencies) {
          const [amount, token] = currency.split(' ');

          if (token === "FWG") {
            if (!gold || gold < 0) continue;

            fromAlcor.gold = Math.max(0, gold - Number(amount));
          }

          if (token === "FWW") {
            if (!wood || wood < 0) continue;

            fromAlcor.wood = Math.max(0, wood - Number(amount));
          }

          if (token === "FWF") {
            if (!food || food < 0) continue;

            fromAlcor.food = Math.max(0, food - Number(amount));
          }
        }

        clearTimeout(timeoutId);

        if (fromAlcor.wood + fromAlcor.gold + fromAlcor.food > 0) {

          timeoutId = setTimeout(() => {
            getResourcesFromAlcor(fromAlcor.gold, fromAlcor.food, fromAlcor.gold);
          }, 5000);

        } else {

          // TODO: запустить обмен на внутриигровую валюту

          timeoutId = setTimeout(() => {
            depositTokens(gold || 0, food || 0, wood || 0);
          }, 5000);

        }

      })

  }

  /** Кидаем в депозит весь баланс валют */
  function depositTokens(fwg: number, fwf: number, fww: number) {
    // депозит без комиссий
    if (stopped) return;

    fwg = Number(fwg.toFixed(4));
    fwf = Number(fwf.toFixed(4));
    fww = Number(fww.toFixed(4));

    const quants = [];

    if (fwg > 0) {
      quants.push(eosCommon.asset(
        Math.pow(10, 4) * fwg,
        eosCommon.symbol('FWG', 4),
      ).to_string());
    }

    if (fwf > 0) {
      quants.push(eosCommon.asset(
        Math.pow(10, 4) * fwf,
        eosCommon.symbol('FWF', 4),
      ).to_string());
    }

    if (fww > 0) {
      quants.push(eosCommon.asset(
        Math.pow(10, 4) * fww,
        eosCommon.symbol('FWW', 4),
      ).to_string());
    }

    if (!quants.length) throw 'Needs any amount to be set';

    if (stopped) return;

    farmer.eosio.api.transact({
      actions: [{
        account: "farmerstoken",
        name: "transfers",
        authorization: [{
          actor: farmer.eosio.userAccount,
          permission: "active"
        }],
        data: {
          from: farmer.eosio.userAccount,
          memo: "deposit",
          quantities: quants,
          to: "farmersworld"
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    }).then(res => {

      if (stopped) return;

      console.log('deposited');
      clearTimeout(timeoutId);
      timeoutId = setTimeout(start, 30000);

    }).catch(e => {

      console.log(e)

    });

  }

  function getResourcesFromAlcor(fwg: number, fwf: number, fww: number) {

    // необходимые ресурсы на обмен
    fwg = Number(fwg.toFixed(4));
    fwf = Number(fwf.toFixed(4));
    fww = Number(fww.toFixed(4));

    // посчитать необходимый wax, если не хватит, то отправить весь wood на обмен на wax

    return;

  }

}