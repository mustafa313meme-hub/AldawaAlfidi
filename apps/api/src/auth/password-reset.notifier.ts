import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Delivery channel stub. SMS/WhatsApp/email are deferred (SRS §8: OTP "مستقبلاً").
 * In development the token is logged; in other environments nothing is leaked.
 */
@Injectable()
export class PasswordResetNotifier {
  private readonly logger = new Logger('PasswordReset');
  constructor(private config: ConfigService) {}

  send(userId: string, token: string) {
    if (this.config.get('APP_ENV') === 'development') {
      this.logger.warn(`[DEV ONLY] reset token for user ${userId}: ${token}`);
    } else {
      this.logger.warn(`Password reset requested for user ${userId} but no delivery channel is configured`);
    }
  }
}
