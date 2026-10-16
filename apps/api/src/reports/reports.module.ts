import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController, ReportsController } from './reports.controllers';
import { ReportsService } from './reports.service';

@Module({ controllers: [ReportsController, DashboardController], providers: [ReportsService, DashboardService] })
export class ReportsModule {}
