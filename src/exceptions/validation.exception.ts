import { RpcException } from '@nestjs/microservices';
import { ValidationError } from '@nestjs/common';

function formatInvalidProperties(
  errors: ValidationError[],
  arr: string[] = [],
  key = '',
) {
  if (key) key += '.';

  for (let i = 0, l = errors.length; i < l; i++) {
    const propertyKey = key + errors[i].property;

    if (Array.isArray(errors[i].children) && errors[i].children.length) {
      formatInvalidProperties(errors[i].children, arr, propertyKey);
    } else {
      arr.push(propertyKey);
    }
  }

  return arr;
}

export class ValidationHttpException extends RpcException {
  constructor(errors: ValidationError[]) {
    super({
      message: 'Input validation error',
      code: 'INPUT_VALIDATION_FAILED',
      invalidProperties: formatInvalidProperties(errors),
    });
  }
}

export function validationExceptionFactory(errors: ValidationError[]) {
  return new ValidationHttpException(errors);
}
