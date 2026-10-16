import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PaymentsModule } from '../payments/payments.module';
import { SalesModule } from '../sales/sales.module';
import { PullService } from './pull.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [FieldModule, SalesModule, PaymentsModule], controllers: [SyncController], providers: [SyncService, PullService] })
export class SyncModule {}
