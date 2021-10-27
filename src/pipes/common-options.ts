import { ValidationPipeOptions } from '@nestjs/common';
import { validationExceptionFactory } from '../exceptions/validation.exception';

export const commonPipeOptions: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  forbidUnknownValues: true,
  exceptionFactory: validationExceptionFactory,
  dismissDefaultMessages: true,
  validationError: {
    target: false,
    value: false,
  },
};
