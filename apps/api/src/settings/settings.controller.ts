import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';

import { isValidAppVersions } from '../app-version/version';

type Validator = (v: unknown) => boolean;
const ALLOWED: Record<string, Validator> = {
  bonus_return_policy: (v) => v === 'Independent' || v === 'Proportional' || v === 'FullBonusOnReturn',
  require_location_for_visit: (v) => typeof v === 'boolean',
  currency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
  visit_max_accuracy_m: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 1000,
  visit_max_distance_m: (v) => Number.isInteger(v) && (v as number) >= 10 && (v as number) <= 5000,
  visit_block_when_far: (v) => typeof v === 'boolean',
  overdue_days: (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365,
  app_versions: (v) => isValidAppVersions(v),
};

@Controller('settings')
export class SettingsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('settings.view')
  async all() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Put(':key') @RequirePermissions('settings.update')
  async set(@Param('key') key: string, @Body() body: { value: unknown }, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const validate = ALLOWED[key];
    if (!validate) throw new AppException('UNKNOWN_SETTING', 'إعداد غير معروف', 400);
    if (!validate(body?.value)) throw new AppException('INVALID_SETTING_VALUE', 'قيمة غير صالحة لهذا الإعداد', 400);
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.setting.findUnique({ where: { key } });
      const row = await tx.setting.upsert({
        where: { key }, update: { value: body.value as never, updatedBy: u.id }, create: { key, value: body.value as never, updatedBy: u.id },
      });
      await this.audit.log({ userId: u.id, action: 'settings.update', entity: 'setting', entityId: key, oldValues: old?.value, newValues: row.value, ctx }, tx);
      return { key, value: row.value };
    });
  }
}
