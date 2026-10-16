import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class DeviceDto {
  @IsString() @MaxLength(100) deviceId!: string;
  @IsOptional() @IsString() @MaxLength(30) platform?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(30) buildNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) pushToken?: string;
}

export class LoginDto {
  /** username, phone or email */
  @IsString() @MinLength(3) @MaxLength(100) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @IsOptional() @ValidateNested() @Type(() => DeviceDto) device?: DeviceDto;
}

export class RefreshDto {
  @IsString() @MaxLength(200) refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class ForgotPasswordDto {
  @IsString() @MinLength(3) @MaxLength(100) @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  identifier!: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(200) token!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class LogoutDto {
  @IsOptional() @IsBoolean() allDevices?: boolean;
}
