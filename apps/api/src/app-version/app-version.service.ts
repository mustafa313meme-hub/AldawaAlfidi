import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app.exception';
import { PlatformConfig, UpdateInfo, compareVersions, evaluateUpdate, isValidAppVersions, parseVersion } from './version';

/** Held in memory for 60s: the check runs on every login/sync and the setting rarely changes. */
const TTL_MS = 60_000;

@Injectable()
export class AppVersionService {
  private cache: { at: number; cfg: Record<string, PlatformConfig> } | null = null;

  constructor(private prisma: PrismaService) {}

  /** Called after the setting changes so the new minimum applies at once on this instance. */
  invalidate() { this.cache = null; }

  private async config(): Promise<Record<string, PlatformConfig>> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.cfg;
    const row = await this.prisma.setting.findUnique({ where: { key: 'app_versions' } });
    const cfg = row && isValidAppVersions(row.value) ? (row.value as Record<string, PlatformConfig>) : {};
    this.cache = { at: Date.now(), cfg };
    return cfg;
  }

  async check(platform: string, version: string): Promise<UpdateInfo> {
    if (!parseVersion(version)) throw new AppException('INVALID_VERSION', 'صيغة الإصدار غير صالحة', 400);
    return evaluateUpdate(version, (await this.config())[platform]);
  }

  /**
   * Gate for login and sync: an app below the minimum supported version must update first (HTTP 426).
   * Requests without version headers (e.g. the web admin) are not affected.
   */
  async assertSupported(platform?: string | null, version?: string | null): Promise<void> {
    if (!platform || !version || !parseVersion(version)) return;
    const c = (await this.config())[platform];
    if (c?.minSupported && compareVersions(version, c.minSupported) < 0) {
      throw new AppException('UPGRADE_REQUIRED', 'يرجى تحديث التطبيق للاستمرار', 426, { minSupported: c.minSupported, latest: c.latest ?? null, url: c.url ?? null });
    }
  }
}
