-- 2026-10-14 단기근로 기능 4·5 (docs/QA_2026-10-14_단기근로.md)
-- 4) 수락한 근무 조건 스냅샷: 초대 수락 시점의 조건(시급·시간·휴게·기간)을 근무자 행에 보관 — 전자 근로계약서의 전 단계.
--    사장님이 뒤에 조건을 바꿔도 근무자는 '수락한 조건'을 다시 볼 수 있다.
-- 5) 입금 확인: 근무자가 지급 완료 건에 '입금 확인했어요 / 아직 안 들어왔어요'를 남기고, 사장님 지급 화면에 표시된다.

-- ── 4. facility_staff.terms_snapshot ─────────────────────────────────────────
ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS terms_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS terms_snapshot_at timestamptz;
COMMENT ON COLUMN public.facility_staff.terms_snapshot IS '근무자가 초대를 수락한 시점의 근무 조건(시급·시간·휴게·기간 등). 수락 직후 한 번만 기록, 이후 조건 변경과 대조용.';

CREATE OR REPLACE FUNCTION public.snapshot_my_gig_terms(p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid := public.current_worker_id();
  v_staff public.facility_staff%ROWTYPE;
  v_facility_name text;
  v_snapshot jsonb;
BEGIN
  IF v_worker IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  SELECT * INTO v_staff FROM public.facility_staff WHERE id = p_staff_id AND worker_id = v_worker;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION '내 근무가 아니에요.'; END IF;
  IF v_staff.terms_snapshot IS NOT NULL THEN RETURN v_staff.terms_snapshot; END IF;
  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_staff.facility_id;
  v_snapshot := jsonb_build_object(
    'facilityName', v_facility_name,
    'payBasis', v_staff.pay_basis, 'payRate', v_staff.pay_rate,
    'startTime', v_staff.default_start_time, 'endTime', v_staff.default_end_time,
    'breakMinutes', v_staff.default_break_minutes, 'workWeekdays', v_staff.work_weekdays,
    'contractStart', v_staff.contract_start, 'contractEnd', v_staff.contract_end,
    'role', v_staff.role, 'workDescription', v_staff.department,
    'acceptedAt', now()
  );
  UPDATE public.facility_staff SET terms_snapshot = v_snapshot, terms_snapshot_at = now() WHERE id = v_staff.id;
  RETURN v_snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_my_gig_terms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snapshot_my_gig_terms(uuid) TO authenticated;

-- ── 5. gig_payouts 입금 확인 ────────────────────────────────────────────────
ALTER TABLE public.gig_payouts
  ADD COLUMN IF NOT EXISTS worker_confirm_status text CHECK (worker_confirm_status IN ('received','missing')),
  ADD COLUMN IF NOT EXISTS worker_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_confirm_note text;

CREATE OR REPLACE FUNCTION public.confirm_my_gig_payout(p_payout_id uuid, p_received boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid := public.current_worker_id();
  v_ok boolean;
BEGIN
  IF v_worker IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.gig_payouts p JOIN public.facility_staff fs ON fs.id = p.staff_id
    WHERE p.id = p_payout_id AND fs.worker_id = v_worker AND p.status = 'paid'
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION '확인할 지급 기록을 찾지 못했어요.'; END IF;
  UPDATE public.gig_payouts
  SET worker_confirm_status = CASE WHEN p_received THEN 'received' ELSE 'missing' END,
      worker_confirmed_at = now(),
      worker_confirm_note = NULLIF(left(COALESCE(p_note, ''), 200), ''),
      updated_at = now()
  WHERE id = p_payout_id;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_my_gig_payout(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_my_gig_payout(uuid, boolean, text) TO authenticated;
