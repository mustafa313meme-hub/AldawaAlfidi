-- Idempotent business-rule constraints (run after every migrate deploy; see npm run db:deploy).
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_prices_check;
ALTER TABLE products ADD CONSTRAINT products_prices_check
  CHECK ("purchasePrice" >= 0 AND "salePrice" >= 0 AND "minSalePrice" >= 0 AND "minSalePrice" <= "salePrice" AND "packSize" >= 1);

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tax_check;
ALTER TABLE products ADD CONSTRAINT products_tax_check CHECK ("taxRate" >= 0 AND "taxRate" <= 100);

ALTER TABLE price_list_items DROP CONSTRAINT IF EXISTS price_list_items_price_check;
ALTER TABLE price_list_items ADD CONSTRAINT price_list_items_price_check CHECK (price >= 0);

-- At most one default price list.
CREATE UNIQUE INDEX IF NOT EXISTS price_lists_single_default ON price_lists ((true)) WHERE "isDefault";

-- ───── Phase 3 ─────
-- One responsible representative per area at any time.
CREATE UNIQUE INDEX IF NOT EXISTS representative_areas_one_open ON representative_areas ("areaId") WHERE "activeTo" IS NULL;
-- One open primary representative per customer.
CREATE UNIQUE INDEX IF NOT EXISTS customer_reps_one_open_primary ON customer_representatives ("customerId") WHERE "assignedTo" IS NULL AND "isPrimary";

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_geo_check;
ALTER TABLE customers ADD CONSTRAINT customers_geo_check CHECK (
  ("latitude" IS NULL) = ("longitude" IS NULL)
  AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  AND "creditLimit" >= 0);

ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_geo_check;
ALTER TABLE visits ADD CONSTRAINT visits_geo_check CHECK (
  ("latitude" IS NULL) = ("longitude" IS NULL)
  AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  AND ("accuracyM" IS NULL OR "accuracyM" >= 0)
  AND ("endTime" IS NULL OR "endTime" >= "startTime"));

ALTER TABLE sales_targets DROP CONSTRAINT IF EXISTS sales_targets_check;
ALTER TABLE sales_targets ADD CONSTRAINT sales_targets_check CHECK (
  "endDate" >= "startDate" AND "targetAmount" >= 0 AND "targetVisits" >= 0 AND "targetOrders" >= 0);

-- ───── Phase 4 ─────
ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_nonneg;
ALTER TABLE stock ADD CONSTRAINT stock_nonneg CHECK (quantity >= 0);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_qty;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_qty CHECK (quantity > 0);

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_nonneg;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_nonneg CHECK (debit >= 0 AND credit >= 0);

-- A return can never exceed what was sold / given as bonus (second line of defence behind the service checks).
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_returns_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_returns_check CHECK (
  quantity >= 1 AND "bonusQuantity" >= 0
  AND "returnedQuantity" >= 0 AND "returnedQuantity" <= quantity
  AND "bonusReturnedQuantity" >= 0 AND "bonusReturnedQuantity" <= "bonusQuantity"
  AND "unitPrice" >= 0 AND "grossAmount" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "grossAmount"
  AND "netAmount" = "grossAmount" - "discountAmount" AND "lineTotal" = "netAmount" + "taxAmount");

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amounts_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_check CHECK (
  "netTotal" >= 0 AND "paidAmount" >= 0 AND "returnedAmount" >= 0 AND "remainingAmount" >= 0);

ALTER TABLE bonus_rules DROP CONSTRAINT IF EXISTS bonus_rules_check;
ALTER TABLE bonus_rules ADD CONSTRAINT bonus_rules_check CHECK (
  "minQuantity" >= 1 AND "bonusQuantity" >= 1 AND ("endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate"));

-- Append-only: stock movements and ledger entries are corrected by new reversing rows, never edited.
DROP TRIGGER IF EXISTS stock_movements_append_only ON stock_movements;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ───── Phase 5 ─────
ALTER TABLE stock_batches DROP CONSTRAINT IF EXISTS stock_batches_nonneg;
ALTER TABLE stock_batches ADD CONSTRAINT stock_batches_nonneg CHECK (quantity >= 0 AND cost >= 0);

ALTER TABLE stock DROP CONSTRAINT IF EXISTS stock_cost_nonneg;
ALTER TABLE stock ADD CONSTRAINT stock_cost_nonneg CHECK ("averageCost" >= 0 AND "lastCost" >= 0);

ALTER TABLE invoice_item_batches DROP CONSTRAINT IF EXISTS invoice_item_batches_check;
ALTER TABLE invoice_item_batches ADD CONSTRAINT invoice_item_batches_check CHECK (
  quantity >= 0 AND "bonusQuantity" >= 0 AND "returnedQuantity" >= 0 AND "bonusReturnedQuantity" >= 0
  AND "returnedQuantity" <= quantity AND "bonusReturnedQuantity" <= "bonusQuantity");

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_items_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_items_check CHECK (
  quantity >= 1 AND "bonusQuantity" >= 0 AND "unitCost" >= 0 AND "discountAmount" >= 0
  AND "lineTotal" = quantity * "unitCost" - "discountAmount" AND "lineTotal" >= 0);

ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_distinct;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_distinct CHECK ("fromWarehouseId" <> "toWarehouseId");

ALTER TABLE stock_adjustment_items DROP CONSTRAINT IF EXISTS adjustment_delta_nonzero;
ALTER TABLE stock_adjustment_items ADD CONSTRAINT adjustment_delta_nonzero CHECK ("quantityDelta" <> 0);

-- ───── Phase 6 ─────
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amounts_check;
ALTER TABLE payments ADD CONSTRAINT payments_amounts_check CHECK (amount > 0 AND "allocatedAmount" >= 0 AND "allocatedAmount" <= amount);

ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_amount;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount CHECK (amount > 0);

-- An invoice can never be paid beyond its net total (returns may further reduce what is owed, never the stored paid sum).
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_paid_le_net;
ALTER TABLE invoices ADD CONSTRAINT invoices_paid_le_net CHECK ("paidAmount" <= "netTotal");

-- ───── Phase 7 ─────
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_reorder_check;
ALTER TABLE products ADD CONSTRAINT products_reorder_check CHECK ("reorderLevel" >= 0);

-- Report queries filter and group by these.
CREATE INDEX IF NOT EXISTS invoices_date_idx ON invoices ("invoiceDate");
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments ("paymentDate");
CREATE INDEX IF NOT EXISTS returns_date_idx ON returns ("returnDate");
CREATE INDEX IF NOT EXISTS stock_movements_created_idx ON stock_movements ("createdAt");
