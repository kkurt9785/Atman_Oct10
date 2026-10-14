-- Refresh only marked demo data. No deletions, credential approvals, location
-- changes or reactivation of withdrawn accounts in this periodic job.
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

  UPDATE public.shifts s SET shift_date=v_start::date,start_time=v_start::time,end_time=v_end::time,
    estimated_total_pay=round(s.hourly_wage*0.75),updated_at=now()
  FROM public.facilities f
  WHERE f.id=s.facility_id AND f.is_demo AND f.is_active AND f.deleted_at IS NULL
    AND f.business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026')
    AND (s.notes LIKE 'LIVE-SALES-DEMO-%' OR s.notes LIKE 'DEMO-SHOWCASE-OPEN-%')
    AND s.status IN ('open','matched')
    AND (s.matched_worker_id IS NULL OR EXISTS(SELECT 1 FROM public.workers w WHERE w.id=s.matched_worker_id AND w.is_demo AND w.deleted_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM public.shift_attendances a WHERE a.shift_id=s.id)
    AND NOT EXISTS(SELECT 1 FROM public.shift_applications a JOIN public.workers w ON w.id=a.worker_id WHERE a.shift_id=s.id AND NOT coalesce(w.is_demo,false))
    AND (s.shift_date+s.start_time <= v_now OR s.shift_date+s.start_time > v_now+interval '1 hour');
  GET DIAGNOSTICS v_shifts=ROW_COUNT;

  -- Fixed gig persona: use a 45-minute window that permits both check-in and
  -- check-out immediately under the normal attendance rules. Do not move it
  -- after any attendance record exists for today or an earlier open shift.
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

-- Demo login can refresh readiness without granting the service function to
-- every signed-in user. The cron runs the same implementation every 15 minutes.
CREATE OR REPLACE FUNCTION public.prepare_my_demo_worker()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_demo_account(auth.uid()) THEN
    RAISE EXCEPTION '시연 계정만 준비할 수 있어요.';
  END IF;
  RETURN public.refresh_demo_worker_readiness();
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_my_demo_worker() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_my_demo_worker() TO authenticated;

-- Keep the prior, demo-only reset as a private implementation. Reopening a
-- demo no longer erases an ongoing shift or a recently completed walkthrough.
ALTER FUNCTION public.reset_gigworker_invite_demo() RENAME TO reset_gigworker_invite_demo_internal;
REVOKE ALL ON FUNCTION public.reset_gigworker_invite_demo_internal() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.reset_gigworker_invite_demo()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_worker uuid; v_token uuid;
BEGIN
  SELECT w.id INTO v_worker FROM public.workers w JOIN auth.users u ON u.id=w.auth_user_id
  WHERE u.id=auth.uid() AND lower(u.email)='worker-gig-demo@demo.atman.co.kr' AND w.is_demo AND w.deleted_at IS NULL;
  IF v_worker IS NULL THEN RAISE EXCEPTION '긱워커 전용 데모 계정만 사용할 수 있어요.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('demo-worker-readiness'));
  IF EXISTS(SELECT 1 FROM public.facility_staff fs JOIN public.facilities f ON f.id=fs.facility_id
    WHERE fs.id='20260922-0000-4000-8000-000000000004'::uuid AND fs.worker_id=v_worker
      AND f.is_demo AND f.is_active AND f.deleted_at IS NULL AND (
        fs.updated_at > now()-interval '1 hour' OR EXISTS(SELECT 1 FROM public.staff_attendances a WHERE a.staff_id=fs.id AND (
          (a.check_in_at IS NOT NULL AND a.check_out_at IS NULL) OR a.check_out_at>now()-interval '1 hour'))
      )) THEN
    RETURN '20260922-0000-4000-8000-000000000006'::uuid;
  END IF;
  v_token := public.reset_gigworker_invite_demo_internal();
  PERFORM public.refresh_demo_worker_readiness();
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_gigworker_invite_demo() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_gigworker_invite_demo() TO authenticated;

SELECT cron.schedule('demo-worker-readiness-15min','*/15 * * * *','SELECT public.refresh_demo_worker_readiness();');
