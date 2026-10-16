import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { InvoiceStatus, ItemCondition, OrderStatus, PaymentStatus } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export class LineDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(100_000) quantity!: number;
  /** Only honoured for users with invoices.edit_price; otherwise the price comes from the price lists. */
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) unitPrice?: number;
  @IsOptional() @IsEnum(['Percent', 'Amount']) discountType?: 'Percent' | 'Amount';
  /** Percent: 0-100 (max 2 decimals). Amount: dinars. Requires invoices.discount. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(2_000_000_000) discountValue?: number;
}

export class PreviewDto {
  @IsUUID() customerId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) lines!: LineDto[];
}

export class CreateOrderDto extends PreviewDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() submit?: boolean;
  @IsOptional() @IsUUID() localId?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) lines?: LineDto[];
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class OrdersQuery extends PageQuery {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class ConvertOrderDto {
  @IsOptional() @IsUUID() warehouseId?: string;
}

export class CreateInvoiceDto {
  @IsUUID() customerId!: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) lines!: LineDto[];
}

export class InvoicesQuery extends PageQuery {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CancelInvoiceDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

class ReturnLineDto {
  @IsUUID() invoiceItemId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) soldQuantity?: number;
  /** Independent bonus return (free goods given back). */
  @IsOptional() @IsInt() @Min(0) @Max(100_000) bonusQuantity?: number;
  @IsOptional() @IsEnum(ItemCondition) condition?: ItemCondition;
}

export class CreateReturnDto {
  @IsUUID() invoiceId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) items!: ReturnLineDto[];
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Bill the policy-required bonus instead of taking it back (e.g. consumed). Requires returns.approve. */
  @IsOptional() @IsBoolean() billExcessBonus?: boolean;
  @IsOptional() @IsUUID() localId?: string;
}

export class ReturnsQuery extends PageQuery {
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUUID() customerId?: string;
}

export class CreateBonusRuleDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(100_000) minQuantity!: number;
  @IsInt() @Min(1) @Max(100_000) bonusQuantity!: number;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsEnum(['Pharmacy', 'Doctor', 'Hospital', 'MedicalCenter', 'Distributor', 'Other']) customerType?: 'Pharmacy' | 'Doctor' | 'Hospital' | 'MedicalCenter' | 'Distributor' | 'Other';
}
export class UpdateBonusRuleDto extends PartialType(CreateBonusRuleDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class BonusRulesQuery extends PageQuery {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
}

export class OpeningStockDto {
  @IsUUID() warehouseId!: string;
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(10_000_000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(60) batchNumber?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) unitCost?: number;
}
export class StockQuery extends PageQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
export class StatementQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
