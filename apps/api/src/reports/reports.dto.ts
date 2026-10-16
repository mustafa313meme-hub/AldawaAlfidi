import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PageQuery } from '../common/pagination';

export class ReportFilters {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  /** Max rows for aggregated reports (default 1000). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number;
  /** csv = server-generated file download (UTF-8 with BOM, opens in Excel). */
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

export class PagedReportFilters extends ReportFilters {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class AgingQuery extends ReportFilters {
  /** Ages are measured to this date (default today). Amounts are the CURRENT open amounts. */
  @IsOptional() @IsDateString() asOf?: string;
}

export class MoversQuery extends ReportFilters {
  @IsOptional() @IsIn(['fast', 'slow']) kind?: 'fast' | 'slow';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(730) days?: number;
}

export class InventoryCurrentQuery extends PagedReportFilters {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() lowOnly?: boolean;
}

export class TargetQuery {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsUUID() representativeId?: string;
  @IsOptional() @IsIn(['json', 'csv']) format?: 'json' | 'csv';
}

export class DashboardQuery {
  @IsOptional() @IsUUID() representativeId?: string;
}

export const dimsSales = ['representative', 'area', 'customer', 'product', 'company'] as const;
export const dimsReturns = ['customer', 'representative', 'product', 'invoice'] as const;
export type SalesDim = (typeof dimsSales)[number];
export type ReturnsDim = (typeof dimsReturns)[number];
