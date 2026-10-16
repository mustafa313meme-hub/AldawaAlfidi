-- Least-privilege database roles. Run ONCE as the database owner, after the first migration:
--   psql "$OWNER_DATABASE_URL" -v app_password="'<strong password>'" -v dbname=silverpharma -f deploy/db-roles.sql
--
-- The API connects as silverpharma_app: it can read and write data but cannot change the schema, and it can NEVER update or
-- delete the books (audit log, stock movements, ledger). The triggers already refuse that; this is the second, independent lock.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'silverpharma_app') THEN
    CREATE ROLE silverpharma_app LOGIN;
  END IF;
END $$;
ALTER ROLE silverpharma_app PASSWORD :app_password;

GRANT CONNECT ON DATABASE :dbname TO silverpharma_app;
GRANT USAGE ON SCHEMA public TO silverpharma_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO silverpharma_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO silverpharma_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, stock_movements, ledger_entries FROM silverpharma_app;

-- tables created by future migrations get the same grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO silverpharma_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO silverpharma_app;
-- NOTE: after every migration that adds an append-only table, repeat the REVOKE for it.
