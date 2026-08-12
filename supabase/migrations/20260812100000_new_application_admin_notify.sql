-- ============================================================================
-- 지원 접수 → 관리자 실시간 알림 (2026-08-12)
-- 매칭의 첫 순간("지원자 도착")에 관리자 푸시가 없어 앱을 열어야만 보이던 갭.
-- 트리거 방식이라 apply_to_shift RPC·재지원(UPDATE→applied) 모두 커버.
--   · auth.uid()가 없는 삽입(pg_cron 데모 시드·service_role 배치)은 제외 —
--     매일 밤 50건 시드가 푸시 스팸이 되는 것을 막고, 실사용자/시연 지원만 알림.
--   · 수신자: 소유자(admin_user_id) + 위임 관리자(operator·super). sales 제외.
--   · dedupe_key에 수신자 포함 (20260811 팬아웃 규약).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_admin_new_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shift record;
  v_worker_name text;
  v_recipient uuid;
  v_date_label text;
BEGIN
  -- 실사용자 액션만 (크론·서비스 배치 시드는 무음)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'applied' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'applied' THEN RETURN NEW; END IF;

  SELECT s.id, s.facility_id, s.shift_date, s.start_time INTO v_shift
  FROM public.shifts s WHERE s.id = NEW.shift_id;
  IF v_shift.id IS NULL THEN RETURN NEW; END IF;

  SELECT w.name INTO v_worker_name FROM public.workers w WHERE w.id = NEW.worker_id;
  v_date_label := to_char(v_shift.shift_date, 'FMMM월 FMDD일');

  FOR v_recipient IN
    SELECT f.admin_user_id FROM public.facilities f
    WHERE f.id = v_shift.facility_id AND f.admin_user_id IS NOT NULL
    UNION
    SELECT fa.user_id FROM public.facility_admin_access fa
    WHERE fa.facility_id = v_shift.facility_id AND fa.access_role IN ('operator','super')
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id, event_type, dedupe_key, title, body, data
    ) VALUES (
      v_recipient, 'shift.applied',
      'shift.applied:' || NEW.id::text || ':' || v_recipient::text,
      '새 지원자 도착',
      format('%s님이 %s 근무에 지원했어요.', COALESCE(v_worker_name, '워커'), v_date_label),
      jsonb_build_object('url','/applications','applicationId',NEW.id,'shiftId',v_shift.id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_new_application ON public.shift_applications;
CREATE TRIGGER trg_admin_new_application
AFTER INSERT OR UPDATE ON public.shift_applications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_admin_new_application();

-- 검증 (둘 다 true면 성공)
SELECT
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_admin_new_application') AS trigger_created,
  to_regprocedure('public.enqueue_admin_new_application()') IS NOT NULL AS function_created;
