import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, Ctx, CurrentUser, Public, ReqCtx } from '../common/decorators';
import { Message } from '../common/response';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, LogoutDto, RefreshDto, ResetPasswordDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Ctx() ctx: ReqCtx) {
    return this.auth.login(dto, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Ctx() ctx: ReqCtx) {
    return this.auth.refresh(dto.refreshToken, ctx);
  }

  /** `allDevices: true` signs out every device. */
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentUser() u: AuthUser, @Body() dto: LogoutDto, @Ctx() ctx: ReqCtx) {
    if (dto.allDevices) await this.auth.logoutAll(u.id, ctx);
    else await this.auth.logout(u.id, u.sessionId, ctx);
    return new Message('تم تسجيل الخروج');
  }

  @HttpCode(200)
  @Post('change-password')
  async changePassword(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto, @Ctx() ctx: ReqCtx) {
    await this.auth.changePassword(u.id, u.sessionId, dto, ctx);
    return new Message('تم تغيير كلمة المرور');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto, @Ctx() ctx: ReqCtx) {
    await this.auth.forgotPassword(dto.identifier, ctx);
    return new Message('إذا كان الحساب موجوداً فسيتم إرسال رمز الاستعادة');
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto, @Ctx() ctx: ReqCtx) {
    await this.auth.resetPassword(dto.token, dto.newPassword, ctx);
    return new Message('تم تعيين كلمة المرور الجديدة');
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return { id: u.id, username: u.username, fullName: u.fullName, role: u.roleName, permissions: u.permissions };
  }
}
