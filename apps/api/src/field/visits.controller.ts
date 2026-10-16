import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { CreateVisitDto, UpdateVisitDto, VisitsQuery } from './visits.dto';
import { VisitsService } from './visits.service';

// Visits are never deleted: they are evidence of field work.
@Controller('visits')
export class VisitsController {
  constructor(private visits: VisitsService) {}

  @Get() @RequirePermissions('visits.view')
  list(@Query() q: VisitsQuery, @CurrentUser() u: AuthUser) { return this.visits.list(q, u); }

  @Get(':id') @RequirePermissions('visits.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.visits.get(id, u); }

  @Post() @RequirePermissions('visits.create')
  create(@Body() dto: CreateVisitDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.visits.create(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('visits.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVisitDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.visits.update(id, dto, u, ctx);
  }
}
