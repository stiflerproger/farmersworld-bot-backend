import { Agent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { URL } from 'url';
import * as crypto from 'crypto';
import { shuffle as _shuffle } from 'lodash';
import pMap from 'p-map';
import nodeFetch, {
  RequestInfo,
  RequestInit,
  Request,
  Response,
  Headers,
} from 'node-fetch';
import nodeFetchCookieDecorator from 'fetch-cookie/node-fetch';
import { CookieJar } from 'tough-cookie';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';

const IS_JAR_PROXIFIED = Symbol('IsJarProxified');

const ENDPOINTS_HEALTH_CHECK = {
  rpc: new Map<string, EndpointHealthCheck>(),
  hyperionRpc: new Map<string, EndpointHealthCheck>(),
};

setInterval(checkEndpointsHealth, 600000); // 10 минут

export function configureFetch(
  options?: FetchConfigurationOptions,
): FetchFunction {
  options = { ...options };

  const onCookieUpdateHandlers: ((jar: CookieJar) => void)[] = [];

  let jar = options.cookieJar;
  let proxy =
    typeof options.proxy === 'string'
      ? formatProxyStr(options.proxy)
      : options.proxy;
  let agent = createAgents(proxy);
  let userAgent = options.userAgent;

  proxyCookieJarSetCookie(jar, onCookieUpdateHandlers);

  let fetch = jar ? nodeFetchCookieDecorator(nodeFetch, jar) : nodeFetch;

  fetchWrapper.getCookieJar = () => jar;
  fetchWrapper.setCookieJar = (
    newJar: FetchConfigurationOptions['cookieJar'],
  ) => {
    jar = newJar;

    proxyCookieJarSetCookie(jar, onCookieUpdateHandlers);

    fetch = nodeFetchCookieDecorator(nodeFetch, jar);
  };
  fetchWrapper.getProxy = () => proxy;
  fetchWrapper.setProxy = (newProxy: FetchConfigurationOptions['proxy']) => {
    proxy = typeof newProxy === 'string' ? formatProxyStr(newProxy) : newProxy;
    agent = createAgents(proxy);
  };
  fetchWrapper.getUserAgent = () => userAgent;
  fetchWrapper.setUserAgent = (
    newUserAgent: FetchConfigurationOptions['userAgent'],
  ) => {
    userAgent = newUserAgent;
  };

  fetchWrapper.createEndpointRewriteProxy = createEndpointRewriteProxy.bind(
    null,
    fetchWrapper,
  );

  fetchWrapper.onCookieUpdate = (handler: (jar: CookieJar) => void) => {
    onCookieUpdateHandlers.push(handler);
  };

  return fetchWrapper;

  async function fetchWrapper(
    url: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    [url, init] = normalizeFetchArgs(url, init);

    const urlObj = new URL(url);

    if (urlObj.protocol === 'https:') {
      if (agent.https) {
        init.agent = agent.https;
      }
    } else if (agent.http) {
      init.agent = agent.http;
    }

    const headers =
      init.headers && typeof init.headers['append'] === 'function'
        ? (init.headers as Headers)
        : (init.headers = new Headers(init.headers || {}));

    headers.set('Host', urlObj.hostname);
    headers.set(
      'Accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    );
    headers.set('Accept-Language', 'en-US,en;q=0.9');

    if (userAgent) {
      headers.set('User-Agent', userAgent);
    }

    return fetch(url, init);
  }
}

function createEndpointRewriteProxy(
  fetch: FetchFunction,
  endpoints: string[],
  options?: {
    category?: string;
    attempts?: number;
  },
) {
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error('No endpoints specified');
  }

  options = { ...options };

  // Создаем копию массива с перетасованными элементами
  endpoints = _shuffle(endpoints).map((endpoint) => new URL(endpoint).host);
  options.attempts = Math.max(1, Math.round(options.attempts)) || 1;

  let categoryEndpoints: Map<string, EndpointHealthCheck>;

  if (
    Object.prototype.hasOwnProperty.call(
      ENDPOINTS_HEALTH_CHECK,
      options.category,
    )
  ) {
    categoryEndpoints = ENDPOINTS_HEALTH_CHECK[options.category];

    for (let i = 0, l = endpoints.length; i < l; i++) {
      if (categoryEndpoints.has(endpoints[i])) continue;

      categoryEndpoints.set(endpoints[i], {
        endpoint: endpoints[i],
        isOk: true, // По умолчанию ставим что с endpoint-ом все ок
      });
    }
  }

  return async (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    const endpointIterator = createEndpointIterator();

    if (!endpointIterator.endpoint) {
      throw new Error('No functional endpoint available at the moment');
    }

    [url, init] = normalizeFetchArgs(url, init);

    const urlObj = new URL(url);

    for (let i = options.attempts - 1; i >= 0; i--) {
      urlObj.host = endpointIterator.endpoint; // Ставим нужный домен

      let response: Response;

      try {
        response = await fetch(urlObj.toString(), init);
      } catch (e) {
        if (endpointIterator.next() && i) continue;

        throw e;
      }

      if ([403, 429, 502, 503].includes(response.status)) {
        if (endpointIterator.next() && i) continue;
      }

      return response;
    }
  };

  function createEndpointIterator() {
    let iterated = 0;
    let endpoint = getFunctionalEndpoint();

    return {
      get endpoint(): string {
        return endpoint;
      },
      next(): boolean {
        endpoint = getFunctionalEndpoint(true);

        return !!endpoint;
      },
    };

    function getFunctionalEndpoint(change?: boolean): string {
      if (change) {
        endpoints.push(endpoints.shift()); // Текущий домен перемещаем в конце
        iterated++;
      }

      for (let i = 0, l = endpoints.length - iterated; i < l; i++) {
        if (categoryEndpoints.get(endpoints[0])?.isOk) {
          return endpoints[0];
        }

        endpoints.push(endpoints.shift()); // Текущий домен перемещаем в конце
        iterated++;
      }

      return null;
    }
  }
}

function proxyCookieJarSetCookie(
  jar: CookieJar,
  handlers: ((jar: CookieJar) => void)[],
): void {
  if (!jar || jar[IS_JAR_PROXIFIED]) return;

  const setCookie = jar.setCookie;

  let timeoutId: NodeJS.Timeout;

  // Проксируем вызовы
  (jar.setCookie as any) = function (...args: any[]) {
    const result = setCookie.apply(jar, args);

    clearTimeout(timeoutId);
    timeoutId = setTimeout(emit, 1000);

    return result;
  };

  jar[IS_JAR_PROXIFIED] = true;

  function emit(): void {
    try {
      for (let i = 0, l = handlers.length; i < l; i++) {
        handlers[i].call(null, jar);
      }
    } catch (e) {
      // ignore
    }
  }
}

function formatProxyStr(proxy: string): URL {
  const proxyUrlObj = new URL(proxy);

  if (!proxyUrlObj.hostname || !+proxyUrlObj.port) {
    throw new Error('Invalid proxy url');
  }

  return proxyUrlObj;
}

function createAgents(proxy?: URL): {
  http?: Agent | HttpProxyAgent;
  https?: HttpsAgent | HttpsProxyAgent;
} {
  if (proxy) {
    return {
      http: new HttpProxyAgent({
        proxy,
      }),
      https: new HttpsProxyAgent({
        proxy,
        ciphers: crypto.constants.defaultCipherList + ':!ECDHE+SHA:!AES128-SHA',
        ecdhCurve: 'P-256',
      }),
    };
  }

  return {
    https: new HttpsAgent({
      ciphers: crypto.constants.defaultCipherList + ':!ECDHE+SHA:!AES128-SHA',
      ecdhCurve: 'P-256',
    }),
  };
}

function normalizeFetchArgs(
  url: RequestInfo,
  init?: RequestInit,
): [string, RequestInit] {
  init = { ...init };

  if (typeof url !== 'string') {
    if (url['href']) {
      url = url['href'];
    } else {
      const { url: _url, ...initOptions } = url as Request;

      Object.assign(init, initOptions);

      url = _url;
    }
  }

  return [url as string, init];
}

function checkEndpointsHealth(): void {
  update();

  async function update(): Promise<void> {
    const concurrency = 5;

    await pMap(Array.from(ENDPOINTS_HEALTH_CHECK.rpc.values()), checkRpc, {
      concurrency,
    });
    await pMap(
      Array.from(ENDPOINTS_HEALTH_CHECK.hyperionRpc.values()),
      checkHyperionRpc,
      {
        concurrency,
      },
    );
  }

  async function checkRpc(info: EndpointHealthCheck): Promise<void> {
    try {
      const response = await nodeFetch(
        `https://${info.endpoint}/v1/chain/get_info`,
        {
          headers: {
            'User-Agent': '', // Оставляем пустой User Agent чтобы fetch не использовал значение по умолчанию
          },
        },
      );
      const body = await response.json();
      const headBlockTime = new Date(
        body.head_block_time.replace(/Z$/, '') + 'Z',
      ).getTime();

      if (Number.isNaN(headBlockTime) || headBlockTime + 600000 < Date.now()) {
        throw new Error('Head block is too old');
      }

      info.isOk = true;
    } catch (e) {
      info.isOk = false;
    }
  }

  async function checkHyperionRpc(info: EndpointHealthCheck): Promise<void> {
    try {
      const response = await nodeFetch(`https://${info.endpoint}/v2/health`, {
        headers: {
          'User-Agent': '', // Оставляем пустой User Agent чтобы fetch не использовал значение по умолчанию
        },
      });
      const body = await response.json();

      let headBlockTime: number;

      for (let i = 0, l = body.health.length; i < l; i++) {
        if (body.health[i].status !== 'OK') {
          throw new Error(
            `Service ${body.health[i].service} is not functional`,
          );
        }

        if (body.health[i].service === 'NodeosRPC') {
          headBlockTime = new Date(
            body.health[i].service_data.head_block_time.replace(/Z$/, '') + 'Z',
          ).getTime();
        }
      }

      if (Number.isNaN(headBlockTime) || headBlockTime + 600000 < Date.now()) {
        throw new Error('Head block is too old');
      }

      info.isOk = true;
    } catch (e) {
      info.isOk = false;
    }
  }
}

export interface FetchFunction extends Function {
  (url: RequestInfo, init?: RequestInit): Promise<Response>;
  getCookieJar: () => CookieJar;
  setCookieJar: (jar: FetchConfigurationOptions['cookieJar']) => void;
  getProxy: () => URL;
  setProxy: (proxy: FetchConfigurationOptions['proxy']) => void;
  getUserAgent: () => string;
  setUserAgent: (userAgent: FetchConfigurationOptions['userAgent']) => void;

  createEndpointRewriteProxy: (
    endpoints: string[],
    options?: {
      category?: string;
      attempts?: number;
    },
  ) => (url: RequestInfo, init?: RequestInit) => Promise<Response>;

  onCookieUpdate: (handler: (jar: CookieJar) => void) => void;
}

export interface FetchConfigurationOptions {
  cookieJar?: CookieJar;
  proxy?: string | URL;
  userAgent?: string;
}

interface EndpointHealthCheck {
  endpoint: string;
  isOk: boolean;
}
