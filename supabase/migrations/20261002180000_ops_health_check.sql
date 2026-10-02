-- 매일 자동 점검 — 조용히 실패하던 것을 아침에 알린다
--
-- ops_health_report(): DB 쪽 점검 결과를 항목별로 돌려준다 (level: ok | warn | error).
--   · 자동 작업(pg_cron): 최근 24시간 실패, 26시간 넘게 성공 기록이 없는 작업
--   · 알림: 30분 넘게 못 나간 알림, 24시간 내 실패
--   · 데이터 정합성: 확정인데 확정 근무자가 없는 근무, 확정자 불일치, 취소된 근무에 남은 확정,
--                     닫힌 근무에 남은 결원 요청, 탈퇴했는데 로그인 계정 연결이 남은 근무자
--   · 시연: 오늘 시연 근무 생성 여부, 데모 사업장 요금제
-- 항목 하나가 오류로 멈춰도 나머지는 계속 점검한다(항목별 예외 처리).
-- 결과 저장(ops_health_runs)과 사이트 응답 확인·운영자 알림은 admin-web /api/cron/health-check 가 한다.

CREATE TABLE IF NOT EXISTS public.ops_health_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ok', 'warn', 'error')),
  checks jsonb NOT NULL,
  trigger text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual'))
);
CREATE INDEX IF NOT EXISTS ops_health_runs_ran_at ON public.ops_health_runs (ran_at DESC);
ALTER TABLE public.ops_health_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_health_runs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.ops_health_report()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_checks jsonb := '[]'::jsonb;
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_now_kst timestamp := timezone('Asia/Seoul', now());
  v_count integer;
  v_detail text;
  v_rows jsonb;
BEGIN
  -- 자동 작업 실패 (최근 24시간)
  BEGIN
    EXECUTE $q$
      SELECT count(*)::int, string_agg(DISTINCT j.jobname, ', ')
      FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
      WHERE d.start_time > now() - interval '24 hours' AND d.status = 'failed'
    $q$ INTO v_count, v_detail;
    v_checks := v_checks || jsonb_build_object('key', 'cron_failed', 'label', '자동 작업 실패(24시간)',
      'level', CASE WHEN v_count > 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', v_detail);
  EXCEPTION WHEN others THEN
    v_checks := v_checks || jsonb_build_object('key', 'cron_failed', 'label', '자동 작업 실패(24시간)', 'level', 'warn', 'count', null, 'detail', '점검 불가: ' || SQLERRM);
  END;

  -- 26시간 넘게 성공 기록이 없는 자동 작업 (모든 작업은 하루 한 번 이상 돈다)
  BEGIN
    -- 돌던 작업이 멈춘 것만 오류로 — 새로 만들어 아직 한 번도 안 돈 작업은 주의
    EXECUTE $q$
      SELECT count(*)::int, string_agg(j.jobname, ', ')
      FROM cron.job j
      WHERE j.active
        AND EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid)
        AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid AND d.status = 'succeeded' AND d.start_time > now() - interval '26 hours')
    $q$ INTO v_count, v_detail;
    v_checks := v_checks || jsonb_build_object('key', 'cron_stale', 'label', '하루 넘게 멈춘 자동 작업',
      'level', CASE WHEN v_count > 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', v_detail);
    EXECUTE $q$
      SELECT count(*)::int, string_agg(j.jobname, ', ')
      FROM cron.job j
      WHERE j.active AND NOT EXISTS (SELECT 1 FROM cron.job_run_details d WHERE d.jobid = j.jobid)
    $q$ INTO v_count, v_detail;
    v_checks := v_checks || jsonb_build_object('key', 'cron_never_ran', 'label', '아직 한 번도 안 돈 자동 작업',
      'level', CASE WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', v_detail);
  EXCEPTION WHEN others THEN
    v_checks := v_checks || jsonb_build_object('key', 'cron_stale', 'label', '하루 넘게 안 돈 자동 작업', 'level', 'warn', 'count', null, 'detail', '점검 불가: ' || SQLERRM);
  END;

  -- 알림 밀림·실패
  BEGIN
    SELECT count(*)::int INTO v_count FROM public.notification_outbox
    WHERE status IN ('pending', 'processing') AND created_at < now() - interval '30 minutes' AND next_attempt_at < now();
    v_checks := v_checks || jsonb_build_object('key', 'outbox_stuck', 'label', '30분 넘게 못 나간 알림',
      'level', CASE WHEN v_count >= 20 THEN 'error' WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', null);
    SELECT count(*)::int, max(last_error) INTO v_count, v_detail FROM public.notification_outbox
    WHERE status = 'failed' AND created_at > now() - interval '24 hours';
    v_checks := v_checks || jsonb_build_object('key', 'outbox_failed', 'label', '실패한 알림(24시간)',
      'level', CASE WHEN v_count >= 20 THEN 'error' WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', left(v_detail, 200));
  EXCEPTION WHEN others THEN
    v_checks := v_checks || jsonb_build_object('key', 'outbox', 'label', '알림 발송', 'level', 'warn', 'count', null, 'detail', '점검 불가: ' || SQLERRM);
  END;

  -- 데이터 정합성
  BEGIN
    SELECT count(*)::int INTO v_count FROM public.shifts s
    WHERE s.status IN ('matched', 'in_progress') AND s.shift_date >= v_today - 7
      AND NOT EXISTS (SELECT 1 FROM public.shift_applications a WHERE a.shift_id = s.id AND a.status IN ('accepted', 'completed'));
    v_checks := v_checks || jsonb_build_object('key', 'matched_without_worker', 'label', '확정인데 확정 근무자가 없는 근무',
      'level', CASE WHEN v_count > 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.shifts s
    JOIN public.shift_applications a ON a.shift_id = s.id AND a.status = 'accepted'
    WHERE s.status IN ('matched', 'in_progress') AND s.shift_date >= v_today - 7
      AND s.matched_worker_id IS DISTINCT FROM a.worker_id;
    v_checks := v_checks || jsonb_build_object('key', 'matched_worker_mismatch', 'label', '근무 확정자와 확정 지원자 불일치',
      'level', CASE WHEN v_count > 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.shifts s
    JOIN public.shift_applications a ON a.shift_id = s.id AND a.status = 'accepted'
    WHERE s.status = 'cancelled' AND s.shift_date >= v_today;
    v_checks := v_checks || jsonb_build_object('key', 'cancelled_with_accepted', 'label', '취소된 근무에 남은 확정',
      'level', CASE WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.status = 'invited' AND a.confirm_on_accept AND s.status <> 'open';
    v_checks := v_checks || jsonb_build_object('key', 'stale_vacancy_invites', 'label', '닫힌 근무에 남은 결원 요청',
      'level', CASE WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.shift_cover_requests c
    JOIN public.shifts s ON s.id = c.shift_id
    WHERE c.status IN ('open', 'claimed') AND (s.shift_date + s.start_time) < v_now_kst;
    v_checks := v_checks || jsonb_build_object('key', 'stale_cover_requests', 'label', '시작 시간이 지난 대타 요청',
      'level', CASE WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.workers WHERE deleted_at IS NOT NULL AND auth_user_id IS NOT NULL;
    v_checks := v_checks || jsonb_build_object('key', 'withdrawn_still_linked', 'label', '탈퇴했는데 로그인 계정이 남은 근무자',
      'level', CASE WHEN v_count > 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', null);
  EXCEPTION WHEN others THEN
    v_checks := v_checks || jsonb_build_object('key', 'integrity', 'label', '데이터 정합성', 'level', 'warn', 'count', null, 'detail', '점검 불가: ' || SQLERRM);
  END;

  -- 시연
  BEGIN
    SELECT count(*)::int INTO v_count FROM public.shifts WHERE notes LIKE 'DEMO-SHOWCASE-MATCHED-%' AND shift_date = v_today;
    v_checks := v_checks || jsonb_build_object('key', 'demo_reseed', 'label', '오늘 시연 데이터 생성',
      'level', CASE WHEN v_count = 0 THEN 'error' ELSE 'ok' END, 'count', v_count, 'detail', null);

    SELECT count(*)::int INTO v_count FROM public.facilities f
    WHERE f.is_demo AND f.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.facility_subscriptions fs
                      WHERE fs.facility_id = f.id AND fs.status = 'active' AND fs.trial_ends_at IS NULL);
    v_checks := v_checks || jsonb_build_object('key', 'demo_plans', 'label', '요금제가 꺼진 시연 사업장',
      'level', CASE WHEN v_count > 0 THEN 'warn' ELSE 'ok' END, 'count', v_count, 'detail', null);
  EXCEPTION WHEN others THEN
    v_checks := v_checks || jsonb_build_object('key', 'demo', 'label', '시연', 'level', 'warn', 'count', null, 'detail', '점검 불가: ' || SQLERRM);
  END;

  RETURN v_checks;
END;
$$;
REVOKE ALL ON FUNCTION public.ops_health_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_health_report() TO service_role;
