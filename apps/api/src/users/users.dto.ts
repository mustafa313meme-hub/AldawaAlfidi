import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../common/pagination';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const USERNAME = /^[a-z0-9._-]{3,50}$/;
const PHONE = /^\+?[0-9]{7,15}$/;

export class CreateUserDto {
  @Transform(lower) @Matches(USERNAME, { message: 'username: 3-50 chars (a-z 0-9 . _ -)' }) username!: string;
  @IsString() @MinLength(2) @MaxLength(150) fullName!: string;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @Transform(lower) @IsEmail() email?: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsUUID() roleId!: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(150) fullName?: string;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @Transform(lower) @IsEmail() email?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ResetPasswordByAdminDto {
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class UsersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
}

class OverrideDto {
  @IsString() code!: string;
  @IsBoolean() allowed!: boolean;
}

export class SetOverridesDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => OverrideDto) overrides!: OverrideDto[];
}
