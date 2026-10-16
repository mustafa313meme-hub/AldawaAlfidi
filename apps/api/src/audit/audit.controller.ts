import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../common/decorators';
import { PageQuery, skipTake } from '../common/pagination';
import { Paginated } from '../common/response';

class AuditQuery extends PageQuery {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// Read-only on purpose: there is no create/update/delete endpoint for audit logs.
@Controller('audit-logs')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.view')
  async list(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      userId: q.userId,
      entity: q.entity,
      entityId: q.entityId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: q.order }, ...skipTake(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }
}
