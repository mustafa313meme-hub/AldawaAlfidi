import { Controller, Get, Global, HttpCode, Injectable, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Query, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { AppException } from '../common/app.exception';
import { Message, Paginated } from '../common/response';
import { NotificationsService } from './notifications.service';
import { PushSender } from './push.sender';

class InboxQuery {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unreadOnly?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** The caller's own inbox: every user sees only their notifications. */
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  async list(@Query() q: InboxQuery, @CurrentUser() u: AuthUser) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 30;
    const [items, total] = await this.notifications.list(u.id, !!q.unreadOnly, page, pageSize);
    return new Paginated(items, { page, pageSize, total });
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) { return { unread: await this.notifications.unreadCount(u.id) }; }

  @Post('read-all') @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) { return { marked: await this.notifications.markAllRead(u.id) }; }

  @Post(':id/read') @HttpCode(200)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    if (!(await this.notifications.markRead(u.id, id))) throw new AppException('NOT_FOUND', 'الإشعار غير موجود أو مقروء', 404);
    return new Message('تم');
  }

  /** Run the scheduled checks now (also what the background job calls). Safe to repeat: deduplicated per day. */
  @Post('run-checks') @HttpCode(200) @RequirePermissions('settings.update')
  runChecks() { return this.notifications.runChecks(); }
}

/** Background job: NOTIFICATIONS_JOB=true runs the checks every 6 hours. Several instances are fine (dedupe keys). */
@Injectable()
export class NotificationsScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger('NotificationsJob');

  constructor(private notifications: NotificationsService, private config: ConfigService) {}

  onModuleInit() {
    if (this.config.get<string>('NOTIFICATIONS_JOB') !== 'true') return;
    const run = () => this.notifications.runChecks().catch((e) => this.logger.error(e instanceof Error ? e.message : String(e)));
    setTimeout(run, 30_000).unref(); // shortly after start-up
    this.timer = setInterval(run, 6 * 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService, PushSender, NotificationsScheduler], exports: [NotificationsService] })
export class NotificationsModule {}
