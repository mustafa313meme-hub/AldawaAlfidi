import { PartialType, PickType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { VisitLocationStatus, VisitType } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export class CreateVisitDto {
  /** Only needed when the caller is not a representative (e.g. admin entering on someone's behalf). */
  @IsOptional() @IsUUID() representativeId?: string;
  @IsUUID() customerId!: string;
  @IsISO8601() startTime!: string;
  @IsOptional() @IsISO8601() endTime?: string;
  @IsEnum(VisitType) visitType!: VisitType;
  @IsOptional() @IsString() @MaxLength(500) outcome?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDateString() nextVisitDate?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
  @IsOptional() @IsISO8601() locationAt?: string;
  /** Offline-created id; together with x-device-id it makes retries idempotent. */
  @IsOptional() @IsUUID() localId?: string;
}

export class UpdateVisitDto extends PartialType(PickType(CreateVisitDto, ['endTime', 'visitType', 'outcome', 'notes', 'nextVisitDate'] as const)) {}

export class VisitsQuery extends PageQuery {
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(VisitType) visitType?: VisitType;
  @IsOptional() @IsEnum(VisitLocationStatus) locationStatus?: VisitLocationStatus;
}
