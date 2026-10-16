import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { Message } from '../common/response';
import { CreateUserDto, ResetPasswordByAdminDto, SetOverridesDto, UpdateUserDto, UsersQuery } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get() @RequirePermissions('users.view')
  list(@Query() q: UsersQuery) { return this.users.list(q); }

  @Get(':id') @RequirePermissions('users.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }

  @Post() @RequirePermissions('users.create')
  create(@Body() dto: CreateUserDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.users.create(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('users.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.users.update(id, dto, u, ctx);
  }

  @Delete(':id') @HttpCode(200) @RequirePermissions('users.delete')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.users.remove(id, u, ctx);
    return new Message('تم حذف المستخدم');
  }

  @Post(':id/reset-password') @HttpCode(200) @RequirePermissions('users.reset_password')
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordByAdminDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.users.resetPasswordByAdmin(id, dto.newPassword, u, ctx);
    return new Message('تم تعيين كلمة مرور جديدة وإنهاء كل الجلسات');
  }

  @Put(':id/permissions') @RequirePermissions('users.manage_permissions')
  setOverrides(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetOverridesDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.users.setOverrides(id, dto, u, ctx);
  }

  @Get(':id/devices') @RequirePermissions('devices.view')
  devices(@Param('id', ParseUUIDPipe) id: string) { return this.users.listDevices(id); }

  @Post(':id/devices/:deviceRefId/revoke') @HttpCode(200) @RequirePermissions('devices.revoke')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Param('deviceRefId', ParseUUIDPipe) d: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.users.setDeviceActive(id, d, false, u, ctx);
    return new Message('تم إيقاف الجهاز وإنهاء جلساته');
  }

  @Post(':id/devices/:deviceRefId/activate') @HttpCode(200) @RequirePermissions('devices.revoke')
  async activate(@Param('id', ParseUUIDPipe) id: string, @Param('deviceRefId', ParseUUIDPipe) d: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.users.setDeviceActive(id, d, true, u, ctx);
    return new Message('تم تفعيل الجهاز');
  }
}
