-- Complete two-way chat notifications. Facility -> worker is already enqueued
-- by send_chat_message(); this trigger fans worker -> facility out to every
-- owner/operator/super administrator.

CREATE OR REPLACE FUNCTION public.enqueue_admin_worker_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_facility uuid;
  v_worker_name text;
  v_recipient uuid;
BEGIN
  IF NEW.sender_type<>'worker' THEN RETURN NEW; END IF;
  SELECT s.facility_id,w.name INTO v_facility,v_worker_name
  FROM public.shift_applications a
  JOIN public.shifts s ON s.id=a.shift_id
  JOIN public.workers w ON w.id=a.worker_id
  WHERE a.id=NEW.application_id;
  IF v_facility IS NULL THEN RETURN NEW; END IF;
  FOR v_recipient IN
    SELECT f.admin_user_id FROM public.facilities f
    WHERE f.id=v_facility AND f.admin_user_id IS NOT NULL
    UNION
    SELECT access.user_id FROM public.facility_admin_access access
    WHERE access.facility_id=v_facility AND access.access_role IN ('owner','operator','super')
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id,event_type,dedupe_key,title,body,data
    ) VALUES (
      v_recipient,'chat.message',
      'chat.admin:'||NEW.id::text||':'||v_recipient::text,
      '워커에게 메시지가 왔어요',
      COALESCE(v_worker_name,'워커')||' · '||left(NEW.body,70),
      jsonb_build_object('url','/chats/'||NEW.application_id::text,'applicationId',NEW.application_id,'facilityId',v_facility)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_worker_chat_message ON public.chat_messages;
CREATE TRIGGER trg_admin_worker_chat_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.enqueue_admin_worker_chat_message();

REVOKE ALL ON FUNCTION public.enqueue_admin_worker_chat_message() FROM PUBLIC,anon,authenticated;
