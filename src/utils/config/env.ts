import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

const envStore: { [k: string]: string } = {};

export function loadEnv(options?: LoadEnvOptions) {
  if (!options) options = {};

  const src = fs.readFileSync(path.resolve(options.path ?? '.env'), {
    encoding: options.encoding ?? 'utf8',
  });

  const parsed = dotenv.parse(src, {
    debug: options.debug ?? false,
  });

  Object.keys(parsed).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(envStore, k)) return;

    envStore[k] = parsed[k];
  });
}

export function getEnv<T = string>(
  key: string,
  transformType?: TransformType<T>,
  defaultValue?: any,
): T {
  let value: any;

  if (Object.prototype.hasOwnProperty.call(envStore, key)) {
    value = envStore[key];
  } else if (Object.prototype.hasOwnProperty.call(process.env, key)) {
    value = process.env[key];
  }

  if (typeof value === 'undefined') {
    return resolveDefaultValue(defaultValue);
  }

  if (transformType) {
    if (transformType === (Boolean as Function) && typeof value === 'string') {
      value = value.trim();

      if (value === '' || value === 'false' || value === '0') {
        value = false;
      } else {
        value = true;
      }

      return value;
    }

    value = transformType(value);

    if (typeof value === 'undefined') {
      return resolveDefaultValue(defaultValue);
    }

    if (transformType === (Number as Function)) {
      if (!Number.isFinite(value)) {
        return resolveDefaultValue(defaultValue);
      }
    }
  }

  return value;
}

export function getEnvOrFail<T = string>(key: string, transformType?: TransformType<T>): T {
  const value = getEnv(key, transformType);

  if (typeof value === 'undefined') {
    throw new Error('Environment variable `' + key + '` does not exist');
  }

  return value;
}

function resolveDefaultValue(value: any) {
  if (typeof value === 'function') return value();

  return value;
}

interface LoadEnvOptions {
  path?: string;
  encoding?: fs.ObjectEncodingOptions['encoding'];
  debug?: boolean;
}

type TransformType<T> = (value: any) => T;
