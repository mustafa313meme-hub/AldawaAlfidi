-- Integrity checks on a restored (or live) database. Any inconsistency raises an exception.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-restore.sql
DO $$
DECLARE n bigint;
BEGIN
  -- stock = sum of signed movements
  SELECT COUNT(*) INTO n FROM (
    SELECT COALESCE(s."warehouseId", m."warehouseId") FROM stock s
    FULL OUTER JOIN (SELECT "warehouseId", "productId",
        SUM(CASE WHEN "movementType" IN ('Purchase','ReturnIn','TransferIn','AdjustmentIn','OpeningBalance') THEN quantity ELSE -quantity END) AS net
        FROM stock_movements GROUP BY 1, 2) m ON m."warehouseId" = s."warehouseId" AND m."productId" = s."productId"
    WHERE COALESCE(s.quantity, 0) <> COALESCE(m.net, 0)) t;
  IF n > 0 THEN RAISE EXCEPTION 'stock differs from the sum of movements in % rows', n; END IF;

  -- batches never exceed stock
  SELECT COUNT(*) INTO n FROM (SELECT b."warehouseId", b."productId" FROM stock_batches b
    JOIN stock s ON s."warehouseId" = b."warehouseId" AND s."productId" = b."productId"
    GROUP BY b."warehouseId", b."productId", s.quantity HAVING SUM(b.quantity) > s.quantity) t;
  IF n > 0 THEN RAISE EXCEPTION 'batch quantities exceed stock in % rows', n; END IF;

  -- invoice paid amount = allocations of confirmed payments
  SELECT COUNT(*) INTO n FROM invoices i LEFT JOIN (
      SELECT pa."invoiceId", SUM(pa.amount) AS s FROM payment_allocations pa JOIN payments p ON p.id = pa."paymentId" WHERE p.status = 'Confirmed' GROUP BY 1) a ON a."invoiceId" = i.id
    WHERE i."paidAmount" <> COALESCE(a.s, 0);
  IF n > 0 THEN RAISE EXCEPTION 'invoice paidAmount differs from allocations in % invoices', n; END IF;

  -- every invoice has a ledger debit equal to its net total
  SELECT COUNT(*) INTO n FROM invoices i LEFT JOIN (
      SELECT "referenceId", SUM(debit) AS d FROM ledger_entries WHERE "entryType" = 'Invoice' AND "referenceType" = 'Invoice' GROUP BY 1) l ON l."referenceId" = i.id
    WHERE COALESCE(l.d, 0) <> i."netTotal";
  IF n > 0 THEN RAISE EXCEPTION 'invoice net total differs from the ledger in % invoices', n; END IF;

  -- every confirmed payment has a ledger credit equal to its amount
  SELECT COUNT(*) INTO n FROM payments p LEFT JOIN (
      SELECT "referenceId", SUM(credit) AS c FROM ledger_entries WHERE "entryType" = 'Payment' AND "referenceType" = 'Payment' GROUP BY 1) l ON l."referenceId" = p.id
    WHERE COALESCE(l.c, 0) <> p.amount;
  IF n > 0 THEN RAISE EXCEPTION 'payment amount differs from the ledger in % payments', n; END IF;

  -- returned quantities never exceed sold quantities
  SELECT COUNT(*) INTO n FROM invoice_items WHERE "returnedQuantity" > quantity OR "bonusReturnedQuantity" > "bonusQuantity";
  IF n > 0 THEN RAISE EXCEPTION 'returned quantity exceeds sold quantity in % lines', n; END IF;

  RAISE NOTICE 'verify: all integrity checks passed';
END $$;

SELECT 'users' AS what, COUNT(*) FROM users UNION ALL SELECT 'customers', COUNT(*) FROM customers UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'payments', COUNT(*) FROM payments UNION ALL SELECT 'returns', COUNT(*) FROM returns UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL SELECT 'ledger_entries', COUNT(*) FROM ledger_entries UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
