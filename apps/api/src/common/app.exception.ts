import { HttpException } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(public readonly code: string, message: string, status = 400, public readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}
