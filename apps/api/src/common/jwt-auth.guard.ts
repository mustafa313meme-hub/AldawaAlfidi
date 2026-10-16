import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from './decorators';
import { AppException } from './app.exception';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    return isPublic ? true : super.canActivate(context);
  }
  handleRequest<T>(err: unknown, user: T | false): T {
    if (err || !user) throw new AppException('UNAUTHORIZED', 'يجب تسجيل الدخول', 401);
    return user;
  }
}
