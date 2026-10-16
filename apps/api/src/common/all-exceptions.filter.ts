import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const DEFAULT: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'طلب غير صالح' },
  401: { code: 'UNAUTHORIZED', message: 'يجب تسجيل الدخول' },
  403: { code: 'FORBIDDEN', message: 'غير مسموح لك بتنفيذ هذه العملية' },
  404: { code: 'NOT_FOUND', message: 'العنصر غير موجود' },
  409: { code: 'CONFLICT', message: 'تعارض مع بيانات موجودة' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'محاولات كثيرة، حاول لاحقاً' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'خطأ داخلي في الخادم';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { code?: string; message?: string | string[]; details?: unknown };
      const d = DEFAULT[status] ?? { code: 'ERROR', message };
      if (typeof body === 'object' && body !== null) {
        if (Array.isArray(body.message)) {
          code = 'VALIDATION_ERROR';
          message = 'بيانات غير صالحة';
          details = body.message;
        } else {
          code = body.code ?? d.code;
          message = body.message && body.code ? body.message : d.message;
          details = body.details;
        }
      } else {
        code = d.code;
        message = d.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      status = 409;
      code = 'CONFLICT';
      message = 'القيمة موجودة مسبقاً';
      details = exception.meta?.target;
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json({ success: false, data: null, message, code, ...(details ? { details } : {}) });
  }
}
