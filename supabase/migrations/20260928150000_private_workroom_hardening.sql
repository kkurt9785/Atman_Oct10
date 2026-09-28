-- 긱 워크룸의 비공개 경계를 DB에서도 강제한다.
-- UI를 우회해도 워커가 긱 전체방에 글을 쓰거나 다른 staff_id로 메시지를 만들 수 없다.

CREATE OR REPLACE FUNCTION public.enforce_workroom_message_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_is_gig boolean;
BEGIN
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.id=NEW.staff_id AND fs.facility_id=NEW.facility_id
  ) THEN RAISE EXCEPTION '대화 근무자와 근무지가 일치하지 않아요'; END IF;

  IF NEW.sender_type='worker' AND NEW.staff_id IS NULL THEN
    SELECT (f.facility_type='gigworker' OR f.registration_source='gigworker_trial') INTO v_is_gig
    FROM public.facilities f WHERE f.id=NEW.facility_id;
    IF COALESCE(v_is_gig,false) THEN
      RAISE EXCEPTION '긱워커 메시지는 관리자와의 비공개 대화에만 보낼 수 있어요';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enforce_workroom_message_scope ON public.facility_workroom_messages;
CREATE TRIGGER trg_enforce_workroom_message_scope
BEFORE INSERT OR UPDATE OF facility_id,staff_id,sender_type ON public.facility_workroom_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_workroom_message_scope();
REVOKE ALL ON FUNCTION public.enforce_workroom_message_scope() FROM PUBLIC,anon,authenticated;

-- 관리자는 전체 응답 현황을, 워커는 자기 응답만 볼 수 있다.
CREATE OR REPLACE FUNCTION public.get_workroom_check_status(p_facility_id uuid)
RETURNS TABLE(check_id uuid,staff_id uuid,staff_name text,replied_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT c.id,fs.id,fs.name,r.replied_at
  FROM public.facility_workroom_checks c
  JOIN public.facility_workroom_messages m ON m.id=c.message_id
  JOIN public.facility_staff fs ON fs.facility_id=c.facility_id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL
    AND (m.staff_id IS NULL OR m.staff_id=fs.id)
  LEFT JOIN public.facility_workroom_check_replies r ON r.check_id=c.id AND r.staff_id=fs.id
  WHERE c.facility_id=p_facility_id AND public.is_workroom_member(p_facility_id)
    AND (public.facility_access_role(p_facility_id) IS NOT NULL OR fs.worker_id=public.current_worker_id())
  ORDER BY c.created_at DESC,fs.name;
$$;

REVOKE ALL ON FUNCTION public.get_workroom_check_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_workroom_check_status(uuid) TO authenticated;

SELECT
  to_regprocedure('public.enforce_workroom_message_scope()') IS NOT NULL AS scope_trigger_fn_t,
  position('fs.worker_id=public.current_worker_id()' in pg_get_functiondef(
    to_regprocedure('public.get_workroom_check_status(uuid)'))) > 0 AS worker_status_scoped_t;
