import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Push delivery seam. Device tokens are already stored (user_devices.push_token).
 *   PUSH_PROVIDER=none (default) : in-app inbox only
 *   PUSH_PROVIDER=log            : writes what WOULD be pushed to the log (to verify wiring)
 * A real provider (Firebase Cloud Messaging) needs credentials and network access and is NOT implemented here:
 * add it by implementing `deliver` below.
 */
@Injectable()
export class PushSender {
  private readonly logger = new Logger('Push');

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  async send(userIds: string[], n: { title: string; body: string; data?: unknown }): Promise<void> {
    const provider = this.config.get<string>('PUSH_PROVIDER') ?? 'none';
    if (provider === 'none' || userIds.length === 0) return;
    const devices = await this.prisma.userDevice.findMany({ where: { userId: { in: userIds }, isActive: true, pushToken: { not: null } }, select: { pushToken: true, platform: true } });
    if (provider === 'log') {
      this.logger.log(`would push "${n.title}" to ${devices.length} device(s)`); // token values are never logged
      return;
    }
    this.logger.warn(`PUSH_PROVIDER=${provider} is not implemented; ${devices.length} device(s) not notified`);
  }
}
