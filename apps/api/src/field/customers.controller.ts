import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { AssignCustomerDto, CreateCustomerDto, CustomersQuery, MapQuery, UpdateCustomerDto } from './customers.dto';
import { CustomersService } from './customers.service';

// No DELETE: customers carry ledger history; use status=Inactive/Blocked.
@Controller('customers')
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get() @RequirePermissions('customers.view')
  list(@Query() q: CustomersQuery, @CurrentUser() u: AuthUser) { return this.customers.list(q, u); }

  // 'map' is declared before ':id' so it is not parsed as an id.
  @Get('map') @RequirePermissions('customers.view')
  map(@Query() q: MapQuery, @CurrentUser() u: AuthUser) { return this.customers.map(q, u); }

  @Get(':id') @RequirePermissions('customers.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.customers.get(id, u); }

  @Get(':id/assignments') @RequirePermissions('customers.view')
  assignments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.customers.assignments(id, u); }

  @Post() @RequirePermissions('customers.create')
  create(@Body() dto: CreateCustomerDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.customers.create(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('customers.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.customers.update(id, dto, u, ctx);
  }

  @Post(':id/assign') @RequirePermissions('customers.assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignCustomerDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.customers.assign(id, dto, u, ctx);
  }
}
