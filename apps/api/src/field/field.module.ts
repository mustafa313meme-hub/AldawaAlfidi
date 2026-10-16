import { Module } from '@nestjs/common';
import { RepresentativesController } from './representatives.controller';
import { AreasController } from './areas.controller';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VisitPlansController } from './visit-plans.controller';
import { TargetsController } from './targets.controller';

@Module({
  controllers: [RepresentativesController, AreasController, CustomersController, VisitsController, VisitPlansController, TargetsController],
  providers: [CustomersService, VisitsService],
  exports: [CustomersService, VisitsService],
})
export class FieldModule {}
