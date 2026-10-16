import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { SUPER_ADMIN_ROLE } from '../common/permissions.constants';

class CreateRoleDto {
  @Matches(/^[a-z][a-z0-9_]{2,40}$/) name!: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) permissionCodes!: string[];
}
class SetRolePermissionsDto {
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) permissionCodes!: string[];
}

@Controller()
export class RolesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('roles') @RequirePermissions('roles.view')
  async roles() {
    const rows = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { select: { permission: { select: { code: true } } } }, _count: { select: { users: true } } },
    });
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, usersCount: r._count.users,
      permissions: r.permissions.map((p) => p.permission.code).sort(),
    }));
  }

  @Get('permissions') @RequirePermissions('roles.view')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { code: 'asc' }] });
  }

  private async resolveCodes(codes: string[]) {
    const unique = [...new Set(codes)];
    const perms = await this.prisma.permission.findMany({ where: { code: { in: unique } } });
    if (perms.length !== unique.length) {
      const known = new Set(perms.map((p) => p.code));
      throw new AppException('UNKNOWN_PERMISSION', 'صلاحية غير معروفة', 400, unique.filter((c) => !known.has(c)));
    }
    return perms;
  }

  @Post('roles') @RequirePermissions('roles.manage')
  async create(@Body() dto: CreateRoleDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    if (dto.name === SUPER_ADMIN_ROLE) throw new AppException('RESERVED', 'اسم محجوز', 400);
    const perms = await this.resolveCodes(dto.permissionCodes);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { name: dto.name, description: dto.description, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
      });
      await this.audit.log({ userId: u.id, action: 'roles.create', entity: 'role', entityId: role.id, newValues: { name: role.name, permissions: dto.permissionCodes }, ctx }, tx);
      return { id: role.id, name: role.name };
    });
  }

  @Put('roles/:id/permissions') @RequirePermissions('roles.manage')
  async setPermissions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolePermissionsDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const perms = await this.resolveCodes(dto.permissionCodes);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { permissions: { select: { permission: { select: { code: true } } } } } });
      if (!role) throw new AppException('NOT_FOUND', 'الدور غير موجود', 404);
      if (role.name === SUPER_ADMIN_ROLE) throw new AppException('IMMUTABLE_ROLE', 'لا يمكن تعديل صلاحيات Super Admin', 400);
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) });
      await this.audit.log({
        userId: u.id, action: 'permissions.role_changed', entity: 'role', entityId: id,
        oldValues: role.permissions.map((p) => p.permission.code).sort(), newValues: [...dto.permissionCodes].sort(), ctx,
      }, tx);
      return { id, permissions: [...new Set(dto.permissionCodes)].sort() };
    });
  }
}
