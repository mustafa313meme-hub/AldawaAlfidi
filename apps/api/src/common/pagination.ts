import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'desc';
}

export const skipTake = (q: PageQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
