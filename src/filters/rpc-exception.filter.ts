import { Catch, RpcExceptionFilter as ExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { RpcException } from '@nestjs/microservices';

@Catch()
export class RpcExceptionFilter<T extends Error> implements ExceptionFilter<T> {
  catch(exception: T): Observable<any> {
    if (exception instanceof RpcException) {
      return throwError(() => exception.getError());
    }

    return throwError(() => ({
      name: exception.name,
      message: exception.message,
    }));
  }
}
