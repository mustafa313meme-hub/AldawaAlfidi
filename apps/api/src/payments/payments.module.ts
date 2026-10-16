import { Module } from '@nestjs/common';
import { AccountingController, PaymentsController } from './payments.controllers';
import { PaymentsService } from './payments.service';

@Module({ controllers: [PaymentsController, AccountingController], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
