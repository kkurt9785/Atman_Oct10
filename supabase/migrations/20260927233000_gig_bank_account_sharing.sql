-- 긱워커 계좌는 가입 때 미리 저장하되, 근무 완료 후 워커가 해당 근무지에
-- 명시적으로 전달한 경우에만 관리자가 볼 수 있다.

CREATE TABLE IF NOT EXISTS public.gig_bank_account_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES public.worker_bank_accounts(id) ON DELETE RESTRICT,
  shared_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id)
);

CREATE INDEX IF NOT EXISTS idx_gig_bank_shares_facility
  ON public.gig_bank_account_shares(facility_id, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_gig_bank_shares_worker
  ON public.gig_bank_account_shares(worker_id, shared_at DESC);

ALTER TABLE public.gig_bank_account_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_bank_account_shares FROM anon, authenticated;
GRANT SELECT ON public.gig_bank_account_shares TO authenticated;

DROP POLICY IF EXISTS gig_bank_shares_worker_read ON public.gig_bank_account_shares;
CREATE POLICY gig_bank_shares_worker_read ON public.gig_bank_account_shares
  FOR SELECT USING (worker_id = public.current_worker_id());

DROP POLICY IF EXISTS gig_bank_shares_admin_read ON public.gig_bank_account_shares;
CREATE POLICY gig_bank_shares_admin_read ON public.gig_bank_account_shares
  FOR SELECT USING (public.facility_access_role(facility_id) IS NOT NULL);

-- 워커가 근무를 마친 뒤 현재 기본 계좌를 이 근무지에 전달한다.
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
  ON CONFLICT (staff_id) DO UPDATE SET
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

-- 민감한 전체 계좌번호는 서비스 키로 직접 읽지 않고, 권한 있는 해당 근무지
-- 관리자만 이 RPC를 통해 복호화해서 본다.
CREATE OR REPLACE FUNCTION public.get_gig_shared_bank_accounts(p_facility_id uuid)
RETURNS TABLE (
  staff_id uuid,
  bank_name text,
  account_number text,
  account_last4 text,
  account_holder_name text,
  shared_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.can_manage_facility(
    p_facility_id,
    ARRAY['owner','operator','super']::text[]
  ), false) THEN
    RAISE EXCEPTION '지급 계좌를 볼 권한이 없어요';
  END IF;

  RETURN QUERY
  SELECT
    s.staff_id,
    b.bank_name,
    extensions.pgp_sym_decrypt(b.account_number_encrypted, public.bank_encryption_key()),
    b.account_number_last4,
    b.account_holder_name,
    s.shared_at
  FROM public.gig_bank_account_shares s
  JOIN public.facility_staff fs
    ON fs.id = s.staff_id
   AND fs.facility_id = s.facility_id
   AND fs.worker_id = s.worker_id
  JOIN public.worker_bank_accounts b
    ON b.id = s.bank_account_id
   AND b.worker_id = s.worker_id
   AND b.is_primary = true
   AND b.deleted_at IS NULL
  WHERE s.facility_id = p_facility_id
  ORDER BY s.shared_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.share_my_gig_bank_account(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_gig_shared_bank_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_my_gig_bank_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gig_shared_bank_accounts(uuid) TO authenticated;

SELECT
  to_regclass('public.gig_bank_account_shares') IS NOT NULL AS gig_bank_share_table,
  to_regprocedure('public.share_my_gig_bank_account(uuid)') IS NOT NULL AS share_rpc,
  to_regprocedure('public.get_gig_shared_bank_accounts(uuid)') IS NOT NULL AS admin_bank_rpc;
