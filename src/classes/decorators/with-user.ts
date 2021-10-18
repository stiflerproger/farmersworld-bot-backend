/**
 * Загрузка юзера по ключу, перед выполнением метода, если его нет в инстансе
 */
export function WithUser() {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {

    const childFunction = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      if (!this.eosio.userAccount) {
        const availableKeys = await this.eosio.signatureProvider.getAvailableKeys();
        const key = availableKeys?.[0] || null;

        if (!key) throw 'No public keys are available';

        const accounts = await this.eosio.hyperionRpc.get_key_accounts(key);

        if (!accounts.account_names?.length) throw 'No accounts';

        this.eosio.userAccount = accounts.account_names[0];
      }

      return childFunction.apply(this, args);
    }

    return descriptor;

  }
}