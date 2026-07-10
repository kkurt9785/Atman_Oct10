-- ============================================================================
-- ① QR replay 방지 — 스캔된 nonce 1회용 기록 (UNIQUE 위반 = 재사용 차단)
-- ② 암호화 fail-closed — 계좌 암호화 키 미설정 시 데모 키 폴백 대신 실패
--
-- ⚠️ 실행 전 필수: 운영 암호화 키 설정 (한 번만, 키는 안전한 곳에 보관)
--    ALTER DATABASE postgres SET app.bank_encryption_key = '<32자 이상 랜덤 키>';
--    (미설정 상태로 이 마이그레이션만 적용하면 계좌 등록이 에러로 막힘 = 의도된 fail-closed)
-- ============================================================================

-- ── ① QR 스캔 nonce 원장 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_scan_nonces (
  nonce TEXT PRIMARY KEY,
  application_id UUID,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE qr_scan_nonces ENABLE ROW LEVEL SECURITY;
-- 정책 없음 = service_role 전용

-- 오래된 nonce 정리용 인덱스 (QR TTL 60초 — 하루 지난 건 의미 없음)
CREATE INDEX IF NOT EXISTS idx_qr_nonce_scanned ON qr_scan_nonces(scanned_at);

-- ── ② 계좌 암호화 fail-closed ───────────────────────────────────────────────
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

  -- fail-closed: 운영 키 미설정이면 데모 키로 저장하지 않고 즉시 실패
  v_key := NULLIF(current_setting('app.bank_encryption_key', true), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'bank encryption key is not configured';
  END IF;

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
