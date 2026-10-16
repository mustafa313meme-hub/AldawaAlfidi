import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { OrdersService } from './orders.service';
import { ReturnsService } from './returns.service';
import { SalesCalcService } from './sales-calc.service';
import { BonusRulesController, InvoicesController, LedgerController, OrdersController, ReturnsController, StockController } from './sales.controllers';

@Module({
  controllers: [OrdersController, InvoicesController, ReturnsController, BonusRulesController, StockController, LedgerController],
  providers: [InvoicesService, OrdersService, ReturnsService, SalesCalcService],
  exports: [InvoicesService, OrdersService, ReturnsService],
})
export class SalesModule {}
