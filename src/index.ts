import {EOSIOAccount} from "./modules/eosio-account";

const account = new EOSIOAccount("", {
  iFarmer: true
})

account.init();