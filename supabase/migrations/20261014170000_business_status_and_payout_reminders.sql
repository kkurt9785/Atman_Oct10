-- 2026-10-14
-- A) 구인자 확인(직업안정법 제25조, 2026-12-10 시행 개정): 사업자등록 상태를 국세청 조회로 기록한다.
--    앱이 조회 결과를 적고(business_status), 휴업·폐업이면 공고 등록이 막힌다. 근무자에겐 '사업자 확인된 사업장' 표시.
-- B) 지급 알림 크론: 오늘 지급 예정(근무자·사장님) · 지급 완료 3일 뒤 입금 미확인(근무자) · 못 받음 표시(사장님).

-- ── A. 사업자 상태 ────────────────────────────────────────────────────────────
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS business_status text CHECK (business_status IN ('active','suspended','closed','unknown')),
  ADD COLUMN IF NOT EXISTS business_status_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_status_detail text;
COMMENT ON COLUMN public.facilities.business_status IS '국세청 사업자등록 상태조회 결과: active 계속 · suspended 휴업 · closed 폐업 · unknown 미등록/조회 불가';
-- 근무자 앱이 '사업자 확인' 표시를 그릴 수 있게 두 컬럼만 읽기 허용(기존 컬럼 단위 허용과 같은 방식)
GRANT SELECT (approved_at, business_status) ON public.facilities TO authenticated;

-- ── B. 지급 알림 ─────────────────────────────────────────────────────────────
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
    WHERE p.status = 'scheduled' AND p.pay_at = v_today
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
      SELECT fa.user_id FROM public.facility_admin_access fa WHERE fa.facility_id = r.facility_id AND fa.access_role IN ('operator','super')
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
      AND w.auth_user_id IS NOT NULL
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

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gig-payout-reminders-daily';
SELECT cron.schedule('gig-payout-reminders-daily', '0 0 * * *', 'SELECT public.run_gig_payout_reminders();'); -- 09:00 KST

-- 못 받았다고 표시하면 사장님에게 바로 알린다 (20261014150000 정의를 통째로 교체)
CREATE OR REPLACE FUNCTION public.confirm_my_gig_payout(p_payout_id uuid, p_received boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid := public.current_worker_id();
  v_payout record;
BEGIN
  IF v_worker IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  SELECT p.id, p.facility_id, COALESCE(p.net_amount, p.amount)::numeric AS net, p.paid_at, fs.name AS worker_name, f.name AS facility_name
  INTO v_payout
  FROM public.gig_payouts p JOIN public.facility_staff fs ON fs.id = p.staff_id JOIN public.facilities f ON f.id = p.facility_id
  WHERE p.id = p_payout_id AND fs.worker_id = v_worker AND p.status = 'paid';
  IF v_payout.id IS NULL THEN RAISE EXCEPTION '확인할 지급 기록을 찾지 못했어요.'; END IF;

  UPDATE public.gig_payouts
  SET worker_confirm_status = CASE WHEN p_received THEN 'received' ELSE 'missing' END,
      worker_confirmed_at = now(),
      worker_confirm_note = NULLIF(left(COALESCE(p_note, ''), 200), ''),
      updated_at = now()
  WHERE id = p_payout_id;

  IF NOT p_received THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT a.uid, 'payout.missing', 'payout.missing:'||v_payout.id||':'||a.uid||':'||to_char(now(),'YYYYMMDDHH24MI'),
           v_payout.worker_name||'님이 아직 입금을 못 받았대요',
           to_char(v_payout.net, 'FM999,999,999')||'원 · '||to_char(timezone('Asia/Seoul', v_payout.paid_at), 'MM/DD')||' 지급 완료 처리 — 이체를 확인해 주세요.',
           jsonb_build_object('url','/gig-pay','payout_id',v_payout.id)
    FROM (
      SELECT f.admin_user_id AS uid FROM public.facilities f WHERE f.id = v_payout.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT fa.user_id FROM public.facility_admin_access fa WHERE fa.facility_id = v_payout.facility_id AND fa.access_role IN ('operator','super')
    ) a
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_my_gig_payout(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_my_gig_payout(uuid, boolean, text) TO authenticated;
