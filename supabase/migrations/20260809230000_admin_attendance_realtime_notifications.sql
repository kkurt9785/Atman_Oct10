-- 관리자 근태 실시간 반영 + 예외 상황 푸시 알림.
-- 정상 출퇴근은 Realtime UI 토스트만, 지각/인증실패/조기퇴근만 outbox에 적재한다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='attendance_auth_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_auth_logs;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_admin_attendance_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_name text := '근로자';
  v_title text;
  v_body text;
  v_event text;
  v_late integer := 0;
  v_early integer := 0;
  v_staff_status text;
  v_recipient uuid;
BEGIN
  IF NEW.result='FAIL' THEN
    IF NEW.failure_reason IN ('DUPLICATE_ATTENDANCE','INVALID_STATE') THEN RETURN NEW; END IF;
    IF NEW.staff_id IS NOT NULL THEN
      SELECT name INTO v_name FROM public.facility_staff WHERE id=NEW.staff_id;
    ELSIF NEW.application_id IS NOT NULL THEN
      SELECT w.name INTO v_name
      FROM public.shift_applications a JOIN public.workers w ON w.id=a.worker_id
      WHERE a.id=NEW.application_id;
    END IF;
    v_event := 'attendance_auth_failed';
    v_title := '출퇴근 인증 확인 필요';
    v_body := format('%s님의 %s 인증이 실패했어요.',COALESCE(v_name,'근로자'),CASE WHEN NEW.action='check_in' THEN '출근' ELSE '퇴근' END);
  ELSIF NEW.result='SUCCESS' AND NEW.action='check_in' THEN
    IF NEW.staff_attendance_id IS NOT NULL THEN
      SELECT s.name,a.late_minutes INTO v_name,v_late
      FROM public.staff_attendances a JOIN public.facility_staff s ON s.id=a.staff_id
      WHERE a.id=NEW.staff_attendance_id;
    ELSIF NEW.shift_attendance_id IS NOT NULL THEN
      SELECT w.name,a.late_minutes INTO v_name,v_late
      FROM public.shift_attendances a JOIN public.workers w ON w.id=a.worker_id
      WHERE a.id=NEW.shift_attendance_id;
    END IF;
    IF COALESCE(v_late,0)<=0 THEN RETURN NEW; END IF;
    v_event := 'attendance_late';
    v_title := '지각 출근 확인';
    v_body := format('%s님이 %s분 지각 출근했어요.',COALESCE(v_name,'근로자'),v_late);
  ELSIF NEW.result='SUCCESS' AND NEW.action='check_out' THEN
    IF NEW.staff_attendance_id IS NOT NULL THEN
      SELECT s.name,a.early_leave_minutes,a.status INTO v_name,v_early,v_staff_status
      FROM public.staff_attendances a JOIN public.facility_staff s ON s.id=a.staff_id
      WHERE a.id=NEW.staff_attendance_id;
    ELSIF NEW.shift_attendance_id IS NOT NULL THEN
      SELECT w.name,a.early_leave_minutes INTO v_name,v_early
      FROM public.shift_attendances a JOIN public.workers w ON w.id=a.worker_id
      WHERE a.id=NEW.shift_attendance_id;
    END IF;
    IF COALESCE(v_early,0)<=0 AND COALESCE(v_staff_status,'')<>'checkout_pending' THEN RETURN NEW; END IF;
    v_event := 'attendance_early_checkout';
    v_title := '조기 퇴근 확인';
    v_body := format('%s님의 조기 퇴근 기록을 확인해 주세요.',COALESCE(v_name,'근로자'));
  ELSE
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT f.admin_user_id FROM public.facilities f
    WHERE f.id=NEW.facility_id AND f.admin_user_id IS NOT NULL
    UNION
    SELECT fa.user_id FROM public.facility_admin_access fa
    WHERE fa.facility_id=NEW.facility_id AND fa.access_role IN ('owner','operator','super')
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id,event_type,dedupe_key,title,body,data
    ) VALUES (
      v_recipient,v_event,'admin-attendance:'||NEW.id::text,v_title,v_body,
      jsonb_build_object('url','/timesheet','facilityId',NEW.facility_id,'attendanceAuthLogId',NEW.id)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_attendance_exception ON public.attendance_auth_logs;
CREATE TRIGGER trg_admin_attendance_exception
AFTER INSERT ON public.attendance_auth_logs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_admin_attendance_exception();

REVOKE ALL ON FUNCTION public.enqueue_admin_attendance_exception() FROM PUBLIC,anon,authenticated;
