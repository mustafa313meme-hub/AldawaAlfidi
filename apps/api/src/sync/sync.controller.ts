import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, Public, ReqCtx, RequirePermissions } from '../common/decorators';
import { AppException } from '../common/app.exception';
import { ScopeService } from '../common/scope.service';
import { PullService } from './pull.service';
import { SyncService } from './sync.service';
import { ConflictsQuery, PULL_ENTITIES, PullEntity, PullQuery, PushDto, ResolveDto } from './sync.dto';

@Controller('sync')
export class SyncController {
  constructor(private sync: SyncService, private pull: PullService, private scope: ScopeService) {}

  /** Clock-skew check for devices (no login needed). */
  @Public() @Get('time')
  time() { return { serverTime: new Date().toISOString() }; }

  @Get('manifest') @RequirePermissions('sync.use')
  async manifest(@CurrentUser() u: AuthUser) {
    return this.pull.manifest(u, (await this.scope.repOf(u))?.id ?? null);
  }

  /** Send a batch of offline operations (needs the x-device-id header). Per-operation results; partial success is normal. */
  @Post('push') @HttpCode(200) @RequirePermissions('sync.use')
  push(@Body() dto: PushDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.sync.push(dto, u, ctx); }

  @Get('pull/:entity') @RequirePermissions('sync.use')
  pullEntity(@Param('entity') entity: string, @Query() q: PullQuery, @CurrentUser() u: AuthUser) {
    if (!(PULL_ENTITIES as readonly string[]).includes(entity)) throw new AppException('UNKNOWN_ENTITY', `الكيان غير معروف، المتاح: ${PULL_ENTITIES.join(', ')}`, 404);
    return this.pull.pull(entity as PullEntity, q, u);
  }

  /** The device's own list of operations that did not go through. */
  @Get('status') @RequirePermissions('sync.use')
  status(@CurrentUser() u: AuthUser, @Headers('x-device-id') deviceId?: string) { return this.sync.status(u, deviceId?.slice(0, 100)); }

  // ───── manager: Conflict Queue (SRS §36, §91) ─────
  @Get('conflicts') @RequirePermissions('sync.manage')
  conflicts(@Query() q: ConflictsQuery) { return this.sync.list(q); }

  @Get('conflicts/:id') @RequirePermissions('sync.manage')
  conflict(@Param('id', ParseUUIDPipe) id: string) { return this.sync.get(id); }

  @Post('conflicts/:id/resolve') @HttpCode(200) @RequirePermissions('sync.manage')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.sync.resolve(id, dto, u, ctx); }
}
