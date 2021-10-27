import { EventEmitter } from 'events';
import { CookieJar } from 'tough-cookie';
import { ApiInterfaces, RpcInterfaces } from 'eosjs';
import {
  AntiCaptcha,
  RecaptchaV2TaskProxylessResult,
} from '@providers/anticaptcha';
import { FetchFunction } from '@utils/custom-fetch';
import { gen2fa } from '@utils/totp';
import { WaxWebError } from '../exceptions';
import { WaxOptions, WaxLoginDetails } from '../interfaces';

const DEFAULT_RECAPTCHA_WEBSITE_KEY =
  '6LdaB7UUAAAAAD2w3lLYRQJqsoup5BsYXI2ZIpFF';
const SIGN_CAPTCHA_BYPASS_INFO = {
  /**
   * В течение какого периода решать капчу после того как получили ошибку
   */
  interval: 3600000, // 1 час
  /**
   * Unix время, пока нам необходимо решать капчу
   */
  solveUntil: 0,
};

export class WaxWallet extends EventEmitter {
  readonly #fetch: FetchFunction;
  /**
   * Unix время последней попытки авторизации в миллисекундах
   */
  #lastLoginAttemptTime?: number;
  /**
   * Данные для автоматической повторной авторизации
   */
  #autoReLoginDetails?: AutoReLoginDetails;
  /**
   * Функция для остановки процесса AutoReLogin если он уже запущен
   */
  #autoReLoginStopHook?: () => void;

  readonly anticaptcha: AntiCaptcha;
  readonly recaptchaWebsiteKey?: string;

  userAccount?: string;
  pubKeys?: string[];
  accessToken?: string;

  #handleSessionExpire = () => {
    if (this.accessToken) {
      process.nextTick(this.emit.bind(this), 'loggedOut');
    }

    this.userAccount = null;
    this.pubKeys = null;
    this.accessToken = null;

    const autoReLoginDetails = this.#autoReLoginDetails;

    // Если функция AutoReLogin отключена или авторизация уже в процессе, пропускаем
    if (!autoReLoginDetails || this.#autoReLoginStopHook) return;

    let stopped: boolean, timeoutId: NodeJS.Timeout;

    this.#autoReLoginStopHook = () => {
      stopped = true;

      clearTimeout(timeoutId);

      // Также после остановки бота удаляем и саму функцию остановки
      this.#autoReLoginStopHook = null;
    };

    let currentAttempt = 0;

    prehook.call(this);

    function prehook(this: WaxWallet, prevAttemptError?: Error): void {
      const details: {
        currentAttempt: number;
        lastLoginAttemptTime: number;
        prevAttemptError?: Error;
      } = {
        currentAttempt: ++currentAttempt,
        lastLoginAttemptTime: this.#lastLoginAttemptTime,
      };

      if (prevAttemptError) {
        details.prevAttemptError = prevAttemptError;
      }

      toPromise<number | boolean>(autoReLoginDetails.prehook, details).then(
        (timeout) => {
          if (stopped) return;

          if (timeout === false) {
            return disable.call(this);
          }

          if (timeout === true) {
            timeout = 0;
          } else if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
            return disable.call(this, new Error('Invalid value returned'));
          }

          clearTimeout(timeoutId);
          timeoutId = setTimeout(login.bind(this), timeout);
        },
        (err) => {
          if (stopped) return;

          disable.call(this, err);
        },
      );

      function disable(this: WaxWallet, err?: Error): void {
        // Не проверяем существование метода т.к проверили до вызова этой функции
        this.#autoReLoginStopHook();
        this.#autoReLoginDetails = null;

        process.nextTick(this.emit.bind(this), 'autoReLoginDisabled', err);
      }
    }

    function login(this: WaxWallet): void {
      this.#lastLoginAttemptTime = Date.now();

      processLogin
        .call(this, this.#fetch, {
          username: autoReLoginDetails.username,
          password: autoReLoginDetails.password,
          totpSecret: autoReLoginDetails.totpSecret,
        })
        .then(
          () => {
            if (stopped) return;

            this.#autoReLoginStopHook();
          },
          (err) => {
            if (stopped) return;

            prehook.call(this, err);
          },
        );
    }

    function toPromise<T = any>(
      func: (...args: any[]) => any,
      ...args: any[]
    ): Promise<T> {
      try {
        return Promise.resolve(func(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    }
  };

  constructor(
    fetch: FetchFunction,
    options: WaxOptions['waxManagedAccountOptions'],
  ) {
    super();

    if (!options.anticaptcha) {
      throw new Error('No anticaptcha instance specified');
    }

    this.#fetch = fetch;

    this.anticaptcha = options.anticaptcha;
    this.recaptchaWebsiteKey =
      options.recaptchaWebsiteKey || DEFAULT_RECAPTCHA_WEBSITE_KEY;

    // Отправляем евент когда куки будут обновляться
    fetch.onCookieUpdate(this.emit.bind(this, 'cookieUpdate'));
  }

  /**
   * Авторизация учетной записи
   */
  async login(details: WaxLoginDetails): Promise<void> {
    details = { ...details };

    const autoReLoginDetails = formatAutoReLoginDetails(details);
    this.#autoReLoginDetails = null;

    if (this.#autoReLoginStopHook) {
      this.#autoReLoginStopHook();
    }

    this.#lastLoginAttemptTime = Date.now();

    await processLogin.call(this, this.#fetch, details);

    this.#autoReLoginDetails = autoReLoginDetails;

    function formatAutoReLoginDetails(
      details: WaxLoginDetails,
    ): AutoReLoginDetails {
      if (details.autoReLogin == null) {
        return null;
      } else if (typeof details.autoReLogin !== 'function') {
        throw new Error('Property autoReLogin must be a function');
      }

      if (!details.username || !details.password) {
        throw new Error('AutoReLogin requires account credentials');
      }

      return {
        prehook: details.autoReLogin,
        username: details.username,
        password: details.password,
        totpSecret: details.totpSecret || null,
      };
    }
  }

  /**
   * Экспорт сессионных данных. Могут использоваться для возобновления сессии
   */
  async exportSession(): Promise<WaxLoginDetails['session']> {
    const serialized = this.#fetch.getCookieJar().serializeSync();

    let hasSessionCookie: boolean;

    for (let i = 0, l = serialized.cookies.length; i < l; i++) {
      const key = serialized.cookies[i].key;

      // Проверяем чтобы были куки сессии
      if (key === 'session_token') {
        hasSessionCookie = true;
      }
    }

    if (!hasSessionCookie) {
      throw new WaxWebError('No session to export', 'EXPORT_NO_SESSION');
    }

    return {
      jar: serialized,
    };
  }

  /**
   * Проверка авторизации, а также обновления данных авторизации
   */
  async loggedIn(): Promise<boolean> {
    const sessionResponse = await this.#fetch(
      'https://all-access.wax.io/api/session',
      {
        method: 'GET',
        headers: {
          Referer: 'https://all-access.wax.io/cloud-wallet/login/',
        },
      },
    );

    if (!sessionResponse.ok) {
      this.#handleSessionExpire();

      return false;
    }

    const sessionBody = await sessionResponse.json();

    if (!sessionBody.user_id || !sessionBody.token) {
      this.#handleSessionExpire();

      return false;
    }

    const accountResponse = await this.#fetch(
      'https://public-wax-on.wax.io/wam/users',
      {
        method: 'GET',
        headers: {
          Referer: 'https://all-access.wax.io/',
          'X-Access-Token': sessionBody.token,
        },
      },
    );

    if (!accountResponse.ok) {
      this.#handleSessionExpire();

      return false;
    }

    const accountBody = await accountResponse.json();

    if (!accountBody.accountName || !Array.isArray(accountBody.publicKeys)) {
      this.#handleSessionExpire();

      return false;
    }

    if (!this.accessToken) {
      process.nextTick(this.emit.bind(this), 'loggedIn');
    }

    this.userAccount = accountBody.accountName;
    this.pubKeys = accountBody.publicKeys;
    this.accessToken = sessionBody.token;

    return true;
  }

  /**
   * Возвращает публичные ключи от учетной записи
   */
  async getAvailableKeys(): Promise<string[]> {
    if (!this.pubKeys) {
      throw new WaxWebError('Not logged in', 'NOT_LOGGED_IN');
    }

    return this.pubKeys;
  }

  /**
   * Подпись транзакции
   */
  async signTransaction(
    args: ApiInterfaces.SignatureProviderArgs & { website: string },
  ): Promise<RpcInterfaces.PushTransactionArgs> {
    if (!this.accessToken) {
      throw new WaxWebError('Not logged in', 'NOT_LOGGED_IN');
    }

    const accessToken = this.accessToken;

    let signatures: string[];
    let recaptcha: RecaptchaV2TaskProxylessResult;

    if (SIGN_CAPTCHA_BYPASS_INFO.solveUntil > Date.now()) {
      recaptcha = await solveCaptcha.call(this, 'https://all-access.wax.io/');
    }

    try {
      signatures = await getSignatures.call(this, recaptcha);
    } catch (e) {
      if (
        e instanceof WaxWebError &&
        e.code === 'INCORRECT_CAPTCHA' &&
        !recaptcha
      ) {
        signatures = await getSignatures.call(
          this,
          await solveCaptcha.call(this, 'https://all-access.wax.io/'),
        );
      } else {
        throw e;
      }
    }

    return {
      signatures,
      serializedTransaction: args.serializedTransaction,
    };

    async function getSignatures(
      this: WaxWallet,
      recaptcha?: RecaptchaV2TaskProxylessResult,
    ): Promise<string[]> {
      const response = await this.#fetch(
        'https://public-wax-on.wax.io/wam/sign',
        {
          method: 'POST',
          body: JSON.stringify({
            'g-recaptcha-response': recaptcha
              ? recaptcha.gRecaptchaResponse
              : undefined,
            serializedTransaction: Object.values(args.serializedTransaction),
            website: args.website || 'wax.bloks.io',
            description: 'jwt is insecure',
          }),
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            Referer: 'https://all-access.wax.io/',
            'X-Access-Token': accessToken,
          },
        },
      );
      const body = await response.json();

      if (body.error) {
        if (/Session Token is invalid or missing/i.test(body.message)) {
          this.#handleSessionExpire();

          throw new WaxWebError('Not logged in', 'NOT_LOGGED_IN');
        }

        if (/Recaptcha token is invalid/i.test(body.message)) {
          SIGN_CAPTCHA_BYPASS_INFO.solveUntil =
            Date.now() + SIGN_CAPTCHA_BYPASS_INFO.interval;

          if (recaptcha) {
            try {
              await this.anticaptcha.reportIncorrectRecaptcha(recaptcha.taskId);
            } catch (e) {
              // ignore
            }
          }

          throw new WaxWebError(
            'Incorrect captcha response',
            'INCORRECT_CAPTCHA',
          );
        }

        throw new WaxWebError(
          `${body.error}: ${body.message || 'Unknown transaction sign error'}`,
        );
      }

      // На всякий случай оставляем и обработку массива errors
      if (body.errors) {
        let errorDescriptions = 'Unknown transaction sign error';

        if (Array.isArray(body.errors)) {
          errorDescriptions = body.errors
            .map((err: any) => err && err.message)
            .join('\n');
        }

        throw new WaxWebError(errorDescriptions, 'TRANSACTION_SIGN_ERROR', {
          errors: body.errors,
        });
      }

      if (!Array.isArray(body.signatures)) {
        throw new WaxWebError(
          'Missing or invalid signatures property in response',
        );
      }

      return body.signatures;
    }
  }
}

/**
 * Обработка авторизации.
 * Вынесена в отдельную функцию так как используется сразу в нескольких местах
 */
async function processLogin(
  this: WaxWallet,
  fetch: FetchFunction,
  details: WaxLoginDetails,
): Promise<void> {
  if (details.session) {
    try {
      await restoreSession.call(this, details.session);
    } catch (e) {
      if (!(e instanceof WaxWebError) || e.code !== 'INVALID_SESSION') throw e;

      // Выбрасываем ошибку дальше, если нету данных для авторизации
      if (!details.username || !details.password) throw e;

      await login.call(this, {
        username: details.username,
        password: details.password,
        totpSecret: details.totpSecret,
      });
    }
  } else if (details.username && details.password) {
    await login.call(this, {
      username: details.username,
      password: details.password,
      totpSecret: details.totpSecret,
    });
  } else {
    throw new Error('Account credentials or session is required');
  }

  async function restoreSession(
    this: WaxWallet,
    session: WaxLoginDetails['session'],
  ): Promise<void> {
    // Импортируем куки
    fetch.setCookieJar(CookieJar.deserializeSync(session.jar));

    const loggedIn = await this.loggedIn();

    if (!loggedIn) {
      throw new WaxWebError('Invalid or expired session', 'INVALID_SESSION');
    }
  }

  async function login(
    this: WaxWallet,
    credentials: {
      username: WaxLoginDetails['username'];
      password: WaxLoginDetails['password'];
      totpSecret?: WaxLoginDetails['totpSecret'];
    },
  ): Promise<void> {
    try {
      await doLogin.call(this);
    } catch (e) {
      if (e instanceof WaxWebError && e.code === 'INCORRECT_CAPTCHA') {
        await doLogin.call(
          this,
          await solveCaptcha.call(this, 'https://all-access.wax.io/'),
        );
      } else {
        throw e;
      }
    }

    const loggedIn = await this.loggedIn();

    if (!loggedIn) {
      throw new WaxWebError('Logged in verification failed');
    }

    async function doLogin(
      this: WaxWallet,
      recaptcha?: RecaptchaV2TaskProxylessResult,
    ): Promise<void> {
      const loginResponse = await fetch(
        'https://all-access.wax.io/api/session',
        {
          method: 'POST',
          body: JSON.stringify({
            password: credentials.password,
            username: credentials.username,
            'g-recaptcha-response': recaptcha
              ? recaptcha.gRecaptchaResponse
              : undefined,
            redirectTo: '',
          }),
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            Referer: 'https://all-access.wax.io/',
          },
        },
      );
      const loginBody = await loginResponse.json();

      if (loginBody.errors) {
        let errorDescriptions = 'Unknown login error';

        if (Array.isArray(loginBody.errors)) {
          errorDescriptions = loginBody.errors
            .map((err: any) => err && err.message)
            .join('\n');
        }

        if (/Incorrect captcha/i.test(errorDescriptions)) {
          if (recaptcha) {
            try {
              await this.anticaptcha.reportIncorrectRecaptcha(recaptcha.taskId);
            } catch (e) {
              // ignore
            }
          }

          throw new WaxWebError(
            'Incorrect captcha response',
            'INCORRECT_CAPTCHA',
          );
        }

        throw new WaxWebError(errorDescriptions, 'LOGIN_ERROR', {
          errors: loginBody.errors,
        });
      }

      if (loginBody.token2fa) {
        return pass2fa.call(this, loginBody.token2fa);
      }
      if (loginBody.tandc_token) {
        return acceptTos.call(this, loginBody.tandc_token);
      }

      if (!loginBody.token) {
        throw new WaxWebError('Missing token property from response');
      }
    }

    async function pass2fa(this: WaxWallet, token2fa: string): Promise<void> {
      if (!credentials.totpSecret) {
        throw new WaxWebError('2FA required', '2FA_REQUIRED');
      }

      const twofaResponse = await fetch(
        'https://all-access.wax.io/api/session/2fa',
        {
          method: 'POST',
          body: JSON.stringify({
            code: gen2fa(credentials.totpSecret),
            token2fa,
          }),
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            Referer: `https://all-access.wax.io/2fa?token2fa=${token2fa}`,
          },
        },
      );
      const twofaBody = await twofaResponse.json();

      if (twofaBody.errors) {
        let errorDescriptions = 'Unknown 2fa commit error';

        if (Array.isArray(twofaBody.errors)) {
          errorDescriptions = twofaBody.errors
            .map((err: any) => err && err.message)
            .join('\n');
        }

        throw new WaxWebError(errorDescriptions, '2FA_COMMIT_ERROR', {
          errors: twofaBody.errors,
        });
      }

      if (twofaBody.tandc_token) {
        return acceptTos.call(this, twofaBody.tandc_token);
      }

      if (!twofaBody.token) {
        throw new WaxWebError('Missing token property from response');
      }
    }

    async function acceptTos(
      this: WaxWallet,
      tandcToken: string,
    ): Promise<void> {
      const tosFormResponse = await fetch('https://all-access.wax.io/api/tos', {
        method: 'GET',
        headers: {
          Referer: `https://all-access.wax.io/tos?token=${tandcToken}`,
        },
      });
      const tosFormBody = await tosFormResponse.json();

      if (!Number.isFinite(+tosFormBody.id)) {
        throw new WaxWebError('Malformed response');
      }

      const tosAcceptResponse = await fetch(
        'https://all-access.wax.io/api/tos',
        {
          method: 'POST',
          body: JSON.stringify({
            tos_id: tosFormBody.id,
            tos_accepted: true,
            age_accepted: true,
            singleUseToken: tandcToken,
          }),
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            Referer: `https://all-access.wax.io/tos?token=${tandcToken}`,
          },
        },
      );
      const tosAcceptBody = await tosAcceptResponse.json();

      if (tosAcceptBody.errors) {
        let errorDescriptions = 'Unknown tos accept error';

        if (Array.isArray(tosAcceptBody.errors)) {
          errorDescriptions = tosAcceptBody.errors
            .map((err: any) => err && err.message)
            .join('\n');
        }

        throw new WaxWebError(errorDescriptions, 'TOS_ACCEPT_ERROR', {
          errors: tosAcceptBody.errors,
        });
      }

      if (!tosAcceptBody.token) {
        throw new WaxWebError('Missing token property from response');
      }
    }
  }
}

async function solveCaptcha(
  this: WaxWallet,
  websiteURL: string,
): Promise<RecaptchaV2TaskProxylessResult> {
  let recaptcha: RecaptchaV2TaskProxylessResult;

  // Даем 3 попытки на решение капчи
  for (let i = 2; i >= 0; i--) {
    try {
      recaptcha = await this.anticaptcha.recaptchaV2TaskProxyless({
        websiteURL,
        websiteKey: this.recaptchaWebsiteKey,
      });
    } catch (e) {
      if (i) continue;

      throw e;
    }

    break;
  }

  return recaptcha;
}

interface AutoReLoginDetails {
  prehook: WaxLoginDetails['autoReLogin'];
  username: string;
  password: string;
  totpSecret?: string;
}
