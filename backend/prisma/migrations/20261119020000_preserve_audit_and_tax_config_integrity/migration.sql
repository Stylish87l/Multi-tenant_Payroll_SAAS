-- Audit records are append-only and must not be silently rewritten by FK actions.
DO $$
DECLARE fk_name text;
BEGIN
  FOR fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'audit_logs'::regclass
      AND contype = 'f'
      AND confrelid IN ('users'::regclass, 'companies'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', fk_name);
  END LOOP;
END $$;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_userId_fkey
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT audit_logs_companyId_fkey
    FOREIGN KEY ("companyId") REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant-scoped tax row must never become a global row when its company is deleted.
DO $
DECLARE fk_name text;
BEGIN
  FOR fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tax_configs'::regclass
      AND contype = 'f'
      AND confrelid = 'companies'::regclass
  LOOP
    EXECUTE format('ALTER TABLE tax_configs DROP CONSTRAINT %I', fk_name);
  END LOOP;
END $;

ALTER TABLE tax_configs
  ADD CONSTRAINT "tax_configs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are prohibited';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
