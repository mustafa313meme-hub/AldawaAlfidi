export interface OpenInvoice {
  id: string;
  remaining: number;
  date: Date;
}

export interface Allocation {
  invoiceId: string;
  amount: number;
}

export interface AllocationPlan {
  allocations: Allocation[];
  allocated: number;
  unallocated: number;
}

/**
 * Split a payment over open invoices.
 * - `preferredInvoiceId` is settled first (up to its remaining amount),
 * - then, if `auto`, the oldest invoices first (FIFO by date, then id),
 * - whatever is left stays unallocated (customer credit on account).
 * Never allocates more than an invoice's remaining amount and never more than the payment.
 */
export function allocatePayment(amount: number, open: OpenInvoice[], preferredInvoiceId?: string | null, auto = true): AllocationPlan {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('amount must be a positive integer');
  let rem = amount;
  const allocations: Allocation[] = [];
  const take = (inv: OpenInvoice) => {
    if (rem <= 0 || inv.remaining <= 0) return;
    const a = Math.min(rem, inv.remaining);
    allocations.push({ invoiceId: inv.id, amount: a });
    rem -= a;
  };
  const preferred = preferredInvoiceId ? open.find((i) => i.id === preferredInvoiceId) : undefined;
  if (preferredInvoiceId && !preferred) throw new RangeError('preferred invoice is not open');
  if (preferred) take(preferred);
  if (auto) {
    const fifo = [...open].filter((i) => i.id !== preferred?.id).sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
    for (const i of fifo) take(i);
  }
  return { allocations, allocated: amount - rem, unallocated: rem };
}
