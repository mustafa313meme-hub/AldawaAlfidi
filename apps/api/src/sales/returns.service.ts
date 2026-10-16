import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { DEFAULT_SETTINGS } from '../common/permissions.constants';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { LedgerService, MovementRow, StockService } from './stock-ledger.service';
import { distributeReturn } from '../inventory/allocation';
import { paymentStatusOf } from './invoices.service';
import { BonusTier } from './bonus';
import { MoneyError, creditForReturn } from './money';
import { BonusReturnPolicy, ReturnPolicyError, planReturnLine } from './return-policy';
import { CreateReturnDto, ReturnsQuery } from './sales.dto';

const INCLUDE = {
  items: true,
  invoice: { select: { id: true, invoiceNumber: true } },
  customer: { select: { id: true, code: true, name: true } },
} as const;

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private scope: ScopeService,
    private stock: StockService, private ledger: LedgerService,
  ) {}

  private async policy(): Promise<BonusReturnPolicy> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'bonus_return_policy' } });
    const v = (row?.value ?? DEFAULT_SETTINGS.bonus_return_policy) as string;
    if (v !== 'Independent' && v !== 'Proportional' && v !== 'FullBonusOnReturn') throw new AppException('INVALID_POLICY', 'قيمة bonus_return_policy غير صالحة', 500);
    return v;
  }

  async list(q: ReturnsQuery, u: AuthUser) {
    const where: Prisma.ReturnWhereInput = { customer: await this.scope.customerScope(u), invoiceId: q.invoiceId, customerId: q.customerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({ where, include: INCLUDE, orderBy: { returnDate: q.order }, ...skipTake(q) }),
      this.prisma.return.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const r = await this.prisma.return.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: INCLUDE });
    if (!r) throw new AppException('NOT_FOUND', 'المردود غير موجود', 404);
    return r;
  }

  async create(dto: CreateReturnDto, u: AuthUser, ctx: ReqCtx) {
    if (dto.billExcessBonus && !can(u, 'returns.approve')) throw new AppException('FORBIDDEN', 'محاسبة البونص الزائد بدل إرجاعه تتطلب صلاحية الاعتماد', 403);
    const ids = dto.items.map((i) => i.invoiceItemId);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_ITEMS', 'سطر فاتورة مكرر في المردود', 400);
    if (dto.localId && !ctx.device) throw new AppException('DEVICE_REQUIRED', 'أرسل x-device-id مع localId', 400);

    if (dto.localId && ctx.device) {
      const existing = await this.prisma.return.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
      if (existing) return existing; // idempotent retry
    }

    const policy = await this.policy();
    const scope = await this.scope.customerScope(u);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // lock order everywhere in the system: customer -> invoice -> stock rows (prevents deadlocks with payments/cancellations)
        const pre = await tx.invoice.findFirst({ where: { id: dto.invoiceId, customer: scope }, select: { customerId: true } });
        if (!pre) throw new AppException('NOT_FOUND', 'الفاتورة غير موجودة', 404);
        await this.ledger.lockCustomer(tx, pre.customerId);
        await this.ledger.lockInvoice(tx, dto.invoiceId);
        const inv = await tx.invoice.findFirstOrThrow({ where: { id: dto.invoiceId } }); // read after the locks: current amounts
        if (inv.status !== 'Confirmed') throw new AppException('INVOICE_NOT_ACTIVE', 'الفاتورة ملغاة', 409);

        // lock the lines, then read them: the returnable quantities below are exact for this transaction
        await tx.$queryRaw`SELECT id FROM invoice_items WHERE "invoiceId" = ${inv.id} AND id IN (${Prisma.join(ids)}) FOR UPDATE`;
        const items = await tx.invoiceItem.findMany({ where: { invoiceId: inv.id, id: { in: ids } } });
        if (items.length !== ids.length) throw new AppException('INVALID_ITEM', 'سطر غير تابع لهذه الفاتورة', 400);
        const byId = new Map(items.map((i) => [i.id, i]));

        let creditSold = 0;
        let billedAmount = 0;
        const returnItems: Prisma.ReturnItemCreateManyReturnInput[] = [];
        const moves: MovementRow[] = [];
        // where each invoice line's goods came from (FEFO allocation); older invoices have none -> unbatched
        const allocRows = await tx.invoiceItemBatch.findMany({ where: { invoiceItemId: { in: ids } }, include: { batch: true }, orderBy: { createdAt: 'asc' } });
        const planLog: unknown[] = [];

        for (const line of dto.items) {
          const it = byId.get(line.invoiceItemId)!;
          const condition = line.condition ?? 'Valid';
          let plan;
          try {
            plan = planReturnLine(policy, {
              quantity: it.quantity, bonusQuantity: it.bonusQuantity, returnedQuantity: it.returnedQuantity, bonusReturnedQuantity: it.bonusReturnedQuantity,
              tiers: ((it.bonusRuleSnapshot as unknown as BonusTier[] | null) ?? []),
            }, { soldQuantity: line.soldQuantity ?? 0, bonusQuantity: line.bonusQuantity ?? 0 }, !!dto.billExcessBonus);
          } catch (e) {
            if (e instanceof ReturnPolicyError) throw new AppException(e.code, e.message, 422, { invoiceItemId: it.id });
            throw e;
          }
          if (plan.soldQty + plan.bonusReturnQty + plan.bonusBilledQty === 0) continue;

          let credit = 0;
          try {
            credit = plan.soldQty > 0 ? creditForReturn(it.lineTotal, it.quantity, it.returnedQuantity, plan.soldQty) : 0;
          } catch (e) {
            if (e instanceof MoneyError) throw new AppException('INVALID_RETURN', e.message, 422);
            throw e;
          }
          const billed = plan.bonusBilledQty * it.unitPrice;
          creditSold += credit;
          billedAmount += billed;

          if (plan.soldQty > 0) returnItems.push({ invoiceItemId: it.id, productId: it.productId, lineType: 'Sold', quantity: plan.soldQty, amount: credit, condition, restocked: condition === 'Valid' });
          if (plan.bonusReturnQty > 0) returnItems.push({ invoiceItemId: it.id, productId: it.productId, lineType: 'Bonus', quantity: plan.bonusReturnQty, amount: 0, condition, restocked: condition === 'Valid', required: plan.bonusReturnQty > (line.bonusQuantity ?? 0) });
          if (plan.bonusBilledQty > 0) returnItems.push({ invoiceItemId: it.id, productId: it.productId, lineType: 'BonusBilled', quantity: plan.bonusBilledQty, amount: billed, condition, restocked: false, required: true });

          // counters: billed bonus is settled too, otherwise it would be demanded (and billed) again next time
          const upd = await tx.invoiceItem.updateMany({
            where: { id: it.id, returnedQuantity: it.returnedQuantity, bonusReturnedQuantity: it.bonusReturnedQuantity },
            data: { returnedQuantity: { increment: plan.soldQty }, bonusReturnedQuantity: { increment: plan.bonusReturnQty + plan.bonusBilledQty } },
          });
          if (upd.count !== 1) throw new AppException('CONCURRENT_RETURN', 'تغيّرت بيانات السطر، أعد المحاولة', 409);

          // rows to return into: real allocation rows, or one virtual unbatched row for pre-batch invoices
          type Row = { id: string; real: boolean; batchId: string | null; batchNumber: string | null; expiryDate: Date | null; sold: number; bonus: number; soldReturned: number; bonusReturned: number };
          const mine = allocRows.filter((r) => r.invoiceItemId === it.id);
          const rows: Row[] = mine.length
            ? mine.map((r) => ({ id: r.id, real: true, batchId: r.batchId, batchNumber: r.batch?.batchNumber ?? null, expiryDate: r.batch?.expiryDate ?? null, sold: r.quantity, bonus: r.bonusQuantity, soldReturned: r.returnedQuantity, bonusReturned: r.bonusReturnedQuantity }))
            : [{ id: '__legacy', real: false, batchId: null, batchNumber: null, expiryDate: null, sold: it.quantity, bonus: it.bonusQuantity, soldReturned: it.returnedQuantity, bonusReturned: it.bonusReturnedQuantity }];

          const place = async (qty: number, isBonus: boolean) => {
            if (qty <= 0) return;
            const cap = rows.map((r) => ({ ...r, capacity: isBonus ? r.bonus - r.bonusReturned : r.sold - r.soldReturned }));
            for (const { row, qty: q } of distributeReturn(cap, qty)) {
              const live = rows.find((r) => r.id === row.id)!;
              if (isBonus) live.bonusReturned += q; else live.soldReturned += q;
              if (live.real) await tx.invoiceItemBatch.update({ where: { id: live.id }, data: isBonus ? { bonusReturnedQuantity: { increment: q } } : { returnedQuantity: { increment: q } } });
              const base = { warehouseId: inv.warehouseId, productId: it.productId, isBonus, batchNumber: live.batchNumber, expiryDate: live.expiryDate, referenceType: 'Return', referenceId: '', createdById: u.id };
              moves.push({ ...base, movementType: 'ReturnIn', quantity: q });
              // damaged / expired goods are received and written off in the same transaction: full trace, no sellable stock
              if (condition === 'Valid') await this.stock.restore(tx, inv.warehouseId, it.productId, live.batchId, q);
              else moves.push({ ...base, movementType: condition === 'Damaged' ? 'Damage' : 'Expired', quantity: q });
            }
          };
          try {
            await place(plan.soldQty, false);
            await place(plan.bonusReturnQty, true);
            // billed bonus stays with the customer: it only consumes capacity on the allocation rows
            const billedCap = rows.map((r) => ({ ...r, capacity: r.bonus - r.bonusReturned }));
            for (const { row, qty: q } of plan.bonusBilledQty > 0 ? distributeReturn(billedCap, plan.bonusBilledQty) : []) {
              const live = rows.find((r) => r.id === row.id)!;
              live.bonusReturned += q;
              if (live.real) await tx.invoiceItemBatch.update({ where: { id: live.id }, data: { bonusReturnedQuantity: { increment: q } } });
            }
          } catch (e) {
            if (e instanceof Error && e.message === 'return exceeds allocated quantity') throw new AppException('ALLOCATION_MISMATCH', 'بيانات توزيع التشغيلات لا تطابق الفاتورة؛ راجع /inventory/reconcile', 500, { invoiceItemId: it.id });
            throw e;
          }
          planLog.push({ invoiceItemId: it.id, ...plan, credit, billed });
        }

        if (!returnItems.length) throw new AppException('NOTHING_TO_RETURN', 'لا توجد كميات للإرجاع', 400);
        if (billedAmount > creditSold) throw new AppException('BILLED_EXCEEDS_CREDIT', 'قيمة البونص المحاسَب عليه تتجاوز قيمة المردود؛ استخدم تسوية يدوية', 422, { creditSold, billedAmount });

        const returnNumber = `RET-${String(await this.seq.next('return', tx)).padStart(6, '0')}`;
        const ret = await tx.return.create({
          data: {
            returnNumber, invoiceId: inv.id, customerId: inv.customerId, warehouseId: inv.warehouseId, creditAmount: creditSold, billedAmount,
            policy, reason: dto.reason, notes: dto.notes, deviceId: dto.localId ? ctx.device : null, localId: dto.localId ?? null, createdById: u.id,
            items: { createMany: { data: returnItems } },
          },
          include: INCLUDE,
        });
        await this.stock.movements(tx, moves.map((m) => ({ ...m, referenceId: ret.id })));

        await this.ledger.add(tx, { customerId: inv.customerId, entryType: 'Return', credit: creditSold, referenceType: 'Return', referenceId: ret.id, description: `${returnNumber} / ${inv.invoiceNumber}`, createdById: u.id });
        if (billedAmount > 0) {
          await this.ledger.add(tx, { customerId: inv.customerId, entryType: 'Adjustment', debit: billedAmount, referenceType: 'Return', referenceId: ret.id, description: `بونص زائد محاسَب عليه — ${returnNumber}`, createdById: u.id });
        }

        const returnedAmount = inv.returnedAmount + creditSold - billedAmount;
        await tx.invoice.update({
          where: { id: inv.id },
          data: { returnedAmount, remainingAmount: Math.max(0, inv.netTotal - inv.paidAmount - returnedAmount), paymentStatus: paymentStatusOf(inv.netTotal, inv.paidAmount, returnedAmount) },
        });
        await this.audit.log({ userId: u.id, action: 'returns.create', entity: 'return', entityId: ret.id, newValues: { returnNumber, invoiceId: inv.id, policy, creditSold, billedAmount, plans: planLog }, ctx }, tx);
        return ret;
      }, { timeout: 20_000 });
    } catch (e) {
      if (dto.localId && ctx.device && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.return.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
        if (again) return again;
      }
      throw e;
    }
  }
}
