-- Worker web profile support columns and bank-account RPC.
-- Keeps existing worker-web profile screens compatible with the database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS license_number TEXT,
  ADD COLUMN IF NOT EXISTS license_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS experience_years TEXT,
  ADD COLUMN IF NOT EXISTS last_workplace TEXT,
  ADD COLUMN IF NOT EXISTS department_tags TEXT[] DEFAULT '{}';

CREATE OR REPLACE FUNCTION upsert_my_bank_account(
  p_bank_code TEXT,
  p_bank_name TEXT,
  p_account_number TEXT,
  p_account_holder_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id UUID;
  v_key TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT id INTO v_worker_id
  FROM workers
  WHERE auth_user_id = auth.uid()
    AND deleted_at IS NULL;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'worker not found';
  END IF;

  v_key := COALESCE(NULLIF(current_setting('app.bank_encryption_key', true), ''), 'demo-only-bank-key');

  UPDATE worker_bank_accounts
  SET is_primary = false,
      deleted_at = COALESCE(deleted_at, now())
  WHERE worker_id = v_worker_id
    AND is_primary = true
    AND deleted_at IS NULL;

  INSERT INTO worker_bank_accounts (
    worker_id,
    bank_code,
    bank_name,
    account_number_encrypted,
    account_number_last4,
    account_holder_name,
    verification_status,
    one_won_sent_at,
    is_primary
  ) VALUES (
    v_worker_id,
    p_bank_code,
    p_bank_name,
    pgp_sym_encrypt(p_account_number, v_key),
    right(p_account_number, 4),
    p_account_holder_name,
    'sent',
    now(),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_my_bank_account(TEXT, TEXT, TEXT, TEXT) TO authenticated;
