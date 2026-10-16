import { Module } from '@nestjs/common';
import { AdjustmentsController, InventoryController, PurchasesController, TransfersController } from './inventory.controllers';
import { InventoryService } from './inventory.service';

@Module({ controllers: [PurchasesController, TransfersController, AdjustmentsController, InventoryController], providers: [InventoryService] })
export class InventoryModule {}
