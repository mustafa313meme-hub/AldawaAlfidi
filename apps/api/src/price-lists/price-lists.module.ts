import { Module } from '@nestjs/common';
import { PriceListsController } from './price-lists.controller';

@Module({ controllers: [PriceListsController] })
export class PriceListsModule {}
