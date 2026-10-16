import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { ReqCtx } from '../common/decorators';
import { hashPassword, verifyPassword } from '../common/password';
import { newOpaqueToken, sha256 } from '../common/tokens';
import { ChangePasswordDto, DeviceDto, LoginDto } from './auth.dto';
import { PasswordResetNotifier } from './password-reset.notifier';
import { AppVersionService } from '../app-version/app-version.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
    private notifier: PasswordResetNotifier,
    private appVersion: AppVersionService,
  ) {}

  private refreshExpiry(): Date {
    const days = Number(this.config.get('REFRESH_TTL_DAYS') ?? 30);
    return new Date(Date.now() + days * 86_400_000);
  }

  private signAccess(userId: string, sessionId: string): string {
    return this.jwt.sign({ sub: userId, sid: sessionId });
  }

  private async issueTokens(userId: string, ctx: ReqCtx, deviceRefId: string | null, familyId = randomUUID()) {
    const refreshToken = newOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId, familyId, deviceRefId,
        tokenHash: sha256(refreshToken),
        expiresAt: this.refreshExpiry(),
        ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null,
      },
    });
    return { accessToken: this.signAccess(userId, familyId), refreshToken, tokenType: 'Bearer' };
  }

  private async upsertDevice(userId: string, d: DeviceDto) {
    const existing = await this.prisma.userDevice.findUnique({ where: { userId_deviceId: { userId, deviceId: d.deviceId } } });
    if (existing && !existing.isActive) throw new AppException('DEVICE_BLOCKED', 'هذا الجهاز موقوف من الإدارة', 403);
    return this.prisma.userDevice.upsert({
      where: { userId_deviceId: { userId, deviceId: d.deviceId } },
      update: { platform: d.platform, model: d.model, appVersion: d.appVersion, buildNumber: d.buildNumber, pushToken: d.pushToken, lastSeenAt: new Date() },
      create: { userId, deviceId: d.deviceId, platform: d.platform, model: d.model, appVersion: d.appVersion, buildNumber: d.buildNumber, pushToken: d.pushToken },
    });
  }

  async login(dto: LoginDto, ctx: ReqCtx) {
    await this.appVersion.assertSupported(ctx.platform ?? dto.device?.platform, ctx.appVersion ?? dto.device?.appVersion);
    const user = await this.prisma.user.findFirst({
      where: { deletedAt: null, OR: [{ username: dto.identifier }, { phone: dto.identifier }, { email: dto.identifier }] },
      include: { role: { select: { name: true } } },
    });

    if (!user) {
      // Equalise timing so unknown users are not distinguishable from wrong passwords.
      this.dummyHash ??= hashPassword('dummy-password-for-timing');
      await verifyPassword(await this.dummyHash, dto.password);
      await this.audit.log({ action: 'auth.login_failed', entity: 'user', newValues: { identifier: dto.identifier, reason: 'unknown' }, ctx });
      throw new AppException('INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة', 401);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppException('ACCOUNT_LOCKED', 'الحساب مقفل مؤقتاً بسبب محاولات فاشلة، حاول لاحقاً', 429);
    }

    const ok = await verifyPassword(user.passwordHash, dto.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await this.audit.log({ userId: user.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', entity: 'user', entityId: user.id, ctx });
      throw new AppException('INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة', 401);
    }

    if (!user.isActive) throw new AppException('ACCOUNT_DISABLED', 'الحساب غير مفعّل', 403);

    const device = dto.device ? await this.upsertDevice(user.id, dto.device) : null;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.issueTokens(user.id, ctx, device?.id ?? null);
    await this.audit.log({ userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ctx });

    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword,
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role.name },
    };
  }

  /** Refresh-token rotation with reuse detection: replaying a rotated token revokes the whole session family. */
  async refresh(refreshToken: string, ctx: ReqCtx) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) throw new AppException('INVALID_REFRESH_TOKEN', 'جلسة غير صالحة', 401);

    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: row.userId, action: 'auth.refresh_reuse_detected', entity: 'session', entityId: row.familyId, ctx });
      throw new AppException('INVALID_REFRESH_TOKEN', 'جلسة غير صالحة', 401);
    }
    if (row.expiresAt <= new Date()) throw new AppException('INVALID_REFRESH_TOKEN', 'انتهت الجلسة', 401);

    const user = await this.prisma.user.findFirst({ where: { id: row.userId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!user) throw new AppException('INVALID_REFRESH_TOKEN', 'جلسة غير صالحة', 401);

    const next = newOpaqueToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update guards against two concurrent refreshes with the same token.
      const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (claimed.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          userId: row.userId, familyId: row.familyId, deviceRefId: row.deviceRefId,
          tokenHash: sha256(next), expiresAt: this.refreshExpiry(), ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        },
      });
      if (row.deviceRefId) await tx.userDevice.update({ where: { id: row.deviceRefId }, data: { lastSeenAt: new Date() } });
      return true;
    });
    if (!rotated) throw new AppException('INVALID_REFRESH_TOKEN', 'جلسة غير صالحة', 401);

    return { accessToken: this.signAccess(row.userId, row.familyId), refreshToken: next, tokenType: 'Bearer' };
  }

  async logout(userId: string, sessionId: string, ctx: ReqCtx) {
    await this.prisma.refreshToken.updateMany({ where: { familyId: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ userId, action: 'auth.logout', entity: 'session', entityId: sessionId, ctx });
  }

  async logoutAll(userId: string, ctx: ReqCtx) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ userId, action: 'auth.logout_all', entity: 'user', entityId: userId, ctx });
  }

  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto, ctx: ReqCtx) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new AppException('INVALID_CREDENTIALS', 'كلمة المرور الحالية غير صحيحة', 400);
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new AppException('PASSWORD_REUSE', 'كلمة المرور الجديدة يجب أن تختلف عن الحالية', 400);
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
      // Every other session is signed out; the current one stays.
      this.prisma.refreshToken.updateMany({ where: { userId, familyId: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId, action: 'auth.password_changed', entity: 'user', entityId: userId, ctx });
  }

  async forgotPassword(identifier: string, ctx: ReqCtx) {
    const user = await this.prisma.user.findFirst({
      where: { isActive: true, deletedAt: null, OR: [{ username: identifier }, { phone: identifier }, { email: identifier }] },
      select: { id: true },
    });
    if (user) {
      const token = newOpaqueToken(32);
      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) },
      });
      this.notifier.send(user.id, token);
      await this.audit.log({ userId: user.id, action: 'auth.password_reset_requested', entity: 'user', entityId: user.id, ctx });
    }
    // Same response whether or not the account exists.
  }

  async resetPassword(token: string, newPassword: string, ctx: ReqCtx) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw new AppException('INVALID_RESET_TOKEN', 'رابط الاستعادة غير صالح أو منتهي', 400);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new AppException('INVALID_RESET_TOKEN', 'رابط الاستعادة غير صالح أو منتهي', 400);
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.audit.log({ userId: row.userId, action: 'auth.password_reset_completed', entity: 'user', entityId: row.userId, ctx });
  }
}
