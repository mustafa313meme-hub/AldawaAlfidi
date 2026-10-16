import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/decorators';
import { AppException } from '../common/app.exception';
import { localDate } from '../common/perm';
import { toCsv } from './reports-logic';
import { DashboardService } from './dashboard.service';
import { ReportResult, ReportsService } from './reports.service';
import {
  AgingQuery, DashboardQuery, InventoryCurrentQuery, MoversQuery, PagedReportFilters, ReportFilters, ReturnsDim, SalesDim, TargetQuery, dimsReturns, dimsSales,
} from './reports.dto';

/**
 * JSON by default; `?format=csv` returns a UTF-8 (BOM) file that opens correctly in Excel.
 * Report permissions are global (not row-scoped): they are for managers, not field representatives.
 */
function send(res: Response, r: ReportResult, format: string | undefined, name: string) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${localDate(new Date())}.csv"`);
    res.send(toCsv(r.columns, r.rows));
    return;
  }
  res.json({ success: true, data: r, message: null, meta: null });
}

const dim = <T extends string>(allowed: readonly T[], v: string): T => {
  if (!(allowed as readonly string[]).includes(v)) throw new AppException('INVALID_DIMENSION', `التجميع غير مدعوم، المتاح: ${allowed.join(', ')}`, 400);
  return v as T;
};

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  // ───── sales ─────
  @Get('sales/daily') @RequirePermissions('reports.sales')
  async salesDaily(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.salesByPeriod(q, 'day'), q.format, 'sales-daily'); }

  @Get('sales/monthly') @RequirePermissions('reports.sales')
  async salesMonthly(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.salesByPeriod(q, 'month'), q.format, 'sales-monthly'); }

  /** dimension: representative | area | customer | product | company */
  @Get('sales/by/:dimension') @RequirePermissions('reports.sales')
  async salesBy(@Param('dimension') d: string, @Query() q: ReportFilters, @Res() res: Response) {
    const dm: SalesDim = dim(dimsSales, d);
    send(res, await this.reports.salesBy(dm, q), q.format, `sales-by-${dm}`);
  }

  // ───── returns ─────
  /** dimension: customer | representative | product | invoice */
  @Get('returns/by/:dimension') @RequirePermissions('reports.sales')
  async returnsBy(@Param('dimension') d: string, @Query() q: ReportFilters, @Res() res: Response) {
    const dm: ReturnsDim = dim(dimsReturns, d);
    send(res, await this.reports.returnsBy(dm, q), q.format, `returns-by-${dm}`);
  }

  // ───── financial ─────
  @Get('financial/receivables') @RequirePermissions('reports.financial')
  async receivables(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.receivables(q), q.format, 'receivables'); }

  @Get('financial/aging') @RequirePermissions('reports.financial')
  async aging(@Query() q: AgingQuery, @Res() res: Response) { send(res, await this.reports.aging(q), q.format, 'aging'); }

  @Get('financial/outstanding-invoices') @RequirePermissions('reports.financial')
  async outstanding(@Query() q: PagedReportFilters, @Res() res: Response) { send(res, await this.reports.outstandingInvoices(q), q.format, 'outstanding-invoices'); }

  @Get('financial/collections') @RequirePermissions('reports.financial')
  async collections(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.collections(q), q.format, 'collections'); }

  // ───── inventory (batches/near-expiry/expired live under /inventory/batches) ─────
  @Get('inventory/current') @RequirePermissions('reports.inventory')
  async invCurrent(@Query() q: InventoryCurrentQuery, @CurrentUser() u: AuthUser, @Res() res: Response) { send(res, await this.reports.inventoryCurrent(q, u), q.format, 'inventory-current'); }

  @Get('inventory/movement') @RequirePermissions('reports.inventory')
  async invMovement(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.stockMovement(q), q.format, 'stock-movement'); }

  @Get('inventory/movers') @RequirePermissions('reports.inventory')
  async movers(@Query() q: MoversQuery, @Res() res: Response) { send(res, await this.reports.movers(q), q.format, `movers-${q.kind ?? 'fast'}`); }

  // ───── representatives ─────
  @Get('representatives/performance') @RequirePermissions('reports.representatives')
  async repPerf(@Query() q: ReportFilters, @Res() res: Response) { send(res, await this.reports.repPerformance(q), q.format, 'representatives-performance'); }

  @Get('representatives/target-achievement') @RequirePermissions('reports.representatives')
  async targets(@Query() q: TargetQuery, @Res() res: Response) { send(res, await this.reports.targetAchievement(q), q.format, 'target-achievement'); }

  @Get('representatives/missed-visits') @RequirePermissions('reports.representatives')
  async missed(@Query() q: PagedReportFilters, @Res() res: Response) { send(res, await this.reports.missedVisits(q), q.format, 'missed-visits'); }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private dash: DashboardService) {}

  @Get() @RequirePermissions('reports.sales')
  admin(@Query() q: DashboardQuery) { return this.dash.admin(q); }

  /** Any authenticated representative: own figures only. */
  @Get('me')
  mine(@CurrentUser() u: AuthUser) { return this.dash.mine(u); }
}
