import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CustomerStatus, CustomerType } from '@prisma/client';
import { PageQuery } from '../common/pagination';

const PHONE = /^\+?[0-9]{7,15}$/;

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsEnum(CustomerType) customerType?: CustomerType;
  @IsOptional() @Matches(PHONE) phone?: string;
  @IsOptional() @Matches(PHONE) secondaryPhone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsUUID() areaId?: string | null;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsString() @MaxLength(150) ownerName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) licenseNumber?: string;
  @IsOptional() @IsString() @MaxLength(150) paymentTerms?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  // Financial / policy fields: require customers.manage_credit
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) creditLimit?: number;
  @IsOptional() @IsInt() @Min(-2_000_000_000) @Max(2_000_000_000) openingBalance?: number;
  @IsOptional() @IsUUID() priceListId?: string | null;
  // Assignment: requires customers.assign (a rep creating a customer is auto-assigned to themselves)
  @IsOptional() @IsUUID() assignedRepresentativeId?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsOptional() @IsEnum(CustomerStatus) status?: CustomerStatus;
}

export class CustomersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(CustomerType) customerType?: CustomerType;
  @IsOptional() @IsEnum(CustomerStatus) status?: CustomerStatus;
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
}

export class MapQuery {
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(50_000) radiusM?: number;
  @IsOptional() @IsEnum(CustomerStatus) status?: CustomerStatus;
}

export class AssignCustomerDto {
  @IsUUID() representativeId!: string;
}
