-- Idempotent. Run after every `prisma migrate deploy` (see npm run db:deploy).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: append-only table', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
