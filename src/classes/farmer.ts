import fetch from 'node-fetch';
import { Api, JsonRpc, RpcError } from 'eosjs';
import { JsSignatureProvider } from 'eosjs/dist/eosjs-jssig';
import { TextEncoder, TextDecoder} from 'util';
import { Action, JsonRpc as HyperionJsonRpc } from '@eoscafe/hyperion';
import {WithUser} from "./decorators/with-user";

export class Farmer {

  rpc: JsonRpc;
  hyperionRpc: HyperionJsonRpc;
  api: Api;
  signatureProvider: JsSignatureProvider;

  userAccount: string;

  constructor(private privateKey: string) {
    this.rpc = new JsonRpc('https://api.waxsweden.org', { fetch });

    this.hyperionRpc = new HyperionJsonRpc('https://wax.eosrio.io', { fetch });

    this.signatureProvider = new JsSignatureProvider([privateKey]);

    this.hyperionRpc.get_key_accounts('PUB_K1_7sRNojZiUFKHqiaGqmCSPZJoXAe6e6NcPzLidLtb9sWCZBFQdH')
      .then(res => {
        console.log(res)
      })
      .catch(console.error)


    this.api = new Api({
      rpc: this.rpc,
      signatureProvider: this.signatureProvider,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    });
  }

  /**
   * Собрать ресурс
   */
  @WithUser()
  async claim(assetId: number) {

    return;
    const result = await this.api.transact({
      actions: [{
        account: "farmersworld",
        name: "claim",
        authorization: [{
          actor: "stiflerroman",
          permission: "active"
        }],
        data: {
          owner: "stiflerroman",
          asset_id: 1099569354572,
        }
      }]
    }, {
      blocksBehind: 3,
      expireSeconds: 30,
    });

    return result;

  }

}