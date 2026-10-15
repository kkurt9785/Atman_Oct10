CREATE TABLE public.user_safety_blocks (
  blocker_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  peer_label text NOT NULL DEFAULT '상대방' CHECK(char_length(peer_label) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(blocker_user_id,blocked_user_id),
  CHECK(blocker_user_id<>blocked_user_id)
);
ALTER TABLE public.user_safety_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_safety_blocks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_safety_blocks TO authenticated;
GRANT ALL ON public.user_safety_blocks TO service_role;
CREATE POLICY safety_blocks_own_read ON public.user_safety_blocks FOR SELECT TO authenticated USING(blocker_user_id=auth.uid());
CREATE INDEX user_safety_blocks_peer ON public.user_safety_blocks(blocked_user_id,blocker_user_id);

CREATE TABLE public.chat_safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reported_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES public.facilities(id) ON DELETE SET NULL,
  source text NOT NULL CHECK(source IN ('match','workroom')),
  message_id uuid NOT NULL,
  reason text NOT NULL CHECK(reason IN ('harassment','spam','privacy','other')),
  note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000),
  message_snapshot text NOT NULL CHECK(char_length(message_snapshot)<=2000),
  sender_label text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  content_hidden boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',
  UNIQUE(reporter_user_id,source,message_id)
);
ALTER TABLE public.chat_safety_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_safety_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.chat_safety_reports TO authenticated;
GRANT ALL ON public.chat_safety_reports TO service_role;
CREATE POLICY safety_reports_own_read ON public.chat_safety_reports FOR SELECT TO authenticated USING(reporter_user_id=auth.uid());
CREATE INDEX chat_safety_reports_pending ON public.chat_safety_reports(status,created_at);

CREATE FUNCTION public.safety_pair_blocked(p_first uuid,p_second uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_safety_blocks
    WHERE (blocker_user_id=p_first AND blocked_user_id=p_second) OR (blocker_user_id=p_second AND blocked_user_id=p_first));
$$;
REVOKE ALL ON FUNCTION public.safety_pair_blocked(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.is_safety_user_blocked(p_peer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.safety_pair_blocked(auth.uid(),p_peer);
$$;
REVOKE ALL ON FUNCTION public.is_safety_user_blocked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_safety_user_blocked(uuid) TO authenticated;

-- RESTRICTIVE policies supplement existing participation policies, never grant
-- access to another facility or another worker's private thread.
CREATE POLICY chat_safety_visibility ON public.chat_messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING(sender_type='system' OR sender_id=auth.uid() OR NOT public.is_safety_user_blocked(sender_id));
CREATE POLICY workroom_safety_visibility ON public.facility_workroom_messages AS RESTRICTIVE FOR SELECT TO authenticated
  USING(sender_type='system' OR sender_user_id=auth.uid() OR NOT public.is_safety_user_blocked(sender_user_id));

CREATE FUNCTION public.safety_notification_sender(p_type text,p_key text,p_data jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_message text;v_sender uuid;
BEGIN
  IF p_type='chat.message' THEN
    v_message:=substring(p_key FROM '^chat:([0-9a-fA-F-]{36})');
    IF v_message IS NOT NULL THEN SELECT sender_id INTO v_sender FROM public.chat_messages WHERE id=v_message::uuid; END IF;
  ELSIF p_type IN ('workroom.message','workroom.direct','workroom.announcement') THEN
    v_message:=p_data->>'messageId';
    IF v_message ~ '^[0-9a-fA-F-]{36}$' THEN SELECT sender_user_id INTO v_sender FROM public.facility_workroom_messages WHERE id=v_message::uuid; END IF;
  END IF;
  RETURN v_sender;
END;
$$;
REVOKE ALL ON FUNCTION public.safety_notification_sender(text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.set_safety_user_block(p_peer uuid,p_blocked boolean,p_label text DEFAULT '상대방')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  IF public.is_demo_account(v_uid) THEN RAISE EXCEPTION '시연에서는 차단 설정을 저장하지 않아요. 내 계정으로 이용해 주세요.'; END IF;
  IF p_peer IS NULL OR p_peer=v_uid OR p_blocked IS NULL THEN RAISE EXCEPTION '차단할 사용자를 확인해 주세요.'; END IF;
  IF p_blocked THEN
    INSERT INTO public.user_safety_blocks(blocker_user_id,blocked_user_id,peer_label)
    VALUES(v_uid,p_peer,left(coalesce(nullif(trim(p_label),''),'상대방'),60)) ON CONFLICT DO NOTHING;
    UPDATE public.notification_outbox n SET status='discarded',last_error='user_blocked'
    WHERE n.status IN ('pending','failed') AND n.worker_auth_user_id IN (v_uid,p_peer)
      AND public.safety_pair_blocked(n.worker_auth_user_id,public.safety_notification_sender(n.event_type,n.dedupe_key,n.data));
  ELSE
    DELETE FROM public.user_safety_blocks WHERE blocker_user_id=v_uid AND blocked_user_id=p_peer;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_safety_user_block(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_safety_user_block(uuid,boolean,text) TO authenticated;

CREATE FUNCTION public.report_safety_message(p_source text,p_message_id uuid,p_reason text,p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid();v_sender uuid;v_facility uuid;v_body text;v_label text;v_id uuid;v_visible boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  IF public.is_demo_account(v_uid) THEN RAISE EXCEPTION '시연에서는 신고를 접수하지 않아요. 내 계정으로 이용해 주세요.'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('harassment','spam','privacy','other') OR char_length(coalesce(p_note,''))>1000 THEN
    RAISE EXCEPTION '신고 사유와 내용을 확인해 주세요.';
  END IF;
  IF p_source='match' THEN
    SELECT m.sender_id,s.facility_id,m.body,CASE WHEN m.sender_type='worker' THEN w.name ELSE '사업장 담당자' END,
      (w.auth_user_id=v_uid OR public.facility_access_role(s.facility_id) IS NOT NULL)
    INTO v_sender,v_facility,v_body,v_label,v_visible
    FROM public.chat_messages m JOIN public.shift_applications a ON a.id=m.application_id
      JOIN public.shifts s ON s.id=a.shift_id JOIN public.workers w ON w.id=a.worker_id
    WHERE m.id=p_message_id AND m.sender_type<>'system';
  ELSIF p_source='workroom' THEN
    SELECT m.sender_user_id,m.facility_id,m.body,m.sender_name,
      (public.facility_access_role(m.facility_id) IS NOT NULL OR EXISTS(
        SELECT 1 FROM public.facility_staff fs JOIN public.workers w ON w.id=fs.worker_id
        WHERE fs.facility_id=m.facility_id AND fs.status<>'ended' AND w.auth_user_id=v_uid AND w.deleted_at IS NULL
          AND (m.staff_id IS NULL OR m.staff_id=fs.id)))
    INTO v_sender,v_facility,v_body,v_label,v_visible FROM public.facility_workroom_messages m
    WHERE m.id=p_message_id AND m.sender_type<>'system';
  ELSE RAISE EXCEPTION '신고할 대화를 확인해 주세요.';
  END IF;
  IF v_visible IS NOT TRUE OR v_sender IS NULL OR v_sender=v_uid THEN RAISE EXCEPTION '신고할 메시지를 찾지 못했어요.'; END IF;
  INSERT INTO public.chat_safety_reports(reporter_user_id,reported_user_id,facility_id,source,message_id,reason,note,message_snapshot,sender_label)
  VALUES(v_uid,v_sender,v_facility,p_source,p_message_id,p_reason,trim(coalesce(p_note,'')),left(v_body,2000),coalesce(v_label,'상대방'))
  ON CONFLICT(reporter_user_id,source,message_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM public.chat_safety_reports WHERE reporter_user_id=v_uid AND source=p_source AND message_id=p_message_id; END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_safety_message(text,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.report_safety_message(text,uuid,text,text) TO authenticated;

-- Private messages are rejected before insertion/outbox creation. Broadcasts
-- remain visible to other members; each blocked recipient is filtered by RLS.
CREATE FUNCTION public.guard_safety_private_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_worker uuid;v_facility uuid;
BEGIN
  IF auth.uid() IS NULL OR NEW.sender_type='system' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='chat_messages' THEN
    SELECT w.auth_user_id,s.facility_id INTO v_worker,v_facility FROM public.shift_applications a
      JOIN public.workers w ON w.id=a.worker_id JOIN public.shifts s ON s.id=a.shift_id WHERE a.id=NEW.application_id;
  ELSE
    IF NEW.staff_id IS NULL THEN RETURN NEW; END IF;
    SELECT w.auth_user_id,fs.facility_id INTO v_worker,v_facility FROM public.facility_staff fs
      JOIN public.workers w ON w.id=fs.worker_id WHERE fs.id=NEW.staff_id;
  END IF;
  IF auth.uid()=v_worker THEN
    IF NOT EXISTS(SELECT 1 FROM (
      SELECT admin_user_id AS id FROM public.facilities WHERE id=v_facility
      UNION SELECT user_id FROM public.facility_admin_access WHERE facility_id=v_facility AND access_role IN ('owner','operator','super')
    ) admins WHERE admins.id IS NOT NULL AND NOT public.safety_pair_blocked(v_worker,admins.id)) THEN
      RAISE EXCEPTION '차단된 사용자와는 비공개 메시지를 주고받을 수 없어요. 차단 설정을 확인해 주세요.';
    END IF;
  ELSIF public.safety_pair_blocked(auth.uid(),v_worker) THEN
    RAISE EXCEPTION '차단된 사용자와는 비공개 메시지를 주고받을 수 없어요. 차단 설정을 확인해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_safety_private_message() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_chat_safety BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.guard_safety_private_message();
CREATE TRIGGER trg_workroom_safety BEFORE INSERT ON public.facility_workroom_messages FOR EACH ROW EXECUTE FUNCTION public.guard_safety_private_message();

CREATE FUNCTION public.guard_safety_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.safety_pair_blocked(NEW.worker_auth_user_id,public.safety_notification_sender(NEW.event_type,NEW.dedupe_key,NEW.data)) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_safety_notification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_safety_outbox BEFORE INSERT ON public.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.guard_safety_notification();

CREATE FUNCTION public.is_safety_outbox_allowed(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT NOT public.safety_pair_blocked(worker_auth_user_id,public.safety_notification_sender(event_type,dedupe_key,data))
    AND NOT EXISTS(SELECT 1 FROM public.chat_safety_reports r WHERE r.content_hidden AND
      ((r.source='match' AND dedupe_key LIKE 'chat:'||r.message_id::text||'%') OR
       (r.source='workroom' AND data->>'messageId'=r.message_id::text)))
    FROM public.notification_outbox WHERE id=p_id),false);
$$;
REVOKE ALL ON FUNCTION public.is_safety_outbox_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.is_safety_outbox_allowed(uuid) TO service_role;

-- Only the server's allowlisted platform operator route may invoke this RPC.
CREATE FUNCTION public.review_safety_report(p_id uuid,p_status text,p_note text,p_actor uuid,p_hide boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.chat_safety_reports%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_status IS NULL OR p_status NOT IN ('reviewing','resolved','dismissed')
    OR char_length(coalesce(p_note,''))>1000 OR (p_hide AND p_status<>'resolved') THEN
    RAISE EXCEPTION '검토 결과를 확인해 주세요.';
  END IF;
  SELECT * INTO r FROM public.chat_safety_reports WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '신고를 찾지 못했어요.'; END IF;
  IF p_hide THEN
    IF r.source='match' THEN
      UPDATE public.chat_messages SET body='[운영 정책 위반으로 숨겨진 메시지]' WHERE id=r.message_id;
    ELSE
      UPDATE public.facility_workroom_messages SET body='[운영 정책 위반으로 숨겨진 메시지]' WHERE id=r.message_id;
    END IF;
    UPDATE public.notification_outbox SET status='discarded',last_error='moderated_content'
      WHERE status IN ('pending','failed') AND
      ((r.source='match' AND dedupe_key LIKE 'chat:'||r.message_id::text||'%')
       OR (r.source='workroom' AND data->>'messageId'=r.message_id::text));
  END IF;
  UPDATE public.chat_safety_reports SET status=p_status,resolution_note=trim(coalesce(p_note,'')),
    content_hidden=content_hidden OR coalesce(p_hide,false),reviewed_at=now(),reviewed_by=p_actor WHERE id=p_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.review_safety_report(uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_safety_report(uuid,text,text,uuid,boolean) TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='chat-safety-report-retention';
SELECT cron.schedule('chat-safety-report-retention','45 18 * * *','DELETE FROM public.chat_safety_reports WHERE expires_at<now();');
