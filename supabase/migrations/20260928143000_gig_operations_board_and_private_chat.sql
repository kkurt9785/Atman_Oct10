-- 긱워커 다인 운영의 데이터 축을 분리한다.
-- facility_staff = 사람/사업장 관계, gig_assignments = 실제 근무 건,
-- staff_attendances = 근무 건의 출퇴근, gig_payouts = 확정 근태의 지급 기록.

CREATE TABLE IF NOT EXISTS public.gig_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '단기 근무' CHECK (char_length(title) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  work_weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[]
    CHECK (cardinality(work_weekdays) BETWEEN 1 AND 7 AND work_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  pay_basis text CHECK (pay_basis IS NULL OR pay_basis IN ('hourly','daily','monthly')),
  pay_rate integer CHECK (pay_rate IS NULL OR pay_rate > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','completed','cancelled')),
  source text NOT NULL DEFAULT 'staff_compat' CHECK (source IN ('staff_compat','admin','imported')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gig_assignments_facility_dates
  ON public.gig_assignments(facility_id, starts_on, ends_on, status);
CREATE INDEX IF NOT EXISTS idx_gig_assignments_staff_dates
  ON public.gig_assignments(staff_id, starts_on DESC, ends_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gig_assignments_staff_compat
  ON public.gig_assignments(staff_id) WHERE source='staff_compat';

CREATE OR REPLACE FUNCTION public.validate_gig_assignment_staff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.facility_staff fs JOIN public.facilities f ON f.id=fs.facility_id
    WHERE fs.id=NEW.staff_id AND fs.facility_id=NEW.facility_id
      AND (f.facility_type='gigworker' OR f.registration_source='gigworker_trial')
  ) THEN RAISE EXCEPTION '긱 근무지와 근무자 관계가 일치하지 않아요'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_gig_assignment_staff ON public.gig_assignments;
CREATE TRIGGER trg_validate_gig_assignment_staff
BEFORE INSERT OR UPDATE OF facility_id,staff_id ON public.gig_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_gig_assignment_staff();
REVOKE ALL ON FUNCTION public.validate_gig_assignment_staff() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.gig_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gig_assignments_admin_read ON public.gig_assignments;
CREATE POLICY gig_assignments_admin_read ON public.gig_assignments FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS gig_assignments_worker_read ON public.gig_assignments;
CREATE POLICY gig_assignments_worker_read ON public.gig_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.id=staff_id AND fs.worker_id=public.current_worker_id()
  ));
REVOKE ALL ON public.gig_assignments FROM anon, authenticated;
GRANT SELECT ON public.gig_assignments TO authenticated;

-- 현재 긱 데이터를 한 번의 호환 근무 건으로 이관한다.
INSERT INTO public.gig_assignments(
  facility_id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,
  break_minutes,pay_basis,pay_rate,status,source,created_by,created_at,updated_at
)
SELECT
  fs.facility_id,fs.id,COALESCE(NULLIF(fs.department,''),'단기 근무'),
  COALESCE(fs.contract_start,(timezone('Asia/Seoul',fs.created_at))::date),
  COALESCE(fs.contract_end,(timezone('Asia/Seoul',now()))::date+365),
  COALESCE(fs.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),
  fs.default_start_time,fs.default_end_time,fs.default_break_minutes,
  fs.pay_basis,fs.pay_rate,CASE WHEN fs.status='ended' THEN 'completed' ELSE 'active' END,
  'staff_compat',fs.created_by,fs.created_at,fs.updated_at
FROM public.facility_staff fs
JOIN public.facilities f ON f.id=fs.facility_id
WHERE (f.facility_type='gigworker' OR f.registration_source='gigworker_trial')
  AND NOT EXISTS (SELECT 1 FROM public.gig_assignments ga WHERE ga.staff_id=fs.id);

-- 기존 코드가 facility_staff를 만들거나 수정해도 호환 근무 건이 함께 유지된다.
CREATE OR REPLACE FUNCTION public.sync_staff_compat_gig_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_is_gig boolean;
  v_start date;
  v_end date;
BEGIN
  SELECT (f.facility_type='gigworker' OR f.registration_source='gigworker_trial') INTO v_is_gig
  FROM public.facilities f WHERE f.id=NEW.facility_id;
  IF NOT COALESCE(v_is_gig,false) THEN RETURN NEW; END IF;
  v_start:=COALESCE(NEW.contract_start,(timezone('Asia/Seoul',NEW.created_at))::date,(timezone('Asia/Seoul',now()))::date);
  v_end:=COALESCE(NEW.contract_end,v_start+365);

  UPDATE public.gig_assignments SET
    title=COALESCE(NULLIF(NEW.department,''),'단기 근무'),starts_on=v_start,ends_on=v_end,
    work_weekdays=COALESCE(NEW.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),
    start_time=NEW.default_start_time,end_time=NEW.default_end_time,
    break_minutes=NEW.default_break_minutes,pay_basis=NEW.pay_basis,pay_rate=NEW.pay_rate,
    status=CASE WHEN NEW.status='ended' THEN 'completed' ELSE 'active' END,updated_at=now()
  WHERE id=(SELECT ga.id FROM public.gig_assignments ga
    WHERE ga.staff_id=NEW.id AND ga.source='staff_compat'
    ORDER BY ga.created_at DESC LIMIT 1);

  IF NOT FOUND THEN
    INSERT INTO public.gig_assignments(
      facility_id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,
      break_minutes,pay_basis,pay_rate,status,source,created_by
    ) VALUES(
      NEW.facility_id,NEW.id,COALESCE(NULLIF(NEW.department,''),'단기 근무'),v_start,v_end,
      COALESCE(NEW.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),NEW.default_start_time,NEW.default_end_time,
      NEW.default_break_minutes,NEW.pay_basis,NEW.pay_rate,
      CASE WHEN NEW.status='ended' THEN 'completed' ELSE 'active' END,'staff_compat',NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_staff_compat_gig_assignment ON public.facility_staff;
CREATE TRIGGER trg_sync_staff_compat_gig_assignment
AFTER INSERT OR UPDATE OF department,contract_start,contract_end,work_weekdays,
  default_start_time,default_end_time,default_break_minutes,pay_basis,pay_rate,status
ON public.facility_staff FOR EACH ROW EXECUTE FUNCTION public.sync_staff_compat_gig_assignment();
REVOKE ALL ON FUNCTION public.sync_staff_compat_gig_assignment() FROM PUBLIC,anon,authenticated;

ALTER TABLE public.staff_attendances
  ADD COLUMN IF NOT EXISTS gig_assignment_id uuid REFERENCES public.gig_assignments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_attendances_gig_assignment
  ON public.staff_attendances(gig_assignment_id,work_date);

UPDATE public.staff_attendances sa SET gig_assignment_id=(
  SELECT ga.id FROM public.gig_assignments ga
  WHERE ga.staff_id=sa.staff_id AND sa.work_date BETWEEN ga.starts_on AND ga.ends_on
    AND extract(isodow FROM sa.work_date)::smallint=ANY(ga.work_weekdays)
    AND ga.status<>'cancelled'
  ORDER BY ga.created_at DESC LIMIT 1
)
WHERE sa.gig_assignment_id IS NULL AND EXISTS(
  SELECT 1 FROM public.gig_assignments ga
  WHERE ga.staff_id=sa.staff_id AND sa.work_date BETWEEN ga.starts_on AND ga.ends_on
    AND extract(isodow FROM sa.work_date)::smallint=ANY(ga.work_weekdays)
    AND ga.status<>'cancelled'
);

CREATE OR REPLACE FUNCTION public.attach_gig_assignment_to_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
BEGIN
  IF NEW.gig_assignment_id IS NULL THEN
    SELECT ga.id INTO NEW.gig_assignment_id FROM public.gig_assignments ga
    WHERE ga.staff_id=NEW.staff_id AND NEW.work_date BETWEEN ga.starts_on AND ga.ends_on
      AND extract(isodow FROM NEW.work_date)::smallint=ANY(ga.work_weekdays)
      AND ga.status<>'cancelled'
    ORDER BY ga.created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attach_gig_assignment_to_attendance ON public.staff_attendances;
CREATE TRIGGER trg_attach_gig_assignment_to_attendance
BEFORE INSERT OR UPDATE OF staff_id,work_date ON public.staff_attendances
FOR EACH ROW EXECUTE FUNCTION public.attach_gig_assignment_to_attendance();
REVOKE ALL ON FUNCTION public.attach_gig_assignment_to_attendance() FROM PUBLIC,anon,authenticated;

-- ── 전체 워크룸과 근무자별 비공개 대화 분리 ────────────────────────────────
ALTER TABLE public.facility_workroom_messages
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.facility_staff(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_workroom_messages_staff
  ON public.facility_workroom_messages(facility_id,staff_id,created_at DESC);

DROP POLICY IF EXISTS facility_workroom_messages_member_read ON public.facility_workroom_messages;
CREATE POLICY facility_workroom_messages_member_read ON public.facility_workroom_messages FOR SELECT
USING (
  public.facility_access_role(facility_id) IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.facility_id=facility_workroom_messages.facility_id
      AND fs.worker_id=public.current_worker_id() AND fs.status<>'ended'
      AND (facility_workroom_messages.staff_id IS NULL OR facility_workroom_messages.staff_id=fs.id)
  )
);

CREATE TABLE IF NOT EXISTS public.facility_workroom_thread_reads (
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(facility_id,staff_id,user_id)
);
ALTER TABLE public.facility_workroom_thread_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_workroom_thread_reads FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.send_staff_workroom_message(p_staff_id uuid,p_body text)
RETURNS public.facility_workroom_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_user auth.users%ROWTYPE;
  v_sender_type text;
  v_sender_name text;
  v_body text:=trim(COALESCE(p_body,''));
  v_row public.facility_workroom_messages%ROWTYPE;
  v_recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '메시지는 1~2000자로 입력해 주세요'; END IF;
  SELECT * INTO v_staff FROM public.facility_staff WHERE id=p_staff_id AND status<>'ended';
  SELECT * INTO v_facility FROM public.facilities WHERE id=v_staff.facility_id AND is_active=true AND deleted_at IS NULL;
  IF v_staff.id IS NULL OR v_facility.id IS NULL THEN RAISE EXCEPTION '근무자 대화를 찾을 수 없어요'; END IF;

  IF public.facility_access_role(v_staff.facility_id) IS NOT NULL THEN
    v_sender_type:='admin';
    SELECT * INTO v_user FROM auth.users WHERE id=auth.uid();
    v_sender_name:=COALESCE(NULLIF(v_user.raw_user_meta_data->>'name',''),NULLIF(v_user.raw_user_meta_data->>'nickname',''),NULLIF(v_facility.contact_name,''),'관리자');
  ELSE
    SELECT * INTO v_worker FROM public.workers WHERE id=public.current_worker_id() AND deleted_at IS NULL;
    IF v_worker.id IS NULL OR v_staff.worker_id IS DISTINCT FROM v_worker.id THEN RAISE EXCEPTION '이 대화에 참여할 수 없어요'; END IF;
    v_sender_type:='worker';v_sender_name:=COALESCE(NULLIF(v_staff.name,''),NULLIF(v_worker.name,''),'워커');
  END IF;

  v_body:=regexp_replace(v_body,'01[016789][ .-]?[0-9]{3,4}[ .-]?[0-9]{4}','01*-****-****','g');
  INSERT INTO public.facility_workroom_messages(
    facility_id,staff_id,sender_type,sender_user_id,sender_name,message_type,body,metadata
  ) VALUES(
    v_staff.facility_id,v_staff.id,v_sender_type,auth.uid(),v_sender_name,'message',v_body,
    jsonb_build_object('kind','direct','staffId',v_staff.id)
  ) RETURNING * INTO v_row;

  IF v_sender_type='admin' THEN
    SELECT w.auth_user_id INTO v_recipient FROM public.workers w WHERE w.id=v_staff.worker_id AND w.deleted_at IS NULL;
    IF v_recipient IS NOT NULL AND v_recipient<>auth.uid() THEN
      INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
      VALUES(v_recipient,'workroom.direct','workroom:direct:'||v_row.id::text||':'||v_recipient::text,
        v_facility.name||' 관리자 메시지',v_sender_name||' · '||left(v_body,80),
        jsonb_build_object('url','/gig/workroom?facility='||v_staff.facility_id::text,'kind','workroom.direct','facilityId',v_staff.facility_id,'staffId',v_staff.id,'messageId',v_row.id))
      ON CONFLICT(dedupe_key) DO NOTHING;
    END IF;
  ELSE
    FOR v_recipient IN
      SELECT recipient FROM (
        SELECT f.admin_user_id recipient FROM public.facilities f WHERE f.id=v_staff.facility_id
        UNION SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id=v_staff.facility_id AND a.access_role IN ('owner','operator','super')
      ) x WHERE recipient IS NOT NULL AND recipient<>auth.uid()
    LOOP
      INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
      VALUES(v_recipient,'workroom.direct','workroom:direct:'||v_row.id::text||':'||v_recipient::text,
        v_staff.name||'님의 메시지',left(v_body,80),
        jsonb_build_object('url','/workroom?staff='||v_staff.id::text,'kind','workroom.direct','facilityId',v_staff.facility_id,'staffId',v_staff.id,'messageId',v_row.id))
      ON CONFLICT(dedupe_key) DO NOTHING;
    END LOOP;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_staff_workroom_read(p_staff_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_facility uuid;
BEGIN
  SELECT facility_id INTO v_facility FROM public.facility_staff fs
  WHERE fs.id=p_staff_id AND (public.facility_access_role(fs.facility_id) IS NOT NULL OR (fs.worker_id=public.current_worker_id() AND fs.status<>'ended'));
  IF v_facility IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  INSERT INTO public.facility_workroom_thread_reads(facility_id,staff_id,user_id,last_read_at)
  VALUES(v_facility,p_staff_id,auth.uid(),now())
  ON CONFLICT(facility_id,staff_id,user_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_workroom_members(p_facility_id uuid)
RETURNS TABLE(staff_id uuid,staff_name text,worker_linked boolean,unread_count bigint,last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT fs.id,fs.name,fs.worker_id IS NOT NULL,
    (SELECT count(*) FROM public.facility_workroom_messages m
      WHERE m.facility_id=p_facility_id AND m.staff_id=fs.id
        AND m.sender_user_id IS DISTINCT FROM auth.uid()
        AND m.created_at>COALESCE((SELECT r.last_read_at FROM public.facility_workroom_thread_reads r
          WHERE r.facility_id=p_facility_id AND r.staff_id=fs.id AND r.user_id=auth.uid()),'-infinity'::timestamptz)),
    (SELECT max(m.created_at) FROM public.facility_workroom_messages m WHERE m.facility_id=p_facility_id AND m.staff_id=fs.id)
  FROM public.facility_staff fs
  WHERE fs.facility_id=p_facility_id AND fs.status<>'ended'
    AND public.facility_access_role(p_facility_id) IS NOT NULL
  ORDER BY 5 DESC NULLS LAST,fs.name;
$$;

CREATE OR REPLACE FUNCTION public.get_my_workrooms_v2()
RETURNS TABLE(facility_id uuid,facility_name text,address_text text,registration_source text,staff_id uuid,member_count integer,unread_count bigint,last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  WITH rooms AS (
    SELECT f.id,f.name,f.address_text,f.registration_source,fs.id staff_id
    FROM public.facility_staff fs JOIN public.facilities f ON f.id=fs.facility_id
    WHERE fs.worker_id=public.current_worker_id() AND fs.status<>'ended' AND f.is_active=true AND f.deleted_at IS NULL
  )
  SELECT r.id,r.name,r.address_text,r.registration_source,r.staff_id,
    (SELECT count(*)::integer FROM public.facility_staff fs WHERE fs.facility_id=r.id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL),
    (SELECT count(*) FROM public.facility_workroom_messages m
      WHERE m.facility_id=r.id AND (m.staff_id IS NULL OR m.staff_id=r.staff_id)
        AND m.sender_user_id IS DISTINCT FROM auth.uid()
        AND m.created_at>CASE WHEN m.staff_id IS NULL THEN COALESCE((SELECT rd.last_read_at FROM public.facility_workroom_reads rd WHERE rd.facility_id=r.id AND rd.user_id=auth.uid()),'-infinity'::timestamptz)
          ELSE COALESCE((SELECT tr.last_read_at FROM public.facility_workroom_thread_reads tr WHERE tr.facility_id=r.id AND tr.staff_id=r.staff_id AND tr.user_id=auth.uid()),'-infinity'::timestamptz) END),
    (SELECT max(m.created_at) FROM public.facility_workroom_messages m WHERE m.facility_id=r.id AND (m.staff_id IS NULL OR m.staff_id=r.staff_id))
  FROM rooms r ORDER BY 8 DESC NULLS LAST,r.name;
$$;

CREATE OR REPLACE FUNCTION public.send_staff_workroom_messages(p_facility_id uuid,p_staff_ids uuid[],p_body text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_staff_id uuid;v_count integer:=0;
BEGIN
  IF public.facility_access_role(p_facility_id) IS NULL THEN RAISE EXCEPTION '관리자만 여러 근무자에게 보낼 수 있어요'; END IF;
  FOREACH v_staff_id IN ARRAY COALESCE(p_staff_ids,ARRAY[]::uuid[]) LOOP
    IF EXISTS(SELECT 1 FROM public.facility_staff fs WHERE fs.id=v_staff_id AND fs.facility_id=p_facility_id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL) THEN
      PERFORM public.send_staff_workroom_message(v_staff_id,p_body);v_count:=v_count+1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_staff_workroom_checks(p_facility_id uuid,p_staff_ids uuid[],p_body text,p_due_at timestamptz DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;v_facility public.facilities%ROWTYPE;v_user auth.users%ROWTYPE;
  v_name text;v_body text:=trim(COALESCE(p_body,''));v_check uuid;v_message uuid;v_recipient uuid;v_count integer:=0;
BEGIN
  IF auth.uid() IS NULL OR public.facility_access_role(p_facility_id) IS NULL THEN RAISE EXCEPTION '관리자만 출석 확인을 보낼 수 있어요'; END IF;
  IF char_length(v_body) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '출석 확인 내용은 1~500자로 입력해 주세요'; END IF;
  SELECT * INTO v_facility FROM public.facilities WHERE id=p_facility_id AND is_active=true AND deleted_at IS NULL;
  IF v_facility.id IS NULL THEN RAISE EXCEPTION '근무지를 찾을 수 없어요'; END IF;
  SELECT * INTO v_user FROM auth.users WHERE id=auth.uid();
  v_name:=COALESCE(NULLIF(v_user.raw_user_meta_data->>'name',''),NULLIF(v_user.raw_user_meta_data->>'nickname',''),NULLIF(v_facility.contact_name,''),'관리자');
  FOR v_staff IN SELECT fs.* FROM public.facility_staff fs WHERE fs.facility_id=p_facility_id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL AND fs.id=ANY(COALESCE(p_staff_ids,ARRAY[]::uuid[])) LOOP
    v_check:=gen_random_uuid();
    INSERT INTO public.facility_workroom_messages(facility_id,staff_id,sender_type,sender_user_id,sender_name,message_type,body,metadata)
    VALUES(p_facility_id,v_staff.id,'admin',auth.uid(),v_name,'announcement',v_body,jsonb_build_object('kind','check','checkId',v_check,'dueAt',p_due_at,'staffId',v_staff.id))
    RETURNING id INTO v_message;
    INSERT INTO public.facility_workroom_checks(id,facility_id,message_id,body,due_at,created_by)
    VALUES(v_check,p_facility_id,v_message,v_body,p_due_at,auth.uid());
    SELECT w.auth_user_id INTO v_recipient FROM public.workers w WHERE w.id=v_staff.worker_id AND w.deleted_at IS NULL;
    IF v_recipient IS NOT NULL THEN
      INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
      VALUES(v_recipient,'workroom.check','workroom.check:'||v_check::text||':'||v_recipient::text,v_facility.name||' 출석 확인',left(v_body,80)||' — 앱에서 확인 버튼을 눌러 주세요',
        jsonb_build_object('url','/gig/workroom?facility='||p_facility_id::text,'kind','workroom.check','facilityId',p_facility_id,'staffId',v_staff.id,'checkId',v_check))
      ON CONFLICT(dedupe_key) DO NOTHING;
    END IF;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 직접 확인 요청은 지정된 근무자만 읽고 답할 수 있게 기존 정책·함수를 좁힌다.
DROP POLICY IF EXISTS workroom_checks_member_read ON public.facility_workroom_checks;
CREATE POLICY workroom_checks_member_read ON public.facility_workroom_checks FOR SELECT USING (
  public.facility_access_role(facility_id) IS NOT NULL OR EXISTS(
    SELECT 1 FROM public.facility_workroom_messages m
    JOIN public.facility_staff fs ON fs.facility_id=m.facility_id
    WHERE m.id=facility_workroom_checks.message_id AND fs.worker_id=public.current_worker_id() AND fs.status<>'ended'
      AND (m.staff_id IS NULL OR m.staff_id=fs.id)
  )
);
DROP POLICY IF EXISTS workroom_check_replies_member_read ON public.facility_workroom_check_replies;
CREATE POLICY workroom_check_replies_member_read ON public.facility_workroom_check_replies FOR SELECT USING (
  EXISTS(SELECT 1 FROM public.facility_workroom_checks c WHERE c.id=facility_workroom_check_replies.check_id AND (
    public.facility_access_role(c.facility_id) IS NOT NULL OR facility_workroom_check_replies.worker_id=public.current_worker_id()
  ))
);

CREATE OR REPLACE FUNCTION public.reply_workroom_check(p_check_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_check public.facility_workroom_checks%ROWTYPE;v_staff public.facility_staff%ROWTYPE;v_target uuid;v_worker_id uuid:=public.current_worker_id();
BEGIN
  IF auth.uid() IS NULL OR v_worker_id IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  SELECT * INTO v_check FROM public.facility_workroom_checks c WHERE c.id=p_check_id;
  SELECT m.staff_id INTO v_target FROM public.facility_workroom_messages m WHERE m.id=v_check.message_id;
  IF v_check.id IS NULL THEN RAISE EXCEPTION '출석 확인을 찾을 수 없어요'; END IF;
  SELECT * INTO v_staff FROM public.facility_staff fs WHERE fs.facility_id=v_check.facility_id AND fs.worker_id=v_worker_id AND fs.status<>'ended' ORDER BY fs.created_at DESC LIMIT 1;
  IF v_staff.id IS NULL OR (v_target IS NOT NULL AND v_target<>v_staff.id) THEN RAISE EXCEPTION '이 출석 확인에 답할 수 없어요'; END IF;
  INSERT INTO public.facility_workroom_check_replies(check_id,staff_id,worker_id) VALUES(p_check_id,v_staff.id,v_worker_id)
  ON CONFLICT(check_id,staff_id) DO NOTHING;
END;
$$;

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
  ORDER BY c.created_at DESC,fs.name;
$$;

-- 근태 시스템 메시지도 해당 근무자와 관리자만 보는 개인 대화에 남긴다.
CREATE OR REPLACE FUNCTION public.publish_staff_attendance_to_workroom()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_name text;v_body text;v_event text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=NEW.facility_id AND (f.facility_type='gigworker' OR f.registration_source='gigworker_trial')) THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM public.facility_staff WHERE id=NEW.staff_id;
  IF v_name IS NULL THEN RETURN NEW; END IF;
  IF NEW.check_out_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_out_at IS NULL) THEN v_event:='checkout';v_body:=v_name||'님이 '||to_char(NEW.check_out_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||'에 퇴근했어요.';
  ELSIF NEW.checkout_requested_at IS NOT NULL AND NEW.check_out_at IS NULL AND (TG_OP='INSERT' OR OLD.checkout_requested_at IS NULL) THEN v_event:='checkout_request';v_body:=v_name||'님이 조기 퇴근 확인을 요청했어요.';
  ELSIF NEW.check_in_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_in_at IS NULL) THEN v_event:='checkin';v_body:=v_name||'님이 '||to_char(NEW.check_in_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||CASE WHEN NEW.status='late' THEN '에 지각 출근했어요.' ELSE '에 출근했어요.' END;
  ELSIF NEW.status='absent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'absent') THEN v_event:='absent';v_body:=v_name||'님이 결근으로 처리됐어요.';
  ELSE RETURN NEW; END IF;
  INSERT INTO public.facility_workroom_messages(facility_id,staff_id,sender_type,sender_name,message_type,body,event_key,metadata)
  VALUES(NEW.facility_id,NEW.staff_id,'system','근태 알림','attendance',v_body,'attendance:'||NEW.id::text||':'||v_event,
    jsonb_build_object('attendanceId',NEW.id,'staffId',NEW.staff_id,'workDate',NEW.work_date,'event',v_event))
  ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.send_staff_workroom_message(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.mark_staff_workroom_read(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_admin_workroom_members(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_workrooms_v2() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.send_staff_workroom_messages(uuid,uuid[],text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_staff_workroom_checks(uuid,uuid[],text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.send_staff_workroom_message(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_staff_workroom_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_workroom_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workrooms_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_staff_workroom_messages(uuid,uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_workroom_checks(uuid,uuid[],text,timestamptz) TO authenticated;

SELECT
  to_regclass('public.gig_assignments') IS NOT NULL AS gig_assignments_t,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facility_workroom_messages' AND column_name='staff_id') AS direct_staff_t,
  to_regprocedure('public.send_staff_workroom_messages(uuid,uuid[],text)') IS NOT NULL AS bulk_message_t;
