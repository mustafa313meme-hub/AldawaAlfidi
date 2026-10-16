import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { SyncStatus } from '@prisma/client';
import { PageQuery } from '../common/pagination';

export const OP_TYPES = ['visit', 'order', 'payment', 'return'] as const;
export type OpType = (typeof OP_TYPES)[number];

export class OpDto {
  /** Generated on the device when the operation is created offline. With the device id it is the idempotency key. */
  @IsUUID() localId!: string;
  @IsIn(OP_TYPES) type!: OpType;
  @IsOptional() @IsISO8601() clientCreatedAt?: string;
  /** Same body the matching online endpoint takes (POST /visits, /orders, /payments, /returns). */
  @IsObject() payload!: Record<string, unknown>;
}

export class PushDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OpDto) ops!: OpDto[];
}

export class PullQuery {
  /** `serverTime` of the previous COMPLETE sync (take it from the first page of that sync). Omit for a full download. */
  @IsOptional() @IsISO8601() since?: string;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}

export class ResolveDto {
  @IsIn(['retry', 'discard']) action!: 'retry' | 'discard';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ConflictsQuery extends PageQuery {
  @IsOptional() @IsIn(Object.values(SyncStatus)) status?: SyncStatus;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @MaxLength(100) deviceId?: string;
  @IsOptional() @IsIn(OP_TYPES) type?: OpType;
}

export const PULL_ENTITIES = [
  'customers', 'removedCustomers', 'balances', 'products', 'categories', 'companies', 'areas', 'bonusRules',
  'priceLists', 'priceListItems', 'visitPlans', 'openInvoices', 'settings',
] as const;
export type PullEntity = (typeof PULL_ENTITIES)[number];
