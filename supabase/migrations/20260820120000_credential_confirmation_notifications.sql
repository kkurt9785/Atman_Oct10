-- 사업장 자격 확인 완료를 워커와 시설 관리자에게 즉시 알린다.
CREATE OR REPLACE FUNCTION public.enqueue_credential_confirmation_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_auth uuid;
  v_worker_name text;
  v_facility uuid;
  v_recipient uuid;
  v_method_label text;
BEGIN
  IF NEW.credential_review_status <> 'facility_confirmed'
    OR COALESCE(OLD.credential_review_status, '') = 'facility_confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT w.auth_user_id, w.name, s.facility_id
    INTO v_worker_auth, v_worker_name, v_facility
  FROM public.shift_applications a
  JOIN public.workers w ON w.id = a.worker_id
  JOIN public.shifts s ON s.id = a.shift_id
  WHERE a.id = NEW.id;
  IF v_facility IS NULL THEN RETURN NEW; END IF;

  v_method_label := CASE NEW.credential_verification_method
    WHEN 'original_document' THEN '원본 확인'
    WHEN 'official_lookup' THEN '공식 조회'
    WHEN 'internal_hr_process' THEN '병원 내부 절차'
    ELSE '사업장 확인'
  END;

  IF v_worker_auth IS NOT NULL THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (v_worker_auth, 'credential.confirmed', 'credential.confirmed:' || NEW.id::text || ':' || v_worker_auth::text,
      '지원 자격 확인 완료', format('%s님, 사업장에서 지원 자격을 확인했어요. 이제 채용 확정을 기다려 주세요.', COALESCE(v_worker_name, '워커')),
      jsonb_build_object('url', '/applications', 'applicationId', NEW.id, 'method', v_method_label))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  FOR v_recipient IN
    SELECT f.admin_user_id FROM public.facilities f WHERE f.id = v_facility AND f.admin_user_id IS NOT NULL
    UNION
    SELECT fa.user_id FROM public.facility_admin_access fa WHERE fa.facility_id = v_facility AND fa.access_role IN ('owner','operator','super')
  LOOP
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (v_recipient, 'credential.confirmed.admin', 'credential.confirmed.admin:' || NEW.id::text || ':' || v_recipient::text,
      '자격 확인 기록 저장', format('%s님 자격 확인이 저장됐어요. (%s)', COALESCE(v_worker_name, '지원자'), v_method_label),
      jsonb_build_object('url', '/applications', 'applicationId', NEW.id, 'method', v_method_label))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credential_confirmation_notifications ON public.shift_applications;
CREATE TRIGGER trg_credential_confirmation_notifications
AFTER UPDATE OF credential_review_status ON public.shift_applications
FOR EACH ROW EXECUTE FUNCTION public.enqueue_credential_confirmation_notifications();

REVOKE ALL ON FUNCTION public.enqueue_credential_confirmation_notifications() FROM PUBLIC, anon, authenticated;

SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trg_credential_confirmation_notifications') AS trigger_created;
