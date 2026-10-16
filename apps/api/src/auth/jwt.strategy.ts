import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators';
import { SUPER_ADMIN_ROLE } from '../common/permissions.constants';
import { resolveEffectivePermissions } from '../common/effective-permissions';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /** Runs on every request: session revocation, deactivation and permission changes take effect immediately. */
  async validate(payload: { sub: string; sid: string }): Promise<AuthUser | false> {
    const session = await this.prisma.refreshToken.findFirst({
      where: { familyId: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) return false;

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      include: {
        role: { include: { permissions: { include: { permission: { select: { code: true } } } } } },
        permissions: { include: { permission: { select: { code: true } } } },
      },
    });
    if (!user) return false;

    const rolePerms = user.role.permissions.map((rp) => rp.permission.code);
    const overrides = user.permissions.map((up) => ({ code: up.permission.code, allowed: up.allowed }));
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleName: user.role.name,
      isSuperAdmin: user.role.name === SUPER_ADMIN_ROLE,
      permissions: resolveEffectivePermissions(rolePerms, overrides),
      sessionId: payload.sid,
    };
  }
}
