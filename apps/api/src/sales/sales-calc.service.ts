import { Injectable } from '@nestjs/common';
import { CustomerType, Prisma } from '@prisma/client';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/decorators';
import { can, localDate } from '../common/perm';
import { resolvePrice } from '../price-lists/pricing';
import { BonusTier, bonusFor } from './bonus';
import { MoneyError, computeLine } from './money';
import { LineDto } from './sales.dto';

type Tx = Prisma.TransactionClient;

export interface ComputedLine {
  productId: string;
  productName: string;
  quantity: number;
  bonusQuantity: number;
  unitPrice: number;
  priceSource: string;
  discountType: 'Percent' | 'Amount' | null;
  discountValue: number; // bp for Percent, dinars for Amount
  gross: number;
  discountAmount: number;
  net: number;
  taxRateBp: number;
  taxAmount: number;
  lineTotal: number;
  tiers: BonusTier[];
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  netTotal: number;
  bonusValue: number; // informational: value of free goods at list price, never billed
}

export const totalsOf = (lines: ComputedLine[]): Totals => ({
  subtotal: lines.reduce((s, l) => s + l.gross, 0),
  discountTotal: lines.reduce((s, l) => s + l.discountAmount, 0),
  taxTotal: lines.reduce((s, l) => s + l.taxAmount, 0),
  netTotal: lines.reduce((s, l) => s + l.lineTotal, 0),
  bonusValue: lines.reduce((s, l) => s + l.bonusQuantity * l.unitPrice, 0),
});

@Injectable()
export class SalesCalcService {
  /**
   * Prices, discounts, tax and bonus for a set of lines. All amounts are computed on the server;
   * client-supplied prices/discounts are honoured only with the matching permission (or when `trustPrices`,
   * i.e. converting an already-approved order).
   */
  async buildLines(
    tx: Tx,
    p: { customer: { priceListId: string | null; customerType: CustomerType }; lines: LineDto[]; actor: AuthUser; trustPrices?: boolean; at?: Date },
  ): Promise<{ lines: ComputedLine[]; totals: Totals }> {
    const ids = p.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_PRODUCT', 'منتج مكرر في الطلب؛ ادمج الكميات في سطر واحد', 400);

    const at = p.at ?? new Date();
    const day = new Date(localDate(at));
    const products = await tx.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map(products.map((x) => [x.id, x]));
    const bad = ids.filter((i) => !byId.get(i)?.isActive);
    if (bad.length) throw new AppException('INVALID_PRODUCT', 'منتج غير موجود أو غير فعّال', 400, bad);

    const defList = await tx.priceList.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
    const listIds = [p.customer.priceListId, defList?.id].filter((x): x is string => !!x);
    const items = listIds.length ? await tx.priceListItem.findMany({ where: { productId: { in: ids }, priceListId: { in: listIds } } }) : [];
    const priceOf = (listId: string | null | undefined, productId: string) => (listId ? items.find((i) => i.priceListId === listId && i.productId === productId)?.price : undefined);

    const rules = await tx.bonusRule.findMany({
      where: {
        productId: { in: ids }, isActive: true,
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: day } }] },
          { OR: [{ endDate: null }, { endDate: { gte: day } }] },
          { OR: [{ customerType: null }, { customerType: p.customer.customerType }] },
        ],
      },
    });

    const mayEditPrice = p.trustPrices || can(p.actor, 'invoices.edit_price');
    const mayDiscount = p.trustPrices || can(p.actor, 'invoices.discount');
    const out: ComputedLine[] = [];

    for (const l of p.lines) {
      const prod = byId.get(l.productId)!;
      let unitPrice: number;
      let source: string;
      if (l.unitPrice !== undefined) {
        if (!mayEditPrice) throw new AppException('FORBIDDEN', 'تعديل سعر البيع يتطلب صلاحية خاصة', 403, { productId: l.productId });
        unitPrice = l.unitPrice;
        source = 'manual';
      } else {
        const r = resolvePrice({ listPrice: priceOf(p.customer.priceListId, l.productId), defaultListPrice: priceOf(defList?.id, l.productId), productSalePrice: prod.salePrice });
        unitPrice = r.price;
        source = r.source;
      }
      if (unitPrice < prod.minSalePrice) {
        throw new AppException('BELOW_MIN_PRICE', `السعر أقل من الحد الأدنى المسموح (${prod.minSalePrice})`, 400, { productId: l.productId, unitPrice, minSalePrice: prod.minSalePrice });
      }

      let discountType: 'Percent' | 'Amount' | null = null;
      let discountValue = 0;
      if (l.discountType && (l.discountValue ?? 0) > 0) {
        if (!mayDiscount) throw new AppException('FORBIDDEN', 'منح الخصم يتطلب صلاحية خاصة', 403);
        if (!prod.discountEligible) throw new AppException('DISCOUNT_NOT_ALLOWED', 'هذا المنتج لا يقبل الخصم', 400, { productId: l.productId });
        discountType = l.discountType;
        discountValue = l.discountType === 'Percent' ? Math.round((l.discountValue as number) * 100) : (l.discountValue as number);
        if (l.discountType === 'Amount' && !Number.isInteger(discountValue)) throw new AppException('INVALID_DISCOUNT', 'مبلغ الخصم يجب أن يكون عدداً صحيحاً', 400);
      }

      const taxRateBp = Math.round(Number(prod.taxRate) * 100);
      let t;
      try {
        t = computeLine({ quantity: l.quantity, unitPrice, discountType, discountValue, taxRateBp });
      } catch (e) {
        if (e instanceof MoneyError) throw new AppException('INVALID_LINE', e.message, 400, { productId: l.productId });
        throw e;
      }

      const tiers = prod.bonusEligible ? rules.filter((r) => r.productId === l.productId).map((r) => ({ min: r.minQuantity, bonus: r.bonusQuantity })) : [];
      out.push({
        productId: l.productId, productName: prod.nameAr, quantity: l.quantity, bonusQuantity: bonusFor(l.quantity, tiers),
        unitPrice, priceSource: source, discountType, discountValue,
        gross: t.gross, discountAmount: t.discountAmount, net: t.net, taxRateBp, taxAmount: t.taxAmount, lineTotal: t.lineTotal, tiers,
      });
    }
    return { lines: out, totals: totalsOf(out) };
  }
}
