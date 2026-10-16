import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetNotifier } from './password-reset.notifier';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: c.get<string>('JWT_ACCESS_TTL') ?? '15m', algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PasswordResetNotifier],
})
export class AuthModule {}
