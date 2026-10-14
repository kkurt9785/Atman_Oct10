-- 2026-10-14 운영 가능한 버전 — 사장님이 앱 안에서 끝낼 수 있어야 하는 두 가지
-- 1) 사업장 닫기(폐업·이용 종료): 공고 취소·초대 취소·직원 연결 종료·비활성. 근태·지급 기록은 지우지 않는다(임금대장 3년 보존).
-- 2) 관리자 계정 탈퇴: 운영 중인 사업장이 없을 때만. 권한 행 제거·닫힌 사업장의 소유자 연결 해제 뒤 앱이 auth 계정을 지운다.
-- 지금까지는 둘 다 '고객센터로 문의'였다.

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

-- ── 1. 사업장 닫기 ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_my_facility(p_facility_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f public.facilities%ROWTYPE;
  v_now timestamptz := now();
  v_kst timestamp := timezone('Asia/Seoul', now());
  v_cancelled integer := 0;
  v_ended integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  SELECT * INTO v_f FROM public.facilities WHERE id = p_facility_id FOR UPDATE;
  IF v_f.id IS NULL THEN RAISE EXCEPTION '사업장을 찾지 못했어요'; END IF;
  IF v_f.is_demo THEN RAISE EXCEPTION '시연 사업장은 닫을 수 없어요. 가입하고 내 사업장에서 써 보세요'; END IF;
  IF NOT (v_f.admin_user_id = v_uid OR EXISTS (
    SELECT 1 FROM public.facility_admin_access a WHERE a.facility_id = v_f.id AND a.user_id = v_uid AND a.access_role = 'super')) THEN
    RAISE EXCEPTION '사업장 소유자만 닫을 수 있어요';
  END IF;
  IF v_f.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  -- 남은 일이 있으면 먼저 정리하게 한다
  IF EXISTS (
    SELECT 1 FROM public.shifts s WHERE s.facility_id = v_f.id AND s.status IN ('matched','in_progress')
      AND (s.shift_date + s.end_time + CASE WHEN COALESCE(s.is_overnight,false) THEN interval '1 day' ELSE interval '0 day' END) > v_kst
  ) THEN RAISE EXCEPTION '확정된 근무가 남아 있어요. 근무가 끝나거나 취소된 뒤 닫아 주세요'; END IF;
  IF EXISTS (SELECT 1 FROM public.gig_payouts WHERE facility_id = v_f.id AND status = 'scheduled')
     OR EXISTS (SELECT 1 FROM public.wage_payment_instructions WHERE facility_id = v_f.id AND status IN ('draft','approved','exported','disputed'))
     OR EXISTS (SELECT 1 FROM public.staff_wage_payments WHERE facility_id = v_f.id AND status IN ('draft','approved','exported')) THEN
    RAISE EXCEPTION '지급 대기가 남아 있어요. 지급을 마치거나 취소한 뒤 닫아 주세요';
  END IF;

  -- 지원자·연결된 근무자에게 알린다(발송은 크론)
  INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
  SELECT w.auth_user_id, 'facility.closed', 'facility.closed:'||v_f.id||':app:'||a.id,
         v_f.name||' 공고가 닫혔어요', '사업장이 운영을 종료해 지원이 취소됐어요. 다른 공고를 찾아 주세요.',
         jsonb_build_object('url','/applications','facility_id',v_f.id)
  FROM public.shift_applications a JOIN public.shifts s ON s.id = a.shift_id JOIN public.workers w ON w.id = a.worker_id
  WHERE s.facility_id = v_f.id AND s.status = 'open' AND a.status IN ('invited','applied') AND w.auth_user_id IS NOT NULL
  ON CONFLICT (dedupe_key) DO NOTHING;
  INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
  SELECT w.auth_user_id, 'facility.closed', 'facility.closed:'||v_f.id||':staff:'||fs.id,
         v_f.name||'이(가) 운영을 종료했어요', '근무 연결이 끝났어요. 근태·지급 기록은 그대로 볼 수 있어요.',
         jsonb_build_object('url','/workplace','facility_id',v_f.id)
  FROM public.facility_staff fs JOIN public.workers w ON w.id = fs.worker_id
  WHERE fs.facility_id = v_f.id AND fs.status <> 'ended' AND w.auth_user_id IS NOT NULL
  ON CONFLICT (dedupe_key) DO NOTHING;

  -- 정리
  UPDATE public.shift_applications a SET status = 'cancelled', cancelled_at = v_now
  FROM public.shifts s WHERE s.id = a.shift_id AND s.facility_id = v_f.id AND s.status = 'open' AND a.status IN ('invited','applied');
  UPDATE public.shifts SET status = 'cancelled', cancelled_at = v_now, updated_at = v_now WHERE facility_id = v_f.id AND status = 'open';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  UPDATE public.facility_staff_invites SET status = 'cancelled' WHERE facility_id = v_f.id AND status = 'pending';
  UPDATE public.facility_staff SET status = 'ended', updated_at = v_now WHERE facility_id = v_f.id AND status <> 'ended';
  GET DIAGNOSTICS v_ended = ROW_COUNT;
  UPDATE public.facilities
  SET is_active = false, deleted_at = v_now, closed_at = v_now,
      closed_reason = NULLIF(left(COALESCE(p_reason, ''), 200), ''), updated_at = v_now
  WHERE id = v_f.id;

  INSERT INTO public.audit_logs(actor_type, actor_id, action, entity_type, entity_id, before_data)
  VALUES ('facility', v_uid, 'facility.close', 'facility', v_f.id,
          jsonb_build_object('reason', p_reason, 'cancelled_shifts', v_cancelled, 'ended_staff', v_ended));
  RETURN jsonb_build_object('ok', true, 'cancelledShifts', v_cancelled, 'endedStaff', v_ended);
END;
$$;
REVOKE ALL ON FUNCTION public.close_my_facility(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_my_facility(uuid, text) TO authenticated;

-- ── 2. 관리자 계정 탈퇴 ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_my_admin_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_keep_auth boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF public.is_demo_account(v_uid) THEN RAISE EXCEPTION '시연 계정은 탈퇴할 수 없어요'; END IF;
  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = v_uid AND deleted_at IS NULL AND is_active) THEN
    RAISE EXCEPTION '운영 중인 사업장이 있어요. 설정 › 계정·사업장 종료에서 사업장을 먼저 닫은 뒤 탈퇴해 주세요';
  END IF;
  -- 같은 계정에 근무자 프로필도 있으면 auth 계정은 남긴다(근무자 탈퇴는 근무자 앱에서)
  SELECT EXISTS (SELECT 1 FROM public.workers WHERE auth_user_id = v_uid AND deleted_at IS NULL) INTO v_keep_auth;

  DELETE FROM public.facility_admin_access WHERE user_id = v_uid;
  UPDATE public.facilities SET admin_user_id = NULL, updated_at = now() WHERE admin_user_id = v_uid; -- 닫힌 사업장 기록은 남김
  DELETE FROM public.push_subscriptions WHERE worker_id = v_uid;
  DELETE FROM public.notification_outbox WHERE worker_auth_user_id = v_uid AND status = 'pending';
  IF NOT v_keep_auth THEN
    UPDATE public.profiles SET role = NULL, onboarding_done = false, updated_at = now() WHERE id = v_uid;
  END IF;
  INSERT INTO public.audit_logs(actor_type, actor_id, action, entity_type, entity_id)
  VALUES ('facility', v_uid, 'admin.withdraw', 'user', v_uid);
  RETURN jsonb_build_object('ok', true, 'keepAuth', v_keep_auth);
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_my_admin_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_admin_account() TO authenticated;

-- 근무자 탈퇴 함수의 '고객센터로 문의' 안내 → 관리자 앱 설정으로 (없으면 건너뜀)
DO $patch$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'withdraw_my_account' LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, '관리자 탈퇴는 고객센터(010-9045-5699)로 문의해 주세요', '관리자 탈퇴는 관리자 앱 설정 › 계정·사업장 종료에서 해 주세요');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END
$patch$;
