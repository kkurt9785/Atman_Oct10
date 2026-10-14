-- 2026-10-14 저녁 — 시연 자동화 정책 확정
-- 200000 의 refresh_demo_worker_readiness 는 15분마다 라이브 시연 사업장 3곳의 모든 시연 공고(DEMO-SHOWCASE-OPEN 포함)를
-- '지금+15분~45분' 창으로 옮겼다. 병원·조무사 시연의 근무표(D·E·N)와 공고 목록이 깨지므로,
-- 옮기는 대상은 라이브 시연 공고(LIVE-SALES-DEMO-%)로 좁히고 나머지는 매일 08:30 revive 가 다시 만든다.
-- 긱 페르소나 근무시간을 지금 기준으로 맞추는 부분(출근·퇴근 창 보장)은 그대로 둔다.

CREATE OR REPLACE FUNCTION public.refresh_demo_worker_readiness()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_now timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_start timestamp; v_end timestamp;
  v_workers integer; v_shifts integer; v_staff integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('demo-worker-readiness'));
  v_start := date_trunc('hour',v_now) + (floor(extract(minute FROM v_now)/15)+1)*interval '15 minutes';
  v_end := v_start + interval '45 minutes';

  UPDATE public.workers w SET last_active_at=now()
  WHERE w.is_demo AND w.deleted_at IS NULL AND w.verification_status='approved'
    AND (w.auth_user_id IS NULL OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id=w.auth_user_id AND (u.banned_until IS NULL OR u.banned_until<now())))
    AND EXISTS (SELECT 1 FROM public.facilities f WHERE f.is_demo AND f.is_active AND f.deleted_at IS NULL);
  GET DIAGNOSTICS v_workers=ROW_COUNT;

  -- 라이브 시연 공고만 '지금' 기준으로. 일반 시연 공고(DEMO-SHOWCASE-OPEN)는 08:30 revive 가 D·E·N 으로 만든다
  UPDATE public.shifts s SET shift_date=v_start::date,start_time=v_start::time,end_time=v_end::time,
    estimated_total_pay=round(s.hourly_wage*0.75),updated_at=now()
  FROM public.facilities f
  WHERE f.id=s.facility_id AND f.is_demo AND f.is_active AND f.deleted_at IS NULL
    AND f.business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026')
    AND s.notes LIKE 'LIVE-SALES-DEMO-%'
    AND s.status IN ('open','matched')
    AND (s.matched_worker_id IS NULL OR EXISTS(SELECT 1 FROM public.workers w WHERE w.id=s.matched_worker_id AND w.is_demo AND w.deleted_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM public.shift_attendances a WHERE a.shift_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM public.shift_applications a JOIN public.workers w ON w.id=a.worker_id WHERE a.shift_id=s.id AND NOT coalesce(w.is_demo,false))
    AND (s.shift_date+s.start_time <= v_now OR s.shift_date+s.start_time > v_now+interval '1 hour');
  GET DIAGNOSTICS v_shifts=ROW_COUNT;

  -- 긱 페르소나: 지금부터 45분 창 — 출근·퇴근이 바로 된다. 오늘 근태가 있거나 퇴근 전이면 건드리지 않는다
  UPDATE public.facility_staff fs SET
    default_start_time=date_trunc('minute',v_now)::time,
    default_end_time=(date_trunc('minute',v_now)+interval '45 minutes')::time,
    work_weekdays=ARRAY[1,2,3,4,5,6,7],updated_at=now()
  FROM public.facilities f
  WHERE fs.id='20260922-0000-4000-8000-000000000004'::uuid AND fs.facility_id=f.id
    AND f.business_registration_number='DEMO-GIGWORKER-2026' AND f.is_demo AND f.is_active AND f.deleted_at IS NULL
    AND (fs.worker_id IS NULL OR EXISTS(SELECT 1 FROM public.workers w WHERE w.id=fs.worker_id AND w.is_demo AND w.deleted_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM public.staff_attendances a WHERE a.staff_id=fs.id AND
      (a.work_date=v_now::date OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NULL)));
  GET DIAGNOSTICS v_staff=ROW_COUNT;
  RETURN jsonb_build_object('workers',v_workers,'shifts',v_shifts,'gigStaff',v_staff,'refreshedAt',now());
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_demo_worker_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_worker_readiness() TO service_role;
