import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../common/pagination';

const SKU = /^[A-Za-z0-9._-]{2,40}$/;
const BARCODE = /^[0-9A-Za-z-]{4,50}$/;

export class CreateProductDto {
  @IsOptional() @Matches(SKU) sku?: string; // auto-generated (P-000001) when omitted
  @IsOptional() @Matches(BARCODE) barcode?: string;
  @IsString() @MinLength(1) @MaxLength(200) nameAr!: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(200) genericName?: string;
  @IsUUID() companyId!: string;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) packSize?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) purchasePrice?: number;
  @IsInt() @Min(0) @Max(2_000_000_000) salePrice!: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) minSalePrice?: number;
  /** Low-stock alert threshold across all warehouses; 0 = no alert. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) reorderLevel?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsBoolean() bonusEligible?: boolean;
  @IsOptional() @IsBoolean() discountEligible?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

// sku is immutable after creation (it is referenced by documents and barcodes labels).
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['sku'] as const)) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductsQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
}
