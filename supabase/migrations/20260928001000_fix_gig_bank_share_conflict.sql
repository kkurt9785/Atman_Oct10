-- share_my_gig_bank_account 의 RETURNS TABLE 출력 변수 staff_id 와
-- ON CONFLICT(staff_id) 컬럼 해석 충돌을 제거한다.

CREATE OR REPLACE FUNCTION public.share_my_gig_bank_account(p_staff_id uuid)
RETURNS TABLE (
  staff_id uuid,
  bank_account_id uuid,
  bank_name text,
  account_last4 text,
  shared_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_staff public.facility_staff%ROWTYPE;
  v_bank public.worker_bank_accounts%ROWTYPE;
  v_share public.gig_bank_account_shares%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_worker_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT fs.* INTO v_staff
  FROM public.facility_staff fs
  JOIN public.facilities f ON f.id = fs.facility_id
  WHERE fs.id = p_staff_id
    AND fs.worker_id = v_worker_id
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND (f.facility_type = 'gigworker' OR f.registration_source = 'gigworker_trial');
  IF NOT FOUND THEN
    RAISE EXCEPTION '연결된 긱 근무를 찾을 수 없어요';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_attendances a
    WHERE a.staff_id = v_staff.id
      AND a.facility_id = v_staff.facility_id
      AND a.status = 'completed'
      AND a.check_in_at IS NOT NULL
      AND a.check_out_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '근무가 완료된 뒤 계좌를 전달할 수 있어요';
  END IF;

  SELECT b.* INTO v_bank
  FROM public.worker_bank_accounts b
  WHERE b.worker_id = v_worker_id
    AND b.is_primary = true
    AND b.deleted_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '먼저 지급 계좌를 등록해 주세요';
  END IF;

  INSERT INTO public.gig_bank_account_shares(
    facility_id, staff_id, worker_id, bank_account_id, shared_at, updated_at
  ) VALUES (
    v_staff.facility_id, v_staff.id, v_worker_id, v_bank.id, now(), now()
  )
  ON CONFLICT ON CONSTRAINT gig_bank_account_shares_staff_id_key DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    worker_id = EXCLUDED.worker_id,
    bank_account_id = EXCLUDED.bank_account_id,
    shared_at = now(),
    updated_at = now()
  RETURNING * INTO v_share;

  RETURN QUERY SELECT
    v_share.staff_id,
    v_share.bank_account_id,
    v_bank.bank_name,
    v_bank.account_number_last4,
    v_share.shared_at;
END;
$$;

REVOKE ALL ON FUNCTION public.share_my_gig_bank_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_my_gig_bank_account(uuid) TO authenticated;

SELECT to_regprocedure('public.share_my_gig_bank_account(uuid)') IS NOT NULL AS share_rpc_fixed;
