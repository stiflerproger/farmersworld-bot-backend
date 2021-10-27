import * as path from 'path';
import { sync as globSync } from 'glob';

export function readConfig(
  pattern?: string | string[],
  options?: ReadConfigOptions,
): any[] {
  if (
    typeof pattern === 'object' &&
    pattern !== null &&
    !Array.isArray(pattern)
  ) {
    options = pattern;
    pattern = undefined;
  } else if (!options) {
    options = {};
  }

  const results: any[] = [];

  if (Array.isArray(options.packages)) {
    for (let i = 0, l = options.packages.length; i < l; i++) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const result = require(options.packages[i]);

      if (!result || !result.config) continue;

      if (Array.isArray(result.config)) {
        results.push(...result.config);
      } else if (result.config != null) {
        results.push(result.config);
      }
    }
  }

  if (Array.isArray(pattern)) {
    pattern = path.join(...pattern);
  }

  const matches: string[] = [];

  if (typeof pattern === 'string') {
    matches.push(
      ...globSync(path.isAbsolute(pattern) ? pattern : path.resolve(pattern)),
    );
  }

  for (let i = 0, l = matches.length; i < l; i++) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let result = require(matches[i]);

    if (result && typeof result.default !== 'undefined') {
      result = result.default;
    }

    if (Array.isArray(result)) {
      results.push(...result);
    } else if (result != null) {
      results.push(result);
    }
  }

  return results;
}

export interface ReadConfigOptions {
  /**
   * Список модулей для импорта конфигураций
   */
  packages?: string[];
}
