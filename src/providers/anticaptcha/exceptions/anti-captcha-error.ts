export class AntiCaptchaError extends Error {
  code?: string;
  [k: string]: any;

  constructor(message?: string, code?: string, attrs?: object) {
    super(message);

    if (typeof code === 'string' && code) {
      this.code = code;
    }

    for (const k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      if (k === 'name' || k === 'message' || k === 'code') continue;

      this[k] = attrs[k];
    }
  }
}

Object.defineProperty(AntiCaptchaError.prototype, 'name', {
  configurable: true,
  enumerable: false,
  value: 'AntiCaptchaError',
  writable: true,
});
