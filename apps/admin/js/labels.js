export const L = {
  customerType: { Pharmacy: 'صيدلية', Doctor: 'طبيب', Hospital: 'مستشفى', MedicalCenter: 'مركز طبي', Distributor: 'موزّع', Other: 'أخرى' },
  customerStatus: { Active: 'فعّال', Suspended: 'موقوف', Blocked: 'محظور', Inactive: 'غير فعّال' },
  orderStatus: { Draft: 'مسودة', Submitted: 'مُرسَل', Approved: 'معتمد', Preparing: 'قيد التجهيز', Delivered: 'مسلَّم', Cancelled: 'ملغى' },
  invoiceStatus: { Confirmed: 'مؤكدة', Cancelled: 'ملغاة' },
  paymentStatus: { Unpaid: 'غير مسددة', Partial: 'مسددة جزئياً', Paid: 'مسوّاة' },
  payMethod: { Cash: 'نقد', Bank: 'بنك', Transfer: 'حوالة', Other: 'أخرى' },
  payDoc: { Confirmed: 'مؤكد', Cancelled: 'ملغى' },
  purchaseStatus: { Draft: 'مسودة', Ordered: 'مطلوب', Received: 'مستلَم', Cancelled: 'ملغى' },
  lineType: { Sold: 'مباع', Bonus: 'بونص', BonusBilled: 'بونص محاسَب' },
  condition: { Valid: 'سليم', Damaged: 'تالف', Expired: 'منتهٍ' },
  syncStatus: { Pending: 'قيد المعالجة', Applied: 'مُطبَّقة', Conflict: 'تعارض', Rejected: 'مرفوضة', Failed: 'فشل مؤقت', Discarded: 'مُتجاهَلة' },
  repStatus: { Active: 'فعّال', Suspended: 'موقوف', Vacation: 'إجازة', Inactive: 'غير فعّال' },
  adjReason: { Stocktake: 'جرد', Damage: 'تالف', Expired: 'منتهي الصلاحية', Correction: 'تصحيح', Loss: 'فقد', Other: 'أخرى' },
  visitType: { Sales: 'مبيعات', Medical: 'علمية/طبية', FollowUp: 'متابعة', Collection: 'تحصيل', Other: 'أخرى' },
  locStatus: { NotProvided: 'بلا موقع', Verified: 'موقع مؤكَّد', PoorAccuracy: 'دقة ضعيفة', TooFar: 'بعيد عن العميل', NoCustomerLocation: 'العميل بلا إحداثيات' },
  planStatus: { Planned: 'مخطَّطة', Done: 'منجزة', Skipped: 'متخطّاة', Cancelled: 'ملغاة' },
  targetPeriod: { Monthly: 'شهري', Quarterly: 'ربع سنوي', Yearly: 'سنوي', Custom: 'مخصّص' },
  opType: { visit: 'زيارة', order: 'طلب', payment: 'تسديد', return: 'مردود' },
};

export const kind = (map, v) => ({
  Active: 'ok', Confirmed: 'ok', Applied: 'ok', Paid: 'ok', Received: 'ok', Delivered: 'ok', Approved: 'ok', Verified: 'ok', Done: 'ok',
  Suspended: 'warn', Partial: 'warn', Preparing: 'warn', Submitted: 'warn', Ordered: 'warn', Conflict: 'warn', Failed: 'warn', Pending: 'warn', Draft: '', PoorAccuracy: 'warn', NoCustomerLocation: 'warn', Planned: 'warn',
  Blocked: 'bad', Cancelled: 'bad', Inactive: 'bad', Unpaid: 'bad', Rejected: 'bad', TooFar: 'bad',
}[v] ?? '');

export const lbl = (map, v) => (v === undefined || v === null ? '' : map[v] ?? v);
