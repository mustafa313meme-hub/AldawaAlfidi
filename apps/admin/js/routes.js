// Route table + sidebar. `perm` hides menu items and blocks the page for users without it (the API enforces it anyway).
export const MENU = [
  { group: 'الرئيسية', items: [{ path: '/dashboard', label: 'لوحة المتابعة', perm: 'reports.sales' }] },
  { group: 'المبيعات', items: [
    { path: '/customers', label: 'العملاء', perm: 'customers.view' },
    { path: '/customer-map', label: 'خريطة العملاء', perm: 'customers.view' },
    { path: '/orders', label: 'الطلبات', perm: 'orders.view' },
    { path: '/invoices', label: 'الفواتير', perm: 'invoices.view' },
    { path: '/returns', label: 'المردودات', perm: 'returns.view' },
    { path: '/payments', label: 'التسديدات', perm: 'payments.view' },
  ] },
  { group: 'المندوبون الميدانيون', items: [
    { path: '/visits', label: 'الزيارات', perm: 'visits.view' },
    { path: '/visit-plans', label: 'خطط الزيارة', perm: 'visit_plans.view' },
    { path: '/targets', label: 'الأهداف', perm: 'targets.view' },
  ] },
  { group: 'المخزون', items: [
    { path: '/products', label: 'المنتجات', perm: 'products.view' },
    { path: '/stock', label: 'أرصدة المخزون', perm: 'inventory.view' },
    { path: '/batches', label: 'التشغيلات والصلاحية', perm: 'inventory.view' },
    { path: '/purchases', label: 'المشتريات', perm: 'purchases.view' },
    { path: '/transfers', label: 'التحويل بين المخازن', perm: 'inventory.view' },
    { path: '/adjustments', label: 'تسويات المخزون', perm: 'inventory.view' },
    { path: '/stocktake', label: 'الجرد', perm: 'inventory.adjust' },
  ] },
  { group: 'البيانات الرئيسية', items: [
    { path: '/companies', label: 'الشركات', perm: 'companies.view' },
    { path: '/categories', label: 'التصنيفات', perm: 'categories.view' },
    { path: '/warehouses', label: 'المخازن', perm: 'warehouses.view' },
    { path: '/areas', label: 'المناطق', perm: 'areas.view' },
    { path: '/representatives', label: 'المندوبون', perm: 'representatives.view' },
    { path: '/price-lists', label: 'قوائم الأسعار', perm: 'price_lists.view' },
    { path: '/bonus-rules', label: 'قواعد البونص', perm: 'bonus_rules.view' },
  ] },
  { group: 'التقارير', items: [{ path: '/reports', label: 'التقارير', perm: 'reports.*' }] },
  { group: 'الإدارة', items: [
    { path: '/sync', label: 'طابور المزامنة', perm: 'sync.manage' },
    { path: '/users', label: 'المستخدمون', perm: 'users.view' },
    { path: '/audit', label: 'سجل التدقيق', perm: 'audit.view' },
    { path: '/settings', label: 'الإعدادات', perm: 'settings.view' },
  ] },
];

export const ROUTES = [
  { pattern: '/dashboard', perm: 'reports.sales', load: () => import('./pages/dashboard.js') },
  { pattern: '/customers', perm: 'customers.view', load: () => import('./pages/customers.js') },
  { pattern: '/customers/:id', perm: 'customers.view', load: () => import('./pages/customer-detail.js') },
  { pattern: '/customer-map', perm: 'customers.view', load: () => import('./pages/customer-map.js') },
  { pattern: '/visits', perm: 'visits.view', load: () => import('./pages/visits.js') },
  { pattern: '/visit-plans', perm: 'visit_plans.view', load: () => import('./pages/visit-plans.js') },
  { pattern: '/targets', perm: 'targets.view', load: () => import('./pages/targets.js') },
  { pattern: '/stocktake', perm: 'inventory.adjust', load: () => import('./pages/stocktake.js') },
  { pattern: '/products', perm: 'products.view', load: () => import('./pages/products.js') },
  { pattern: '/orders', perm: 'orders.view', load: () => import('./pages/orders.js') },
  { pattern: '/orders/:id', perm: 'orders.view', load: () => import('./pages/order-detail.js') },
  { pattern: '/invoices', perm: 'invoices.view', load: () => import('./pages/invoices.js') },
  { pattern: '/invoices/new', perm: 'invoices.create', load: () => import('./pages/invoice-new.js') },
  { pattern: '/invoices/:id', perm: 'invoices.view', load: () => import('./pages/invoice-detail.js') },
  { pattern: '/returns', perm: 'returns.view', load: () => import('./pages/returns.js') },
  { pattern: '/returns/new', perm: 'returns.create', load: () => import('./pages/return-new.js') },
  { pattern: '/payments', perm: 'payments.view', load: () => import('./pages/payments.js') },
  { pattern: '/stock', perm: 'inventory.view', load: () => import('./pages/stock.js') },
  { pattern: '/batches', perm: 'inventory.view', load: () => import('./pages/batches.js') },
  { pattern: '/purchases', perm: 'purchases.view', load: () => import('./pages/purchases.js') },
  { pattern: '/purchases/new', perm: 'purchases.create', load: () => import('./pages/purchase-new.js') },
  { pattern: '/purchases/:id', perm: 'purchases.view', load: () => import('./pages/purchase-detail.js') },
  { pattern: '/reports', perm: 'reports.*', load: () => import('./pages/reports.js') },
  { pattern: '/sync', perm: 'sync.manage', load: () => import('./pages/sync.js') },
  { pattern: '/users', perm: 'users.view', load: () => import('./pages/users.js') },
  { pattern: '/audit', perm: 'audit.view', load: () => import('./pages/audit.js') },
  { pattern: '/settings', perm: 'settings.view', load: () => import('./pages/settings.js') },
  { pattern: '/transfers', perm: 'inventory.view', load: () => import('./pages/inventory-ops.js').then((m) => ({ default: m.transfers, title: 'التحويل بين المخازن' })) },
  { pattern: '/adjustments', perm: 'inventory.view', load: () => import('./pages/inventory-ops.js').then((m) => ({ default: m.adjustments, title: 'تسويات المخزون' })) },
  { pattern: '/companies', perm: 'companies.view', load: () => import('./pages/master.js').then((m) => ({ default: m.companies, title: 'الشركات' })) },
  { pattern: '/categories', perm: 'categories.view', load: () => import('./pages/master.js').then((m) => ({ default: m.categories, title: 'التصنيفات' })) },
  { pattern: '/warehouses', perm: 'warehouses.view', load: () => import('./pages/master.js').then((m) => ({ default: m.warehouses, title: 'المخازن' })) },
  { pattern: '/areas', perm: 'areas.view', load: () => import('./pages/master.js').then((m) => ({ default: m.areas, title: 'المناطق' })) },
  { pattern: '/representatives', perm: 'representatives.view', load: () => import('./pages/master.js').then((m) => ({ default: m.representatives, title: 'المندوبون' })) },
  { pattern: '/price-lists', perm: 'price_lists.view', load: () => import('./pages/master.js').then((m) => ({ default: m.priceLists, title: 'قوائم الأسعار' })) },
  { pattern: '/bonus-rules', perm: 'bonus_rules.view', load: () => import('./pages/master.js').then((m) => ({ default: m.bonusRules, title: 'قواعد البونص' })) },
  { pattern: '/notifications', perm: null, load: () => import('./pages/notifications.js') },
];

export function match(path) {
  for (const r of ROUTES) {
    const a = r.pattern.split('/');
    const b = path.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}
