import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AdjustmentReason, PurchaseStatus } from '@prisma/client';
import { PageQuery } from '../common/pagination';

class PurchaseItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(10_000_000) quantity!: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) bonusQuantity?: number;
  @IsInt() @Min(0) @Max(2_000_000_000) unitCost!: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) discountAmount?: number;
}

export class CreatePurchaseDto {
  @IsUUID() companyId!: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items!: PurchaseItemDto[];
}

export class UpdatePurchaseDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items?: PurchaseItemDto[];
}

class ReceiveLineDto {
  @IsUUID() itemId!: string;
  @IsString() @MinLength(1) @MaxLength(60) batchNumber!: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsInt() @Min(0) @Max(10_000_000) quantity!: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) bonusQuantity?: number;
}

/** One-shot receipt: for every ordered item, the received batches must add up to the ordered quantity (and bonus). */
export class ReceivePurchaseDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(600) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines!: ReceiveLineDto[];
}

export class PurchasesQuery extends PageQuery {
  @IsOptional() @IsEnum(PurchaseStatus) status?: PurchaseStatus;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
}

class TransferItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(10_000_000) quantity!: number;
  /** Omit for automatic FEFO (non-expired batches only). Expired batches can only be moved explicitly. */
  @IsOptional() @IsUUID() batchId?: string;
}

export class CreateTransferDto {
  @IsUUID() fromWarehouseId!: string;
  @IsUUID() toWarehouseId!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => TransferItemDto) items!: TransferItemDto[];
}

class AdjustmentItemDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  /** Positive = add, negative = remove. Never zero. */
  @IsInt() @Min(-10_000_000) @Max(10_000_000) quantityDelta!: number;
}

export class CreateAdjustmentDto {
  @IsUUID() warehouseId!: string;
  @IsEnum(AdjustmentReason) reason!: AdjustmentReason;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => AdjustmentItemDto) items!: AdjustmentItemDto[];
}

class CountDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @IsInt() @Min(0) @Max(10_000_000) countedQuantity!: number;
}

/** Physical count: the system compares against its own quantity and adjusts the differences. */
export class StocktakeDto {
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CountDto) counts!: CountDto[];
}

export class ListQuery extends PageQuery {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() productId?: string;
}

export class BatchesQuery extends ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1095) days?: number;
  @IsOptional() @IsIn(['all', 'near', 'expired']) status?: 'all' | 'near' | 'expired';
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() includeEmpty?: boolean;
}
