import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, IS_PUBLIC, PERMISSIONS_KEY } from './decorators';
import { AppException } from './app.exception';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    if (!required || required.length === 0) return true; // authenticated-only route
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new AppException('UNAUTHORIZED', 'يجب تسجيل الدخول', 401);
    if (user.isSuperAdmin) return true;
    if (required.every((p) => user.permissions.includes(p))) return true;
    throw new AppException('FORBIDDEN', 'غير مسموح لك بتنفيذ هذه العملية', 403);
  }
}
