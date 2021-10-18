export function WithUser() {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {

    const childFunction = descriptor.value;

    console.log(target, propertyKey, descriptor)

    descriptor.value = async (...args: any[]) => {
      console.log(target)
      if (!this.userAccount) {
        const key = (await target.signatureProvider.getAvailableKeys())[1];

        console.log(await target.hyperionRpc.get_key_accounts(key))
      }

      return childFunction.apply(this, args);
    }

    return descriptor;

  }
}