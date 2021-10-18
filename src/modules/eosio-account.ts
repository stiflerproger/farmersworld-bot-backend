import {Api, JsonRpc} from "eosjs";
import {JsonRpc as HyperionJsonRpc} from "@eoscafe/hyperion/dist/src/jsonrpc";
import {JsSignatureProvider} from "eosjs/dist/eosjs-jssig";
import {Farmer} from "../classes/farmer";
import {TextDecoder, TextEncoder} from "util";
import fetch from 'node-fetch';

// инстанс аккаунта eosio. Общие методы и данные в этом классе
export class EOSIOAccount {

  rpc: JsonRpc;
  hyperionRpc: HyperionJsonRpc;
  api: Api;
  signatureProvider: JsSignatureProvider;

  userAccount: string;

  iFarmer: Farmer;

  constructor(private readonly privateKey: string, options?: {
    iFarmer?: boolean
  }) {
    this.rpc = new JsonRpc('https://api.waxsweden.org', { fetch });

    this.hyperionRpc = new HyperionJsonRpc('https://wax.eosrio.io', { fetch });

    this.signatureProvider = new JsSignatureProvider([privateKey]);

    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: this.signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });

    if (options?.iFarmer) this.iFarmer = new Farmer(this); // инстанс работающий с игрой FarmersWorld
  }

  async init() {
    await this.iFarmer?.enable();
  }

}