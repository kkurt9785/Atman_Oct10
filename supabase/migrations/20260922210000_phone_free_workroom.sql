-- 전화번호를 모르는 관리자·워커도 일회용 초대 링크/QR로 연결하고,
-- 사업장별 워크룸에서 공지·대화·근태 이벤트를 계속 보관한다.

-- 초대 토큰은 UUID(일회용·만료형) 자체가 가입 권한이다. 전화번호는 있으면
-- 연락용 프로필로만 저장하며, 초대 수락이나 상대방 검색의 전제조건으로 쓰지 않는다.
ALTER TABLE public.facility_staff_invites
  ALTER COLUMN phone_normalized DROP NOT NULL;

-- 근태 전용 초대로 가입할 때는 전화번호 없이도 본인 계정을 만들 수 있다.
-- 일반 마켓 가입 UI는 계속 전화번호를 필수로 받는다.
DO $patch_onboarding$
DECLARE
  fn regprocedure;
  def text;
  patched text;
  before_step text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'complete_worker_onboarding 함수를 찾지 못했습니다'; END IF;

  SELECT pg_get_functiondef(fn) INTO def;
  patched := def;

  IF position('NULLIF(regexp_replace(COALESCE(p_phone' in patched) = 0 THEN
    before_step := patched;
    patched := replace(
      patched,
      $old$IF regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') !~ '^010[0-9]{8}$' THEN$old$,
      $new$IF NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') !~ '^010[0-9]{8}$' THEN$new$
    );
    IF patched = before_step THEN RAISE EXCEPTION '전화번호 검증 패치 지점을 찾지 못했습니다'; END IF;
  END IF;

  IF position($find$NULLIF(trim(p_phone), '')$find$ in patched) = 0 THEN
    before_step := patched;
    patched := replace(
      patched,
      'auth.uid(), v_kakao_id, trim(p_name), p_phone, v_user.email,',
      $new$auth.uid(), v_kakao_id, trim(p_name), NULLIF(trim(p_phone), ''), v_user.email,$new$
    );
    IF patched = before_step THEN RAISE EXCEPTION '전화번호 저장 패치 지점을 찾지 못했습니다'; END IF;
  END IF;

  IF position('phone = COALESCE(EXCLUDED.phone, public.workers.phone)' in patched) = 0 THEN
    before_step := patched;
    patched := replace(
      patched,
      'phone = EXCLUDED.phone,',
      'phone = COALESCE(EXCLUDED.phone, public.workers.phone),'
    );
    IF patched = before_step THEN RAISE EXCEPTION '기존 전화번호 보존 패치 지점을 찾지 못했습니다'; END IF;
  END IF;

  IF patched <> def THEN EXECUTE patched; END IF;
END
$patch_onboarding$;

CREATE TABLE IF NOT EXISTS public.facility_workroom_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('admin','worker','system')),
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 80),
  message_type text NOT NULL DEFAULT 'message'
    CHECK (message_type IN ('message','announcement','attendance','membership','schedule')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facility_workroom_messages_room
  ON public.facility_workroom_messages(facility_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_workroom_messages_event
  ON public.facility_workroom_messages(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.facility_workroom_reads (
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, user_id)
);

ALTER TABLE public.facility_workroom_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_workroom_reads ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.facility_workroom_messages FROM anon, authenticated;
REVOKE ALL ON public.facility_workroom_reads FROM anon, authenticated;
GRANT SELECT ON public.facility_workroom_messages TO authenticated;

DROP POLICY IF EXISTS facility_workroom_messages_member_read ON public.facility_workroom_messages;
CREATE POLICY facility_workroom_messages_member_read ON public.facility_workroom_messages
FOR SELECT USING (
  public.facility_access_role(facility_id) IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.facility_id = facility_workroom_messages.facility_id
      AND fs.worker_id = public.current_worker_id()
      AND fs.status <> 'ended'
  )
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.facility_workroom_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.send_facility_workroom_message(
  p_facility_id uuid,
  p_body text,
  p_announcement boolean DEFAULT false
)
RETURNS public.facility_workroom_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_user auth.users%ROWTYPE;
  v_sender_type text;
  v_sender_name text;
  v_body text;
  v_row public.facility_workroom_messages%ROWTYPE;
  v_recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  v_body := trim(COALESCE(p_body, ''));
  IF char_length(v_body) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '메시지는 1~2000자로 입력해 주세요'; END IF;

  SELECT * INTO v_facility FROM public.facilities
  WHERE id = p_facility_id AND is_active = true AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워크룸을 찾을 수 없어요'; END IF;

  IF public.facility_access_role(p_facility_id) IS NOT NULL THEN
    v_sender_type := 'admin';
    SELECT * INTO v_user FROM auth.users WHERE id = auth.uid();
    v_sender_name := COALESCE(
      NULLIF(v_user.raw_user_meta_data->>'name',''),
      NULLIF(v_user.raw_user_meta_data->>'nickname',''),
      NULLIF(v_facility.contact_name,''),
      '관리자'
    );
  ELSE
    SELECT w.* INTO v_worker FROM public.workers w
    WHERE w.id = public.current_worker_id() AND w.deleted_at IS NULL;
    SELECT fs.* INTO v_staff FROM public.facility_staff fs
    WHERE fs.facility_id = p_facility_id AND fs.worker_id = v_worker.id AND fs.status <> 'ended';
    IF v_worker.id IS NULL OR v_staff.id IS NULL THEN RAISE EXCEPTION '이 워크룸에 참여할 수 없어요'; END IF;
    IF p_announcement THEN RAISE EXCEPTION '공지 등록은 관리자만 할 수 있어요'; END IF;
    v_sender_type := 'worker';
    v_sender_name := COALESCE(NULLIF(v_staff.name,''), NULLIF(v_worker.name,''), '워커');
  END IF;

  -- 업무 소통은 앱 안에 남기고 개인 연락처는 워크룸 전체에 퍼지지 않게 한다.
  v_body := regexp_replace(v_body, '01[016789][ .-]?[0-9]{3,4}[ .-]?[0-9]{4}', '01*-****-****', 'g');
  INSERT INTO public.facility_workroom_messages(
    facility_id, sender_type, sender_user_id, sender_name, message_type, body
  ) VALUES (
    p_facility_id, v_sender_type, auth.uid(), v_sender_name,
    CASE WHEN p_announcement THEN 'announcement' ELSE 'message' END,
    v_body
  ) RETURNING * INTO v_row;

  FOR v_recipient IN
    SELECT recipient FROM (
      SELECT f.admin_user_id AS recipient
      FROM public.facilities f
      WHERE f.id = p_facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id FROM public.facility_admin_access a
      WHERE a.facility_id = p_facility_id AND a.access_role IN ('owner','operator','super')
      UNION
      SELECT w.auth_user_id
      FROM public.facility_staff fs
      JOIN public.workers w ON w.id = fs.worker_id
      WHERE fs.facility_id = p_facility_id AND fs.status <> 'ended'
        AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL
    ) recipients
    WHERE recipient IS NOT NULL AND recipient <> auth.uid()
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id, event_type, dedupe_key, title, body, data
    ) VALUES (
      v_recipient,
      CASE WHEN p_announcement THEN 'workroom.announcement' ELSE 'workroom.message' END,
      'workroom:' || v_row.id::text || ':' || v_recipient::text,
      CASE WHEN p_announcement THEN v_facility.name || ' 새 공지' ELSE v_facility.name || ' 워크룸' END,
      v_sender_name || ' · ' || left(v_body, 80),
      jsonb_build_object(
        'url', '/workroom?facility=' || p_facility_id::text,
        'kind', CASE WHEN p_announcement THEN 'workroom.announcement' ELSE 'workroom.message' END,
        'facilityId', p_facility_id,
        'messageId', v_row.id
      )
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_facility_workroom_read(p_facility_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.facility_access_role(p_facility_id) IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.facility_id = p_facility_id
      AND fs.worker_id = public.current_worker_id()
      AND fs.status <> 'ended'
  ) THEN RETURN false; END IF;

  INSERT INTO public.facility_workroom_reads(facility_id,user_id,last_read_at)
  VALUES (p_facility_id,auth.uid(),now())
  ON CONFLICT(facility_id,user_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_workrooms()
RETURNS TABLE(
  facility_id uuid,
  facility_name text,
  address_text text,
  registration_source text,
  member_count integer,
  unread_count bigint,
  last_message_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH rooms AS (
    SELECT f.id, f.name, f.address_text, f.registration_source
    FROM public.facilities f
    WHERE f.is_active = true AND f.deleted_at IS NULL
      AND (
        public.facility_access_role(f.id) IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.facility_staff fs
          WHERE fs.facility_id=f.id AND fs.worker_id=public.current_worker_id() AND fs.status<>'ended'
        )
      )
  )
  SELECT r.id, r.name, r.address_text, r.registration_source,
    (SELECT count(*)::integer FROM public.facility_staff fs WHERE fs.facility_id=r.id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL) AS member_count,
    (SELECT count(*) FROM public.facility_workroom_messages m
      WHERE m.facility_id=r.id AND m.created_at > COALESCE(
        (SELECT rd.last_read_at FROM public.facility_workroom_reads rd WHERE rd.facility_id=r.id AND rd.user_id=auth.uid()),
        '-infinity'::timestamptz
      ) AND m.sender_user_id IS DISTINCT FROM auth.uid()) AS unread_count,
    (SELECT max(m.created_at) FROM public.facility_workroom_messages m WHERE m.facility_id=r.id) AS last_message_at
  FROM rooms r
  ORDER BY 7 DESC NULLS LAST, r.name;
$$;

REVOKE ALL ON FUNCTION public.send_facility_workroom_message(uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_facility_workroom_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_workrooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_facility_workroom_message(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_facility_workroom_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workrooms() TO authenticated;

-- 전화번호 대신 일회용 링크/QR을 가진 로그인 계정으로 초대를 수락한다.
CREATE OR REPLACE FUNCTION public.claim_facility_staff_invite(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.facility_staff_invites%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_facility_name text;
  v_recipient uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  SELECT * INTO v_worker FROM public.workers
  WHERE id = public.current_worker_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워커 계정을 먼저 완료해 주세요.'; END IF;

  SELECT * INTO v_invite FROM public.facility_staff_invites
  WHERE token = p_token AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '유효하지 않거나 이미 사용한 초대예요.'; END IF;
  IF v_invite.expires_at <= now() THEN
    UPDATE public.facility_staff_invites SET status='expired' WHERE id=v_invite.id;
    RAISE EXCEPTION '초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facility_staff
    WHERE facility_id=v_invite.facility_id AND worker_id=v_worker.id AND id<>v_invite.staff_id
  ) THEN RAISE EXCEPTION '이미 이 근무지의 다른 근무자 정보와 연결돼 있어요.'; END IF;

  UPDATE public.facility_staff
  SET worker_id=v_worker.id,
      name=COALESCE(NULLIF(name,''),v_worker.name),
      updated_at=now()
  WHERE id=v_invite.staff_id AND facility_id=v_invite.facility_id AND status<>'ended'
  RETURNING * INTO v_staff;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION '연결할 근무자 정보를 찾지 못했어요.'; END IF;

  UPDATE public.facility_staff_invites SET
    status='accepted',accepted_by=v_worker.id,accepted_at=now()
  WHERE id=v_invite.id;

  SELECT name INTO v_facility_name FROM public.facilities WHERE id=v_invite.facility_id;
  INSERT INTO public.facility_workroom_messages(
    facility_id,sender_type,sender_name,message_type,body,event_key,metadata
  ) VALUES (
    v_invite.facility_id,'system','잇닿','membership',
    v_staff.name || '님이 워크룸에 참여했어요.',
    'membership:invite:' || v_invite.id::text,
    jsonb_build_object('staffId',v_staff.id,'workerId',v_worker.id)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  FOR v_recipient IN
    SELECT recipient FROM (
      SELECT f.admin_user_id AS recipient FROM public.facilities f
      WHERE f.id=v_invite.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id FROM public.facility_admin_access a
      WHERE a.facility_id=v_invite.facility_id AND a.access_role IN ('owner','operator','super')
    ) admins WHERE recipient IS NOT NULL
  LOOP
    INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
    VALUES(
      v_recipient,'workroom.member_joined',
      'workroom:joined:'||v_invite.id::text||':'||v_recipient::text,
      COALESCE(v_facility_name,'사업장')||' 워크룸 참여',
      v_staff.name||'님이 가입하고 사업장에 연결됐어요.',
      jsonb_build_object('url','/workroom?facility='||v_invite.facility_id::text,'kind','workroom.member_joined','facilityId',v_invite.facility_id)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;
  RETURN v_invite.staff_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_facility_staff_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_facility_staff_invite(uuid) TO authenticated;

-- 초대 미리보기에서 연락처가 없는 초대도 정상 표시한다.
CREATE OR REPLACE FUNCTION public.get_facility_staff_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.facility_staff_invites%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_signed_in boolean := auth.uid() IS NOT NULL;
BEGIN
  SELECT * INTO v_invite FROM public.facility_staff_invites WHERE token=p_token;
  IF NOT FOUND OR v_invite.status IN ('cancelled','accepted') THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID','message','유효하지 않거나 이미 사용한 초대예요.');
  END IF;
  IF v_invite.status='expired' OR v_invite.expires_at<=now() THEN
    RETURN jsonb_build_object('ok',false,'reason','EXPIRED','message','초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.');
  END IF;
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id=v_invite.staff_id AND facility_id=v_invite.facility_id AND status<>'ended';
  SELECT * INTO v_facility FROM public.facilities
  WHERE id=v_invite.facility_id AND is_active=true AND deleted_at IS NULL;
  IF v_staff.id IS NULL OR v_facility.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID','message','연결할 근무 정보를 찾지 못했어요.');
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'isGigworker',v_facility.registration_source='gigworker_trial',
    'facilityName',v_facility.name,'facilityAddress',v_facility.address_text,
    'workerName',v_staff.name,'role',v_staff.role,'workDescription',v_staff.department,
    'contractStart',v_staff.contract_start,'contractEnd',v_staff.contract_end,
    'workWeekdays',v_staff.work_weekdays,'startTime',v_staff.default_start_time,
    'endTime',v_staff.default_end_time,'breakMinutes',v_staff.default_break_minutes,
    'payBasis',CASE WHEN v_signed_in THEN v_staff.pay_basis END,
    'payRate',CASE WHEN v_signed_in THEN v_staff.pay_rate END,
    'payHidden',(NOT v_signed_in) AND v_staff.pay_rate IS NOT NULL,
    'phoneLast4',CASE WHEN v_invite.phone_normalized IS NOT NULL THEN right(v_invite.phone_normalized,4) END,
    'phoneRequired',false,'expiresAt',v_invite.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_facility_staff_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_facility_staff_invite_preview(uuid) TO anon, authenticated;

-- 출퇴근 상태 변경은 워크룸 시스템 이벤트로 자동 기록한다.
CREATE OR REPLACE FUNCTION public.publish_staff_attendance_to_workroom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
  v_body text;
  v_event text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id=NEW.facility_id AND (f.facility_type='gigworker' OR f.registration_source='gigworker_trial')
  ) THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM public.facility_staff WHERE id=NEW.staff_id;
  IF v_name IS NULL THEN RETURN NEW; END IF;

  IF NEW.check_out_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_out_at IS NULL) THEN
    v_event := 'checkout';
    v_body := v_name||'님이 '||to_char(NEW.check_out_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||'에 퇴근했어요.';
  ELSIF NEW.checkout_requested_at IS NOT NULL AND NEW.check_out_at IS NULL
        AND (TG_OP='INSERT' OR OLD.checkout_requested_at IS NULL) THEN
    v_event := 'checkout_request';
    v_body := v_name||'님이 조기 퇴근 확인을 요청했어요.';
  ELSIF NEW.check_in_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_in_at IS NULL) THEN
    v_event := 'checkin';
    v_body := v_name||'님이 '||to_char(NEW.check_in_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||
      CASE WHEN NEW.status='late' THEN '에 지각 출근했어요.' ELSE '에 출근했어요.' END;
  ELSIF NEW.status='absent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'absent') THEN
    v_event := 'absent';
    v_body := v_name||'님이 결근으로 처리됐어요.';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.facility_workroom_messages(
    facility_id,sender_type,sender_name,message_type,body,event_key,metadata
  ) VALUES(
    NEW.facility_id,'system','근태 알림','attendance',v_body,
    'attendance:'||NEW.id::text||':'||v_event,
    jsonb_build_object('attendanceId',NEW.id,'staffId',NEW.staff_id,'workDate',NEW.work_date,'event',v_event)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_staff_attendance_to_workroom ON public.staff_attendances;
CREATE TRIGGER trg_publish_staff_attendance_to_workroom
AFTER INSERT OR UPDATE OF check_in_at,check_out_at,checkout_requested_at,status
ON public.staff_attendances
FOR EACH ROW EXECUTE FUNCTION public.publish_staff_attendance_to_workroom();
REVOKE ALL ON FUNCTION public.publish_staff_attendance_to_workroom() FROM PUBLIC, anon, authenticated;

-- 기존 긱워커 데모도 워크룸을 열었을 때 바로 의미가 보이도록 안내를 한 건 둔다.
INSERT INTO public.facility_workroom_messages(
  facility_id,sender_type,sender_name,message_type,body,event_key
)
SELECT f.id,'system','잇닿','announcement',
       '이제 전화번호나 카카오 친구 추가 없이 이 워크룸에서 공지, 근무 대화, 출퇴근 기록을 함께 확인할 수 있어요.',
       'workroom:welcome:'||f.id::text
FROM public.facilities f
WHERE f.registration_source='gigworker_trial' AND f.is_active=true AND f.deleted_at IS NULL
ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

SELECT
  (SELECT is_nullable='YES' FROM information_schema.columns WHERE table_schema='public' AND table_name='facility_staff_invites' AND column_name='phone_normalized') AS invite_phone_optional_t,
  to_regclass('public.facility_workroom_messages') IS NOT NULL AS workroom_messages_t,
  to_regprocedure('public.send_facility_workroom_message(uuid,text,boolean)') IS NOT NULL AS workroom_send_fn_t,
  position('NULLIF(regexp_replace(COALESCE(p_phone' in pg_get_functiondef((SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='complete_worker_onboarding' ORDER BY p.oid DESC LIMIT 1))) > 0 AS optional_phone_t;
