const g = (group: string, actions: string[]): string[] => actions.map((a) => `${group}.${a}`);

export const PERMISSION_GROUPS: Record<string, string[]> = {
  users: ['view', 'create', 'update', 'delete', 'reset_password', 'manage_permissions'],
  roles: ['view', 'manage'],
  devices: ['view', 'revoke'],
  audit: ['view'],
  settings: ['view', 'update'],
  customers: ['view', 'create', 'update', 'delete', 'view_all', 'assign', 'manage_credit'],
  products: ['view', 'create', 'update', 'view_cost', 'view_prices'],
  categories: ['view', 'create', 'update'],
  price_lists: ['view', 'create', 'update'],
  companies: ['view', 'create', 'update'],
  warehouses: ['view', 'create', 'update'],
  areas: ['view', 'create', 'update', 'assign'],
  representatives: ['view', 'create', 'update'],
  visits: ['view', 'create', 'update', 'view_all'],
  visit_plans: ['view', 'manage'],
  targets: ['view', 'manage'],
  orders: ['view', 'create', 'approve', 'cancel'],
  invoices: ['view', 'create', 'edit', 'cancel', 'edit_price', 'discount', 'override_credit'],
  ledger: ['view'],
  bonus_rules: ['view', 'manage'],
  payments: ['view', 'create', 'edit', 'cancel'],
  returns: ['view', 'create', 'approve'],
  inventory: ['view', 'adjust', 'transfer'],
  purchases: ['view', 'create', 'receive', 'cancel'],
  reports: ['sales', 'inventory', 'financial', 'representatives'],
  sync: ['use', 'manage'],
};

export const ALL_PERMISSIONS: string[] = Object.entries(PERMISSION_GROUPS).flatMap(([grp, acts]) => g(grp, acts));

export const SUPER_ADMIN_ROLE = 'super_admin';

const all = (grp: string) => g(grp, PERMISSION_GROUPS[grp]);

export const DEFAULT_ROLES: Record<string, { description: string; permissions: string[] }> = {
  super_admin: { description: 'صلاحية كاملة', permissions: ALL_PERMISSIONS },
  admin: {
    description: 'إدارة النظام والبيانات التشغيلية',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'roles.manage'),
  },
  accountant: {
    description: 'الفواتير والحسابات والتسديدات والمردودات والتقارير المالية',
    permissions: [
      'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.cancel', 'invoices.discount', 'ledger.view', 'bonus_rules.view',
      ...all('payments'), ...all('returns'),
      'reports.sales', 'reports.financial', 'customers.view', 'customers.view_all', 'customers.manage_credit', 'orders.view', 'products.view',
      'products.view_cost', 'products.view_prices', 'price_lists.view', 'categories.view', 'companies.view', 'warehouses.view', 'purchases.view', 'inventory.view',
    ],
  },
  warehouse_manager: {
    description: 'المخزون والاستلام والصرف والتحويل والجرد',
    permissions: [
      ...all('inventory'), ...all('warehouses'), 'purchases.view', 'purchases.create', 'purchases.receive',
      'products.view', 'orders.view', 'invoices.view', 'returns.view', 'reports.inventory',
      'categories.view', 'companies.view',
    ],
  },
  sales_supervisor: {
    description: 'المندوبون والمناطق والزيارات والطلبات والأهداف',
    permissions: [
      'representatives.view', 'representatives.update', ...all('areas'),
      'visits.view', 'visits.view_all', 'visits.update', 'visit_plans.view', 'visit_plans.manage', 'targets.view', 'targets.manage',
      'customers.view_all', 'customers.assign', 'sync.use', 'sync.manage', 'orders.view', 'orders.approve', 'orders.cancel', 'invoices.view', 'ledger.view', 'bonus_rules.view',
      'customers.view', 'customers.create', 'customers.update', 'products.view',
      'products.view_prices', 'price_lists.view', 'categories.view', 'companies.view',
      'reports.sales', 'reports.representatives',
    ],
  },
  representative: {
    description: 'مندوب: عملاؤه ومناطقه وزياراته وطلباته (التحصيل يُمنح بصلاحية إضافية)',
    permissions: [
      'sync.use', 'customers.view', 'products.view', 'products.view_prices', 'categories.view', 'companies.view', 'orders.view', 'orders.create',
      'visits.view', 'visits.create', 'visits.update', 'visit_plans.view', 'targets.view', 'invoices.view', 'payments.view', 'ledger.view',
    ],
  },
  viewer: {
    description: 'قراءة التقارير والبيانات المسموح بها فقط',
    permissions: ['reports.sales', 'reports.inventory', 'customers.view', 'products.view', 'categories.view'],
  },
};

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  bonus_return_policy: 'Proportional',
  require_location_for_visit: false,
  currency: 'IQD',
  visit_max_accuracy_m: 100,
  visit_max_distance_m: 300,
  visit_block_when_far: false,
  overdue_days: 30,
};
