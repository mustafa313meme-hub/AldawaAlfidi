import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** All listed permissions are required. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  roleName: string;
  isSuperAdmin: boolean;
  permissions: string[];
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user);

export interface ReqCtx {
  ip: string | null;
  device: string | null;
  userAgent: string | null;
  appVersion?: string | null;
  platform?: string | null;
}

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): ReqCtx => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const dev = req.headers['x-device-id'];
  return {
    ip: req.ip ?? null,
    device: typeof dev === 'string' ? dev.slice(0, 100) : null,
    userAgent: (req.headers['user-agent'] ?? null) as string | null,
    appVersion: typeof req.headers['x-app-version'] === 'string' ? req.headers['x-app-version'].slice(0, 30) : null,
    platform: typeof req.headers['x-platform'] === 'string' ? req.headers['x-platform'].toLowerCase().slice(0, 20) : null,
  };
});
