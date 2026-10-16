import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

export class Paginated<T> {
  constructor(public items: T[], public meta: PageMeta) {}
}

export class Message {
  constructor(public message: string) {}
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((v) => {
        if (v instanceof Paginated) return { success: true, data: v.items, message: null, meta: v.meta };
        if (v instanceof Message) return { success: true, data: null, message: v.message, meta: null };
        return { success: true, data: v ?? null, message: null, meta: null };
      }),
    );
  }
}
