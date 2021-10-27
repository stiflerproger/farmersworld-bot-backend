import { v4 as uuid4 } from 'uuid';
import { ApiInterfaces, RpcInterfaces } from 'eosjs';
import { NatsConnection, StringCodec } from 'nats';

export class NatsSignatureProvider {
  availableKeys: string[];

  constructor(
    private readonly nats: NatsConnection,
    private readonly nonces: string[],
    private readonly namespace: string,
  ) {}

  async genAccountKeys(): Promise<{ [nonce: string]: string }> {
    return natsRequestOne(this.nats, `${this.namespace}.genAccountKeys`, {
      id: uuid4(),
      data: {
        nonces: this.nonces,
      },
    });
  }

  async getAvailableKeys(): Promise<string[]> {
    if (this.availableKeys) {
      return this.availableKeys;
    }

    return (this.availableKeys = await natsRequestOne(
      this.nats,
      `${this.namespace}.getAvailableKeys`,
      {
        id: uuid4(),
        data: {
          nonces: this.nonces,
        },
      },
    ));
  }

  async sign(
    args: ApiInterfaces.SignatureProviderArgs,
  ): Promise<RpcInterfaces.PushTransactionArgs> {
    const { signatures }: { signatures: string[] } = await natsRequestOne(
      this.nats,
      `${this.namespace}.sign`,
      {
        id: uuid4(),
        data: {
          nonces: this.nonces,
          transaction: {
            chainId: args.chainId,
            requiredKeys: args.requiredKeys,
            serializedTransaction: Array.from(args.serializedTransaction),
            serializedContextFreeData:
              args.serializedContextFreeData &&
              Array.from(args.serializedContextFreeData),
          },
        },
      },
    );

    return {
      signatures,
      serializedTransaction: args.serializedTransaction,
      serializedContextFreeData: args.serializedContextFreeData,
    };
  }
}

function natsRequestOne(
  nats: NatsConnection,
  subject: string,
  msg: any,
  timeout = 15000,
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      const message = await nats.request(subject, msg, {
        timeout: timeout,
        noMux: true,
      });

      const sc = StringCodec();

      return resolve(
        Buffer.isBuffer(message.data) ? sc.decode(message.data) : message.data,
      );
    } catch (err) {
      return reject(err);
    }
  });
}
