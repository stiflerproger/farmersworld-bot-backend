import { JsonRpc as HyperionJsonRpc } from '@eoscafe/hyperion';

type TypeOfClassMethod<T, M extends keyof T> = T[M] extends (...args: any) => any ? T[M] : never;

export type HistoryActionsOptions = Omit<
  Parameters<TypeOfClassMethod<HyperionJsonRpc, 'get_actions'>>[1],
  'limit' | 'skip' | 'sort'
>;
