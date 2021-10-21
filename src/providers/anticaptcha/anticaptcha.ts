import fetch from 'node-fetch';
import { AntiCaptchaError } from './exceptions';

const SOFT_ID = 966;
const BASE_URL = 'https://api.anti-captcha.com';

export class AntiCaptcha {
  apiKey: string;

  firstAttemptWaitingInterval = 5000;
  normalWaitingInterval = 2500;

  waitingErrorIgnoreCount = 5;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createTask(options: CreateTaskOptions): Promise<number> {
    const response = await fetch(`${BASE_URL}/createTask`, {
      method: 'POST',
      body: JSON.stringify({
        ...options,
        clientKey: this.apiKey,
        softId: SOFT_ID,
      }),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const body = await response.json();

    checkForError(body);

    return body.taskId;
  }

  async getTaskResult(taskId: string | number): Promise<GetTaskResult> {
    const response = await fetch(`${BASE_URL}/getTaskResult`, {
      method: 'POST',
      body: JSON.stringify({
        taskId,
        clientKey: this.apiKey,
      }),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const body = await response.json();

    checkForError(body);

    return {
      status: body.status,
      solution: body.solution || null,
      cost: body.cost,
      ip: body.ip,
      createTime: body.createTime,
      endTime: body.endTime || null,
      solveCount: body.solveCount,
    };
  }

  async reportIncorrectRecaptcha(taskId: string | number): Promise<void> {
    const response = await fetch(`${BASE_URL}/reportIncorrectRecaptcha`, {
      method: 'POST',
      body: JSON.stringify({
        taskId,
        clientKey: this.apiKey,
      }),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const body = await response.json();

    checkForError(body);
  }

  async waitForResult(taskId: string | number): Promise<GetTaskResult> {
    let errorLeftCount = validateNum(this.waitingErrorIgnoreCount, {
      defaultValue: 5,
      min: 0,
    });

    while (true) {
      let result: GetTaskResult;

      try {
        result = await this.getTaskResult(taskId);
      } catch (e) {
        if (e instanceof AntiCaptchaError && e.code === 'ERROR_NO_SUCH_CAPCHA_ID') throw e;

        if (--errorLeftCount >= 0) {
          await this.waitFor(
            validateNum(this.normalWaitingInterval, {
              defaultValue: 2500,
              min: 0,
            }),
          );

          continue;
        }

        throw e;
      }

      if (result.status === 'ready') {
        return result;
      }

      await this.waitFor(
        validateNum(this.normalWaitingInterval, {
          defaultValue: 2500,
          min: 0,
        }),
      );
    }
  }

  async recaptchaV2TaskProxyless(
    details: RecaptchaV2TaskProxylessDetails,
  ): Promise<RecaptchaV2TaskProxylessResult> {
    const taskId = await this.createTask({
      task: {
        ...details,
        type: 'RecaptchaV2TaskProxyless',
      },
    });

    await this.waitFor(
      validateNum(this.firstAttemptWaitingInterval, {
        defaultValue: 5000,
        min: 0,
      }),
    );

    const result = await this.waitForResult(taskId);

    return {
      ...result.solution,
      taskId,
    };
  }

  waitFor(timeout: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }
}

function validateNum(
  value: number,
  options?: {
    defaultValue?: number;
    min?: number;
    max?: number;
  },
): number {
  options = { ...options };

  if (!Number.isFinite(value)) {
    if (typeof options.defaultValue === 'undefined') {
      throw new Error('Value is not a number, and no default value specified');
    }

    return options.defaultValue;
  }

  if (options.min != null && value < options.min) {
    return options.min;
  }
  if (options.max != null && value > options.max) {
    return options.max;
  }

  return value;
}

function checkForError(body: any): void {
  if (body.errorId == 0) return;

  throw new AntiCaptchaError(body.errorDescription || 'Unknown error', body.errorCode);
}

export interface CreateTaskOptions {
  task: any;
  languagePool?: 'en' | 'rn';
  callbackUrl?: string;
}

export interface GetTaskResult {
  status: 'processing' | 'ready';
  solution?: any;
  cost?: string;
  ip?: string;
  createTime?: number;
  endTime?: number;
  solveCount?: number;
}

export interface RecaptchaV2TaskProxylessDetails {
  websiteURL: string;
  websiteKey: string;
  websiteSToken?: string;
  recaptchaDataSValue?: string;
  isInvisible?: boolean;
}

export interface RecaptchaV2TaskProxylessResult {
  taskId: number;
  gRecaptchaResponse: string;
}
