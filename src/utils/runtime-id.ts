import { v4 as uuid4 } from 'uuid';

const RUNTIME_ID = uuid4();

/**
 * Возвращает уникальный ID процесса, который будет меняться при каждом перезапуске
 */
export function getRuntimeId(): string {
  return RUNTIME_ID;
}
