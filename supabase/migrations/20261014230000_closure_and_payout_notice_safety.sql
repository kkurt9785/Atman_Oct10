-- Local review fixes. Full definitions, no runtime string patches.
-- Depends on 180000 attendance ledger. Production application requires separate approval.
-- This does not replace the cross-session / complete migration-replay release gate.
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
  IF NOT (COALESCE(v_f.admin_user_id = v_uid, false) OR EXISTS (
    SELECT 1 FROM public.facility_admin_access a WHERE a.facility_id = v_f.id AND a.user_id = v_uid AND a.access_role = 'super')) THEN
    RAISE EXCEPTION '사업장 소유자만 닫을 수 있어요';
  END IF;
  IF v_f.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;

  -- Serialize against payout/attendance correction paths that also lock staff first.
  PERFORM id FROM public.facility_staff WHERE facility_id = v_f.id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.staff_attendances
    WHERE facility_id = v_f.id AND check_in_at IS NOT NULL AND check_out_at IS NULL
      AND status <> 'cancelled') THEN
    RAISE EXCEPTION '퇴근하지 않은 근무가 있어요. 출퇴근 기록을 먼저 확인해 주세요';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_attendances a
    JOIN public.facility_staff fs ON fs.id = a.staff_id
    WHERE a.facility_id = v_f.id AND fs.worker_kind = 'gig' AND a.status = 'completed'
      AND a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.gig_payouts p WHERE p.staff_id = a.staff_id AND p.status = 'paid'
          AND ((p.attendance_ids IS NOT NULL AND a.id = ANY(p.attendance_ids))
            OR (p.attendance_ids IS NULL AND a.work_date BETWEEN p.period_start AND p.period_end
              AND (p.covered_until IS NULL OR a.check_out_at <= p.covered_until)))
      )
  ) THEN RAISE EXCEPTION '지급 확인이 안 된 단기 근무가 있어요. 지급 관리에서 먼저 정리해 주세요'; END IF;

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
REVOKE ALL ON FUNCTION public.close_my_facility(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_my_facility(uuid,text) TO authenticated;

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
  PERFORM id FROM public.facilities WHERE admin_user_id = v_uid ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = v_uid AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '운영 중인 사업장이 있어요. 설정 › 계정·사업장 종료에서 사업장을 먼저 닫은 뒤 탈퇴해 주세요';
  END IF;
  -- 같은 계정에 근무자 프로필도 있으면 auth 계정은 남긴다(근무자 탈퇴는 근무자 앱에서)
  SELECT EXISTS (SELECT 1 FROM public.workers WHERE auth_user_id = v_uid AND deleted_at IS NULL) INTO v_keep_auth;

  DELETE FROM public.facility_admin_access WHERE user_id = v_uid;
  UPDATE public.facilities SET admin_user_id = NULL, updated_at = now() WHERE admin_user_id = v_uid; -- 닫힌 사업장 기록은 남김
  -- Shared worker/admin identities must keep worker notifications and subscriptions.
  IF NOT v_keep_auth THEN
    DELETE FROM public.push_subscriptions WHERE worker_id = v_uid;
    DELETE FROM public.notification_outbox WHERE worker_auth_user_id = v_uid AND status = 'pending';
    UPDATE public.profiles SET role = NULL, onboarding_done = false, updated_at = now() WHERE id = v_uid;
  END IF;
  INSERT INTO public.audit_logs(actor_type, actor_id, action, entity_type, entity_id)
  VALUES ('facility', v_uid, 'admin.withdraw', 'user', v_uid);
  RETURN jsonb_build_object('ok', true, 'keepAuth', v_keep_auth);
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_my_admin_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_admin_account() TO authenticated;

CREATE OR REPLACE FUNCTION public.run_gig_payout_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_due integer := 0;
  v_confirm integer := 0;
  r record;
BEGIN
  -- 1) 오늘 지급 예정 → 근무자 + 사장님(소유자·운영 권한)
  FOR r IN
    SELECT p.id, COALESCE(p.net_amount, p.amount)::numeric AS net, p.facility_id, fs.name AS worker_name,
           w.auth_user_id AS worker_uid, f.name AS facility_name
    FROM public.gig_payouts p
    JOIN public.facility_staff fs ON fs.id = p.staff_id
    LEFT JOIN public.workers w ON w.id = fs.worker_id
    JOIN public.facilities f ON f.id = p.facility_id
    WHERE p.status = 'scheduled' AND p.pay_at = v_today AND w.deleted_at IS NULL
  LOOP
    IF r.worker_uid IS NOT NULL THEN
      INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
      VALUES (r.worker_uid, 'payout.due', 'payout.due:'||r.id,
              r.facility_name||' 오늘 지급 예정',
              to_char(r.net, 'FM999,999,999')||'원이 오늘 지급 예정이에요. 입금되면 확인을 눌러 주세요.',
              jsonb_build_object('url','/gig/settlement','payout_id',r.id))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT a.uid, 'payout.due.admin', 'payout.due.admin:'||r.id||':'||a.uid,
           '오늘 지급 예정 · '||r.worker_name||' '||to_char(r.net, 'FM999,999,999')||'원',
           '이체한 뒤 지급 관리에서 지급 완료를 눌러 주세요.',
           jsonb_build_object('url','/gig-pay','payout_id',r.id)
    FROM (
      SELECT f.admin_user_id AS uid FROM public.facilities f WHERE f.id = r.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT fa.user_id FROM public.facility_admin_access fa WHERE fa.facility_id = r.facility_id AND fa.access_role IN ('operator','super') AND fa.can_view_payroll IS TRUE
    ) a
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_due := v_due + 1;
  END LOOP;

  -- 2) 지급 완료 3일 뒤에도 입금 확인이 없으면 근무자에게 한 번
  FOR r IN
    SELECT p.id, COALESCE(p.net_amount, p.amount)::numeric AS net, p.paid_at, w.auth_user_id AS worker_uid, f.name AS facility_name
    FROM public.gig_payouts p
    JOIN public.facility_staff fs ON fs.id = p.staff_id
    JOIN public.workers w ON w.id = fs.worker_id
    JOIN public.facilities f ON f.id = p.facility_id
    WHERE p.status = 'paid' AND p.worker_confirm_status IS NULL AND p.paid_at IS NOT NULL
      AND p.paid_at <= now() - interval '3 days' AND p.paid_at >= now() - interval '30 days'
      AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL
  LOOP
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (r.worker_uid, 'payout.confirm', 'payout.confirm:'||r.id,
            '입금 확인해 주세요',
            r.facility_name||'에서 '||to_char(r.net, 'FM999,999,999')||'원을 '||to_char(timezone('Asia/Seoul', r.paid_at), 'MM/DD')||'에 지급 완료로 처리했어요. 통장에 들어왔는지 확인을 눌러 주세요.',
            jsonb_build_object('url','/gig/settlement','payout_id',r.id))
    ON CONFLICT (dedupe_key) DO NOTHING;
    v_confirm := v_confirm + 1;
  END LOOP;
  RETURN jsonb_build_object('due', v_due, 'confirm', v_confirm);
END;
$$;
REVOKE ALL ON FUNCTION public.run_gig_payout_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_gig_payout_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_my_gig_payout(p_payout_id uuid, p_received boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid := public.current_worker_id();
  v_payout record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF v_worker IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  IF p_received IS NULL THEN RAISE EXCEPTION '입금 확인 상태를 선택해 주세요.'; END IF;
  -- Match the ledger trigger's staff -> payout lock order.
  PERFORM fs.id FROM public.facility_staff fs
    JOIN public.gig_payouts p ON p.staff_id = fs.id
    WHERE p.id = p_payout_id AND fs.worker_id = v_worker FOR UPDATE OF fs;
  SELECT p.worker_confirm_status, p.id, p.facility_id, COALESCE(p.net_amount, p.amount)::numeric AS net, p.paid_at, fs.name AS worker_name, f.name AS facility_name
  INTO v_payout
  FROM public.gig_payouts p JOIN public.facility_staff fs ON fs.id = p.staff_id JOIN public.facilities f ON f.id = p.facility_id
  WHERE p.id = p_payout_id AND fs.worker_id = v_worker AND p.status = 'paid' FOR UPDATE OF p;
  IF v_payout.id IS NULL THEN RAISE EXCEPTION '확인할 지급 기록을 찾지 못했어요.'; END IF;

  UPDATE public.gig_payouts
  SET worker_confirm_status = CASE WHEN p_received THEN 'received' ELSE 'missing' END,
      worker_confirmed_at = v_now,
      worker_confirm_note = NULLIF(left(COALESCE(p_note, ''), 200), ''),
      updated_at = now()
  WHERE id = p_payout_id;

  IF NOT p_received AND v_payout.worker_confirm_status IS DISTINCT FROM 'missing' THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT a.uid, 'payout.missing', 'payout.missing:'||v_payout.id||':'||a.uid||':'||v_now::text,
           v_payout.worker_name||'님이 아직 입금을 못 받았대요',
           to_char(v_payout.net, 'FM999,999,999')||'원 · '||to_char(timezone('Asia/Seoul', v_payout.paid_at), 'MM/DD')||' 지급 완료 처리 — 이체를 확인해 주세요.',
           jsonb_build_object('url','/gig-pay','payout_id',v_payout.id)
    FROM (
      SELECT f.admin_user_id AS uid FROM public.facilities f WHERE f.id = v_payout.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT fa.user_id FROM public.facility_admin_access fa WHERE fa.facility_id = v_payout.facility_id AND fa.access_role IN ('operator','super') AND fa.can_view_payroll IS TRUE
    ) a
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_my_gig_payout(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_my_gig_payout(uuid,boolean,text) TO authenticated;
