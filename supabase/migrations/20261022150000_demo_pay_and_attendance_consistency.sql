-- 2026-10-22 QA P1 #2·#3·#5 — 시연 데이터의 금액·근태·계약 조건을 앱 공식과 맞춘다
-- 1) 공고 예상 지급액 SQL 공식(앱 lib/shared/gig-pay/shift-pay.ts 와 동일: 휴게 8h+ 60분·4h+ 30분, round(분×시급/60))
CREATE OR REPLACE FUNCTION public.estimated_shift_pay(p_start time, p_end time, p_wage numeric)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v_total integer; v_break integer;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_wage IS NULL OR p_wage <= 0 THEN RETURN NULL; END IF;
  v_total := (extract(epoch FROM (p_end - p_start)) / 60)::integer;
  IF v_total <= 0 THEN v_total := v_total + 1440; END IF;
  v_break := CASE WHEN v_total >= 480 THEN 60 WHEN v_total >= 240 THEN 30 ELSE 0 END;
  RETURN round((v_total - v_break) * p_wage / 60)::integer;
END $$;

-- 2) 시연 사업장의 기존 공고(약국·라이브데모 SQL 시드 152,000/54,000/160,000/80,000 등)를 공식값으로
UPDATE public.shifts s
SET estimated_total_pay = public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage), updated_at = now()
FROM public.facilities f
WHERE f.id = s.facility_id AND f.is_demo
  AND public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage) IS NOT NULL
  AND s.estimated_total_pay IS DISTINCT FROM public.estimated_shift_pay(s.start_time, s.end_time, s.hourly_wage);

-- 3) 시연 공고(DEMO-·LIVE-SALES-DEMO 메모)는 앞으로 넣거나 시간·시급을 바꿀 때 자동으로 공식값 — reset 함수의 하드코딩을 덮는다
CREATE OR REPLACE FUNCTION public.demo_shift_estimated_pay_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.notes LIKE 'DEMO-%' OR NEW.notes LIKE 'LIVE-SALES-DEMO%' THEN
    NEW.estimated_total_pay := coalesce(public.estimated_shift_pay(NEW.start_time, NEW.end_time, NEW.hourly_wage), NEW.estimated_total_pay);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_demo_shift_estimated_pay ON public.shifts;
CREATE TRIGGER trg_demo_shift_estimated_pay
  BEFORE INSERT OR UPDATE OF start_time, end_time, hourly_wage ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.demo_shift_estimated_pay_trg();

-- 4) 시연 월 근태 시드가 '지각(late)' 상태로 퇴근까지 채운 행 → 실제 퇴근 RPC 처럼 완료로 (급여 162:20 vs 근태 178:04 불일치)
UPDATE public.staff_attendances a
SET status = 'completed', updated_at = now()
FROM public.facilities f
WHERE f.id = a.facility_id AND f.is_demo
  AND a.status = 'late' AND a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL;

-- 5) 긱 페르소나 계약을 매일 '지금+45분'으로 옮길 때 휴게를 0으로, 수락 시점 조건(terms_snapshot)도 같이 맞춘다
--    (45분 근무에 휴게 60분 + "수락할 때와 조건이 달라요" 경고가 매일 뜨던 문제). 나머지 본문은 20261015030000 과 동일
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
    estimated_total_pay=public.estimated_shift_pay(v_start::time,v_end::time,s.hourly_wage),updated_at=now()
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
  -- 휴게는 0(45분 근무), 수락 시점 조건도 같은 값으로 갱신해 "조건이 달라요" 경고가 시연에서 뜨지 않게 한다
  UPDATE public.facility_staff fs SET
    default_start_time=date_trunc('minute',v_now)::time,
    default_end_time=(date_trunc('minute',v_now)+interval '45 minutes')::time,
    default_break_minutes=0,
    terms_snapshot=CASE WHEN fs.terms_snapshot IS NULL THEN NULL ELSE fs.terms_snapshot || jsonb_build_object(
      'payBasis', fs.pay_basis, 'payRate', fs.pay_rate,
      'startTime', date_trunc('minute',v_now)::time, 'endTime', (date_trunc('minute',v_now)+interval '45 minutes')::time,
      'breakMinutes', 0, 'workWeekdays', ARRAY[1,2,3,4,5,6,7]) END,
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
