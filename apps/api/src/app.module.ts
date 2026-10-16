import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { SettingsModule } from './settings/settings.module';
import { SequenceModule } from './sequence/sequence.service';
import { CompaniesModule } from './companies/companies.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { PriceListsModule } from './price-lists/price-lists.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { ScopeModule } from './common/scope.service';
import { FieldModule } from './field/field.module';
import { SalesModule } from './sales/sales.module';
import { StockModule } from './sales/stock-ledger.service';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { SyncModule } from './sync/sync.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AppVersionModule } from './app-version/app-version.module';
import { HealthController } from './health/health.controller';
import { validateEnv } from './common/config';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { PermissionsGuard } from './common/permissions.guard';
import { ResponseInterceptor } from './common/response';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule, AuditModule, SequenceModule, AuthModule, UsersModule, RolesModule, SettingsModule,
    CompaniesModule, CategoriesModule, ProductsModule, PriceListsModule, WarehousesModule,
    ScopeModule, StockModule, FieldModule, SalesModule, InventoryModule, PaymentsModule, ReportsModule, SyncModule, NotificationsModule, AppVersionModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
