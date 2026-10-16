import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { hashPassword } from '../common/password';
import { Paginated } from '../common/response';
import { skipTake } from '../common/pagination';
import { SUPER_ADMIN_ROLE } from '../common/permissions.constants';
import { CreateUserDto, SetOverridesDto, UpdateUserDto, UsersQuery } from './users.dto';

const PUBLIC = {
  id: true, username: true, fullName: true, phone: true, email: true, isActive: true, mustChangePassword: true,
  lastLoginAt: true, createdAt: true, updatedAt: true, role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

type Tx = Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async list(q: UsersQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      roleId: q.roleId,
      isActive: q.isActive,
      ...(q.q ? { OR: [
        { username: { contains: q.q, mode: 'insensitive' } },
        { fullName: { contains: q.q, mode: 'insensitive' } },
        { phone: { contains: q.q } },
        { email: { contains: q.q, mode: 'insensitive' } },
      ] } : {}),
    };
    const sortable = ['createdAt', 'fullName', 'username', 'lastLoginAt'];
    const sort = q.sort && sortable.includes(q.sort) ? q.sort : 'createdAt';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: PUBLIC, orderBy: { [sort]: q.order }, ...skipTake(q) }),
      this.prisma.user.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: {
      ...PUBLIC,
      permissions: { select: { allowed: true, permission: { select: { code: true } } } },
    } });
    if (!u) throw new AppException('NOT_FOUND', 'المستخدم غير موجود', 404);
    return { ...u, permissions: undefined, permissionOverrides: u.permissions.map((p) => ({ code: p.permission.code, allowed: p.allowed })) };
  }

  private async load(id: string, tx: Tx = this.prisma) {
    const u = await tx.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
    if (!u) throw new AppException('NOT_FOUND', 'المستخدم غير موجود', 404);
    return u;
  }

  private assertTouchSuperAdmin(actor: AuthUser, roleName: string) {
    if (roleName === SUPER_ADMIN_ROLE && !actor.isSuperAdmin) {
      throw new AppException('FORBIDDEN', 'فقط Super Admin يستطيع التعامل مع هذا الحساب/الدور', 403);
    }
  }

  /** Called inside a transaction so two concurrent demotions cannot both succeed. */
  private async assertAnotherSuperAdmin(tx: Tx, excludeUserId: string) {
    const others = await tx.user.count({
      where: { id: { not: excludeUserId }, isActive: true, deletedAt: null, role: { name: SUPER_ADMIN_ROLE } },
    });
    if (others === 0) throw new AppException('LAST_SUPER_ADMIN', 'لا يمكن إزالة آخر Super Admin فعّال', 400);
  }

  async create(dto: CreateUserDto, actor: AuthUser, ctx: ReqCtx) {
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new AppException('ROLE_NOT_FOUND', 'الدور غير موجود', 404);
    this.assertTouchSuperAdmin(actor, role.name);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username, fullName: dto.fullName, phone: dto.phone, email: dto.email,
        roleId: dto.roleId, passwordHash: await hashPassword(dto.password), mustChangePassword: true,
      },
      select: PUBLIC,
    });
    await this.audit.log({ userId: actor.id, action: 'users.create', entity: 'user', entityId: user.id, newValues: user, ctx });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, ctx: ReqCtx) {
    if (dto.isActive === false && id === actor.id) throw new AppException('SELF_DEACTIVATE', 'لا يمكنك تعطيل حسابك', 400);

    return this.prisma.$transaction(async (tx) => {
      const before = await this.load(id, tx);
      this.assertTouchSuperAdmin(actor, before.role.name);

      let newRoleName = before.role.name;
      if (dto.roleId && dto.roleId !== before.roleId) {
        const role = await tx.role.findUnique({ where: { id: dto.roleId } });
        if (!role) throw new AppException('ROLE_NOT_FOUND', 'الدور غير موجود', 404);
        this.assertTouchSuperAdmin(actor, role.name);
        newRoleName = role.name;
      }
      const losesSuper = before.role.name === SUPER_ADMIN_ROLE && (newRoleName !== SUPER_ADMIN_ROLE || dto.isActive === false);
      if (losesSuper) await this.assertAnotherSuperAdmin(tx, id);

      const after = await tx.user.update({
        where: { id },
        data: { fullName: dto.fullName, phone: dto.phone, email: dto.email, roleId: dto.roleId, isActive: dto.isActive },
        select: PUBLIC,
      });
      if (dto.isActive === false) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const { passwordHash: _p, ...beforePublic } = before;
      await this.audit.log({
        userId: actor.id, action: dto.isActive === false ? 'users.deactivate' : 'users.update',
        entity: 'user', entityId: id, oldValues: beforePublic, newValues: after, ctx,
      }, tx);
      return after;
    });
  }

  async resetPasswordByAdmin(id: string, newPassword: string, actor: AuthUser, ctx: ReqCtx) {
    const u = await this.load(id);
    this.assertTouchSuperAdmin(actor, u.role.name);
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ userId: actor.id, action: 'users.reset_password', entity: 'user', entityId: id, ctx });
  }

  /** Soft delete: the row stays (financial history references users) and all sessions end. */
  async remove(id: string, actor: AuthUser, ctx: ReqCtx) {
    if (id === actor.id) throw new AppException('SELF_DELETE', 'لا يمكنك حذف حسابك', 400);
    await this.prisma.$transaction(async (tx) => {
      const u = await this.load(id, tx);
      this.assertTouchSuperAdmin(actor, u.role.name);
      if (u.role.name === SUPER_ADMIN_ROLE) await this.assertAnotherSuperAdmin(tx, id);
      await tx.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: actor.id, action: 'users.delete', entity: 'user', entityId: id, oldValues: { username: u.username, fullName: u.fullName }, ctx }, tx);
    });
  }

  async setOverrides(id: string, dto: SetOverridesDto, actor: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const u = await this.load(id, tx);
      this.assertTouchSuperAdmin(actor, u.role.name);
      const codes = [...new Set(dto.overrides.map((o) => o.code))];
      const perms = await tx.permission.findMany({ where: { code: { in: codes } } });
      if (perms.length !== codes.length) {
        const known = new Set(perms.map((p) => p.code));
        throw new AppException('UNKNOWN_PERMISSION', 'صلاحية غير معروفة', 400, codes.filter((c) => !known.has(c)));
      }
      const byCode = new Map(perms.map((p) => [p.code, p.id]));
      const old = await tx.userPermission.findMany({ where: { userId: id }, select: { allowed: true, permission: { select: { code: true } } } });
      await tx.userPermission.deleteMany({ where: { userId: id } });
      const unique = new Map(dto.overrides.map((o) => [o.code, o.allowed]));
      await tx.userPermission.createMany({ data: [...unique].map(([code, allowed]) => ({ userId: id, permissionId: byCode.get(code)!, allowed })) });
      const next = [...unique].map(([code, allowed]) => ({ code, allowed }));
      await this.audit.log({
        userId: actor.id, action: 'permissions.user_overrides_changed', entity: 'user', entityId: id,
        oldValues: old.map((o) => ({ code: o.permission.code, allowed: o.allowed })), newValues: next, ctx,
      }, tx);
      return next;
    });
  }

  async listDevices(userId: string) {
    await this.load(userId);
    return this.prisma.userDevice.findMany({
      where: { userId }, orderBy: { lastSeenAt: 'desc' },
      select: { id: true, deviceId: true, platform: true, model: true, appVersion: true, isActive: true, lastSeenAt: true, createdAt: true },
    });
  }

  /** Blocks the device and ends its sessions; re-enable with setDeviceActive(true). */
  async setDeviceActive(userId: string, deviceRefId: string, active: boolean, actor: AuthUser, ctx: ReqCtx) {
    const d = await this.prisma.userDevice.findFirst({ where: { id: deviceRefId, userId } });
    if (!d) throw new AppException('NOT_FOUND', 'الجهاز غير موجود', 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.userDevice.update({ where: { id: d.id }, data: { isActive: active } });
      if (!active) await tx.refreshToken.updateMany({ where: { deviceRefId: d.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({
        userId: actor.id, action: active ? 'devices.activate' : 'devices.revoke', entity: 'device', entityId: d.id,
        oldValues: { isActive: d.isActive }, newValues: { isActive: active, userId, deviceId: d.deviceId }, ctx,
      }, tx);
    });
  }
}
