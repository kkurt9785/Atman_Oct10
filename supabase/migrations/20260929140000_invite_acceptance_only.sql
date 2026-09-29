-- 관리자 입력 전화번호는 초대 전달을 돕는 선택 메모일 뿐, 계정 연결 인증 수단이 아니다.
-- 앞으로 facility_staff.worker_id 는 로그인한 워커가 일회용 링크/QR을 직접 수락할 때만 채운다.

DROP TRIGGER IF EXISTS trg_link_facility_staff_worker_by_phone ON public.facility_staff;
DROP FUNCTION IF EXISTS public.link_facility_staff_worker_by_phone();

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

  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = public.current_worker_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워커 계정을 먼저 완료해 주세요.'; END IF;

  SELECT * INTO v_invite
  FROM public.facility_staff_invites
  WHERE token = p_token AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '유효하지 않거나 이미 사용한 초대예요.'; END IF;
  IF v_invite.expires_at <= now() THEN
    RAISE EXCEPTION '초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = v_invite.facility_id AND f.is_active = true AND f.deleted_at IS NULL
  ) THEN RAISE EXCEPTION '현재 연결할 수 없는 근무지예요.'; END IF;

  SELECT * INTO v_staff
  FROM public.facility_staff
  WHERE id = v_invite.staff_id
    AND facility_id = v_invite.facility_id
    AND status <> 'ended'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '연결할 근무자 정보를 찾지 못했어요.'; END IF;

  -- 이미 다른 계정에 연결된 행을 초대 토큰만으로 덮어쓰지 않는다.
  IF v_staff.worker_id IS NOT NULL AND v_staff.worker_id <> v_worker.id THEN
    RAISE EXCEPTION '이미 다른 워커 계정과 연결된 근무 정보예요. 관리자에게 새 초대를 요청해 주세요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facility_staff
    WHERE facility_id = v_invite.facility_id
      AND worker_id = v_worker.id
      AND id <> v_invite.staff_id
  ) THEN RAISE EXCEPTION '이미 이 근무지의 다른 근무자 정보와 연결돼 있어요.'; END IF;

  UPDATE public.facility_staff
  SET worker_id = v_worker.id,
      name = COALESCE(NULLIF(name, ''), v_worker.name),
      updated_at = now()
  WHERE id = v_invite.staff_id
    AND facility_id = v_invite.facility_id
    AND status <> 'ended'
    AND (worker_id IS NULL OR worker_id = v_worker.id)
  RETURNING * INTO v_staff;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION '근무자 연결 상태가 변경됐어요. 관리자에게 새 링크를 요청해 주세요.'; END IF;

  UPDATE public.facility_staff_invites
  SET status = 'accepted', accepted_by = v_worker.id, accepted_at = now()
  WHERE id = v_invite.id;

  -- 같은 근무자 행에 남아 있는 예전 링크는 더 이상 사용할 수 없다.
  UPDATE public.facility_staff_invites
  SET status = 'cancelled'
  WHERE staff_id = v_staff.id AND id <> v_invite.id AND status = 'pending';

  SELECT name INTO v_facility_name
  FROM public.facilities
  WHERE id = v_invite.facility_id;

  INSERT INTO public.facility_workroom_messages(
    facility_id, sender_type, sender_name, message_type, body, event_key, metadata
  ) VALUES (
    v_invite.facility_id, 'system', '잇닿', 'membership',
    v_staff.name || '님이 워크룸에 참여했어요.',
    'membership:invite:' || v_invite.id::text,
    jsonb_build_object('staffId', v_staff.id, 'workerId', v_worker.id)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  FOR v_recipient IN
    SELECT recipient FROM (
      SELECT f.admin_user_id AS recipient
      FROM public.facilities f
      WHERE f.id = v_invite.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id
      FROM public.facility_admin_access a
      WHERE a.facility_id = v_invite.facility_id
        AND a.access_role IN ('owner', 'operator', 'super')
    ) admins
    WHERE recipient IS NOT NULL
  LOOP
    INSERT INTO public.notification_outbox(
      worker_auth_user_id, event_type, dedupe_key, title, body, data
    ) VALUES (
      v_recipient, 'workroom.member_joined',
      'workroom:joined:' || v_invite.id::text || ':' || v_recipient::text,
      COALESCE(v_facility_name, '사업장') || ' 워크룸 참여',
      v_staff.name || '님이 초대를 직접 수락하고 사업장에 연결됐어요.',
      jsonb_build_object(
        'url', '/workroom?facility=' || v_invite.facility_id::text,
        'kind', 'workroom.member_joined',
        'facilityId', v_invite.facility_id,
        'staffId', v_staff.id
      )
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;

  RETURN v_staff.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_facility_staff_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_facility_staff_invite(uuid) TO authenticated;

SELECT
  NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.facility_staff'::regclass
      AND tgname = 'trg_link_facility_staff_worker_by_phone'
      AND NOT tgisinternal
  ) AS phone_auto_link_removed_t,
  position('이미 다른 워커 계정' in pg_get_functiondef('public.claim_facility_staff_invite(uuid)'::regprocedure)) > 0
    AS invite_cannot_overwrite_worker_t;
