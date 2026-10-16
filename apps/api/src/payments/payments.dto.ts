import { IsBoolean, IsDateString, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaymentDocStatus, PaymentMethod } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export class CreatePaymentDto {
  @IsUUID() customerId!: string;
  /** Optional: settle this invoice first. Without it the payment goes to the oldest open invoices. */
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsInt() @Min(1) @Max(2_000_000_000) amount!: number;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsOptional() @IsISO8601() paymentDate?: string;
  @IsOptional() @IsString() @MaxLength(100) referenceNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Default true. false = apply only to `invoiceId`, keep the rest as credit on account. */
  @IsOptional() @IsBoolean() autoAllocate?: boolean;
  @IsOptional() @IsUUID() representativeId?: string;
  /** Offline id; with x-device-id it makes retries idempotent. */
  @IsOptional() @IsUUID() localId?: string;
}

export class AllocatePaymentDto {
  @IsUUID() invoiceId!: string;
  @IsInt() @Min(1) @Max(2_000_000_000) amount!: number;
}

export class CancelPaymentDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class PaymentsQuery extends PageQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsEnum(PaymentDocStatus) status?: PaymentDocStatus;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class SummaryQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() representativeId?: string;
}
