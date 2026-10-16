# ERD مبدئي (Mermaid)

```mermaid
erDiagram
  USERS ||--o{ USER_PERMISSIONS : has
  ROLES ||--o{ USERS : assigned
  ROLES ||--o{ ROLE_PERMISSIONS : grants
  PERMISSIONS ||--o{ ROLE_PERMISSIONS : in
  USERS ||--o{ USER_DEVICES : registers
  USERS ||--o| REPRESENTATIVES : is

  REPRESENTATIVES ||--o{ REP_AREAS : covers
  AREAS ||--o{ REP_AREAS : covered_by
  AREAS ||--o{ CUSTOMERS : contains
  CUSTOMERS ||--o{ CUSTOMER_REPS : assigned
  REPRESENTATIVES ||--o{ CUSTOMER_REPS : serves
  REPRESENTATIVES ||--o{ VISITS : makes
  CUSTOMERS ||--o{ VISITS : receives
  REPRESENTATIVES ||--o{ VISIT_PLANS : plans
  REPRESENTATIVES ||--o{ SALES_TARGETS : has

  COMPANIES ||--o{ PRODUCTS : makes
  CATEGORIES ||--o{ PRODUCTS : groups
  PRODUCTS ||--o{ BONUS_RULES : has
  PRODUCTS ||--o{ PRODUCT_BATCHES : has
  WAREHOUSES ||--o{ STOCK : holds
  PRODUCTS ||--o{ STOCK : in
  WAREHOUSES ||--o{ STOCK_MOVEMENTS : logs
  PRODUCTS ||--o{ STOCK_MOVEMENTS : logs
  PRICE_LISTS ||--o{ PRICE_LIST_ITEMS : contains
  CUSTOMERS ||--o| CUSTOMER_PRICE_LIST : uses

  CUSTOMERS ||--o{ SALES_ORDERS : places
  SALES_ORDERS ||--o{ SALES_ORDER_ITEMS : has
  CUSTOMERS ||--o{ INVOICES : billed
  INVOICES ||--o{ INVOICE_ITEMS : has
  INVOICE_ITEMS }o--|| BONUS_RULES : generated_by
  INVOICES ||--o{ RETURNS : reversed_by
  RETURNS ||--o{ RETURN_ITEMS : has
  INVOICE_ITEMS ||--o{ RETURN_ITEMS : returned_in
  CUSTOMERS ||--o{ PAYMENTS : pays
  CUSTOMERS ||--o{ LEDGER_ENTRIES : statement

  COMPANIES ||--o{ PURCHASE_ORDERS : supplies
  PURCHASE_ORDERS ||--o{ PURCHASE_ORDER_ITEMS : has

  USERS ||--o{ AUDIT_LOGS : performs
  USER_DEVICES ||--o{ SYNC_QUEUE : submits
  SYNC_QUEUE ||--o| CONFLICT_QUEUE : may_raise

  RETURN_ITEMS {
    uuid id
    uuid return_id
    uuid invoice_item_id
    enum line_type "SoldQty | Bonus"
    int quantity
    int unit_amount
    int credit_amount
    enum condition "Valid | Damaged | Expired"
    uuid batch_id
  }
  INVOICE_ITEMS {
    uuid id
    int quantity
    int bonus_quantity
    int returned_quantity
    int bonus_returned_quantity
    uuid bonus_rule_id
    int net_amount
  }
```

## قيود جوهرية
- `CHECK (returned_quantity <= quantity)` و`CHECK (bonus_returned_quantity <= bonus_quantity)`.
- `UNIQUE(idempotency_key)` على Returns/Payments/Orders/Visits القادمة من الموبايل.
- `LedgerEntries` و`AuditLogs` و`StockMovements`: Append-only (منع UPDATE/DELETE عبر صلاحيات DB وtriggers).
- sequences منفصلة: customer / product / order / invoice / payment / return.

## إضافات Phase 4 (Mermaid)
```mermaid
erDiagram
  CUSTOMERS ||--o{ SALES_ORDERS : places
  SALES_ORDERS ||--o{ SALES_ORDER_ITEMS : has
  SALES_ORDERS |o--o| INVOICES : converted_to
  CUSTOMERS ||--o{ INVOICES : billed
  INVOICES ||--o{ INVOICE_ITEMS : has
  INVOICES ||--o{ RETURNS : reversed_by
  RETURNS ||--o{ RETURN_ITEMS : has
  INVOICE_ITEMS ||--o{ RETURN_ITEMS : returned_in
  PRODUCTS ||--o{ BONUS_RULES : has
  WAREHOUSES ||--o{ STOCK : holds
  PRODUCTS ||--o{ STOCK : in
  STOCK_MOVEMENTS }o--|| WAREHOUSES : at
  STOCK_MOVEMENTS }o--|| PRODUCTS : of
  CUSTOMERS ||--o{ LEDGER_ENTRIES : statement
```
- `invoice_items`: `quantity` (مباع) و`bonus_quantity` (مجاني) منفصلان، و`returned_quantity` و`bonus_returned_quantity` تراكميان، و`bonus_rule_snapshot` لقطة القواعد.
- `return_items.line_type`: `Sold | Bonus | BonusBilled`.
- `ledger_entries`: الرصيد = `customers.opening_balance + Σdebit − Σcredit`.

## إضافات Phase 5 (Mermaid)
```mermaid
erDiagram
  WAREHOUSES ||--o{ STOCK_BATCHES : holds
  PRODUCTS ||--o{ STOCK_BATCHES : has
  INVOICE_ITEMS ||--o{ INVOICE_ITEM_BATCHES : drawn_from
  STOCK_BATCHES ||--o{ INVOICE_ITEM_BATCHES : used_by
  COMPANIES ||--o{ PURCHASE_ORDERS : supplies
  PURCHASE_ORDERS ||--o{ PURCHASE_ORDER_ITEMS : has
  WAREHOUSES ||--o{ STOCK_TRANSFERS : from_to
  STOCK_TRANSFERS ||--o{ STOCK_TRANSFER_ITEMS : has
  WAREHOUSES ||--o{ STOCK_ADJUSTMENTS : in
  STOCK_ADJUSTMENTS ||--o{ STOCK_ADJUSTMENT_ITEMS : has
```
- `Stock.quantity = Σ batch.quantity + مخزون بلا تشغيلة`، و`Stock.quantity = Σ الحركات الموقّعة`.
- `stock`: `average_cost` و`last_cost` (متوسط مرجّح لكل مخزن/منتج).

## إضافات Phase 6 (Mermaid)
```mermaid
erDiagram
  CUSTOMERS ||--o{ PAYMENTS : pays
  PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : allocated_as
  INVOICES ||--o{ PAYMENT_ALLOCATIONS : settled_by
  REPRESENTATIVES ||--o{ PAYMENTS : collects
```
- `payments.allocated_amount = Σ allocations`، والباقي رصيد على الحساب. `invoices.paid_amount = Σ allocations (للتسديدات المؤكدة)`.

## إضافات Phase 8 (Mermaid)
```mermaid
erDiagram
  USER_DEVICES ||--o{ SYNC_OPERATIONS : pushes
  USERS ||--o{ SYNC_OPERATIONS : owns
```
- `sync_operations(deviceId, localId)` فريد؛ `status`: `Pending | Applied | Conflict | Rejected | Failed | Discarded`؛ الحمولة `payload` تبقى دائماً.

## إضافات Phase 9 (Mermaid)
```mermaid
erDiagram
  USERS ||--o{ NOTIFICATIONS : receives
```
- `notifications(userId, dedupeKey)` فريد؛ `readAt` للمقروء.
