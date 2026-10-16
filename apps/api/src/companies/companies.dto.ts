import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';

export class CreateCompanyDto {
  @IsString() @MinLength(2) @MaxLength(150) name!: string;
  @IsOptional() @Matches(/^\+?[0-9]{7,15}$/) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(150) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(150) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CompaniesQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
}
