import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { CompaniesQuery, CreateCompanyDto, UpdateCompanyDto } from './companies.dto';

// No DELETE: companies are referenced by products and purchases; use isActive=false.
@Controller('companies')
export class CompaniesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('companies.view')
  async list(@Query() q: CompaniesQuery) {
    const where: Prisma.CompanyWhereInput = {
      isActive: q.isActive,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { contactPerson: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const sort = q.sort === 'createdAt' ? 'createdAt' : 'name';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({ where, orderBy: { [sort]: q.sort ? q.order : 'asc' }, ...skipTake(q) }),
      this.prisma.company.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  @Get(':id') @RequirePermissions('companies.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.company.findUnique({ where: { id } });
    if (!c) throw new AppException('NOT_FOUND', 'الشركة غير موجودة', 404);
    return c;
  }

  @Post() @RequirePermissions('companies.create')
  create(@Body() dto: CreateCompanyDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({ data: dto });
      await this.audit.log({ userId: u.id, action: 'companies.create', entity: 'company', entityId: c.id, newValues: c, ctx }, tx);
      return c;
    });
  }

  @Patch(':id') @RequirePermissions('companies.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'الشركة غير موجودة', 404);
      const after = await tx.company.update({ where: { id }, data: dto });
      await this.audit.log({ userId: u.id, action: dto.isActive === false ? 'companies.deactivate' : 'companies.update', entity: 'company', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}
