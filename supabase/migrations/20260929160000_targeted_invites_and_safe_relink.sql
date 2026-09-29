-- 이미 계정을 알고 있는 매칭 워커에게는 지정 초대를 발급한다. 수락 단계는 그대로지만
-- 다른 카카오 계정이 링크를 전달받아도 연결할 수 없다.
ALTER TABLE public.facility_staff_invites
  ADD COLUMN IF NOT EXISTS intended_worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facility_staff_invites_intended_pending
  ON public.facility_staff_invites(facility_id, intended_worker_id, status, expires_at DESC)
  WHERE intended_worker_id IS NOT NULL;

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
  v_display_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;

  SELECT * INTO v_worker FROM public.workers
  WHERE id = public.current_worker_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워커 계정을 먼저 완료해 주세요.'; END IF;

  SELECT * INTO v_invite FROM public.facility_staff_invites
  WHERE token = p_token AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '유효하지 않거나 이미 사용한 초대예요.'; END IF;
  IF v_invite.expires_at <= now() THEN RAISE EXCEPTION '초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.'; END IF;
  IF v_invite.intended_worker_id IS NOT NULL AND v_invite.intended_worker_id <> v_worker.id THEN
    RAISE EXCEPTION '이 초대는 다른 워커 계정에 지정됐어요. 초대를 받은 카카오 계정으로 로그인해 주세요.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = v_invite.facility_id AND f.is_active = true AND f.deleted_at IS NULL
  ) THEN RAISE EXCEPTION '현재 연결할 수 없는 근무지예요.'; END IF;

  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id = v_invite.staff_id AND facility_id = v_invite.facility_id AND status <> 'ended'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '연결할 근무자 정보를 찾지 못했어요.'; END IF;
  IF v_staff.worker_id IS NOT NULL AND v_staff.worker_id <> v_worker.id THEN
    RAISE EXCEPTION '이미 다른 워커 계정과 연결된 근무 정보예요. 관리자에게 새 초대를 요청해 주세요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facility_staff
    WHERE facility_id = v_invite.facility_id AND worker_id = v_worker.id AND id <> v_invite.staff_id
  ) THEN RAISE EXCEPTION '이미 이 근무지의 다른 근무자 정보와 연결돼 있어요.'; END IF;

  UPDATE public.facility_staff
  SET worker_id = v_worker.id, name = COALESCE(NULLIF(name, ''), v_worker.name), updated_at = now()
  WHERE id = v_invite.staff_id AND facility_id = v_invite.facility_id AND status <> 'ended'
    AND (worker_id IS NULL OR worker_id = v_worker.id)
  RETURNING * INTO v_staff;
  IF v_staff.id IS NULL THEN RAISE EXCEPTION '근무자 연결 상태가 변경됐어요. 관리자에게 새 링크를 요청해 주세요.'; END IF;

  UPDATE public.facility_staff_invites
  SET status = 'accepted', accepted_by = v_worker.id, accepted_at = now()
  WHERE id = v_invite.id;
  UPDATE public.facility_staff_invites SET status = 'cancelled'
  WHERE staff_id = v_staff.id AND id <> v_invite.id AND status = 'pending';

  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_invite.facility_id;
  v_display_name := v_staff.name || CASE
    WHEN NULLIF(v_worker.name, '') IS NOT NULL AND v_worker.name <> v_staff.name THEN ' (계정 ' || v_worker.name || ')'
    ELSE '' END;

  INSERT INTO public.facility_workroom_messages(
    facility_id, staff_id, sender_type, sender_name, message_type, body, event_key, metadata
  ) VALUES (
    v_invite.facility_id, CASE WHEN v_staff.worker_kind = 'gig' THEN v_staff.id ELSE NULL END,
    'system', '잇닿', 'membership', v_display_name || '님이 워크룸에 참여했어요.',
    'membership:invite:' || v_invite.id::text,
    jsonb_build_object('staffId', v_staff.id, 'workerId', v_worker.id, 'accountName', v_worker.name)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  FOR v_recipient IN
    SELECT recipient FROM (
      SELECT f.admin_user_id AS recipient FROM public.facilities f
      WHERE f.id = v_invite.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id FROM public.facility_admin_access a
      WHERE a.facility_id = v_invite.facility_id AND a.access_role IN ('owner', 'operator', 'super')
    ) admins WHERE recipient IS NOT NULL
  LOOP
    INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
    VALUES (
      v_recipient, 'workroom.member_joined',
      'workroom:joined:' || v_invite.id::text || ':' || v_recipient::text,
      COALESCE(v_facility_name, '사업장') || ' 워크룸 참여',
      v_display_name || '님이 초대를 직접 수락하고 사업장에 연결됐어요.',
      jsonb_build_object('url','/workroom?facility=' || v_invite.facility_id::text,'kind','workroom.member_joined',
        'facilityId',v_invite.facility_id,'staffId',v_staff.id)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END LOOP;

  RETURN v_staff.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_facility_staff_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_facility_staff_invite(uuid) TO authenticated;

-- 연결만 바꾸면 새 계정이 과거 1:1 대화·근태·정산을 같은 staff_id로 보게 된다.
-- 따라서 잘못 수락한 직후(운영 이력 생성 전)에만 해제·재초대를 허용한다.
CREATE OR REPLACE FUNCTION public.admin_unlink_facility_staff_worker(p_staff_id uuid, p_actor uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_facility_name text;
  v_token uuid;
  v_intended_worker_id uuid;
  v_stamp text := extract(epoch from now())::bigint::text;
BEGIN
  SELECT * INTO v_staff FROM public.facility_staff WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND OR v_staff.status = 'ended' THEN RAISE EXCEPTION '종료됐거나 찾을 수 없는 근무자예요.'; END IF;
  IF v_staff.worker_id IS NULL THEN RAISE EXCEPTION '아직 연결된 계정이 없어요.'; END IF;

  IF EXISTS (SELECT 1 FROM public.staff_attendances WHERE staff_id = p_staff_id)
    OR EXISTS (SELECT 1 FROM public.gig_payouts WHERE staff_id = p_staff_id AND status <> 'cancelled')
    OR EXISTS (
      SELECT 1 FROM public.facility_workroom_messages
      WHERE staff_id = p_staff_id
        AND NOT (sender_type = 'system' AND message_type = 'membership')
    )
    OR EXISTS (SELECT 1 FROM public.staff_leave_requests WHERE staff_id = p_staff_id)
    OR EXISTS (SELECT 1 FROM public.staff_leave_balances WHERE staff_id = p_staff_id AND used_minutes > 0)
  THEN
    RAISE EXCEPTION '근태·정산·1:1 대화 이력이 있어 계정만 바꿀 수 없어요. 기존 근무자를 종료하고 새 근무자로 등록해 주세요.';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_staff.worker_id;
  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_staff.facility_id;
  SELECT i.intended_worker_id INTO v_intended_worker_id
  FROM public.facility_staff_invites i
  WHERE i.staff_id = p_staff_id AND i.intended_worker_id IS NOT NULL
  ORDER BY i.created_at DESC LIMIT 1;

  DELETE FROM public.gig_bank_account_shares WHERE staff_id = p_staff_id;
  UPDATE public.facility_staff_invites SET status = 'cancelled'
  WHERE staff_id = p_staff_id AND status = 'pending';
  UPDATE public.facility_staff SET worker_id = NULL, updated_at = now() WHERE id = p_staff_id;

  INSERT INTO public.facility_staff_invites(
    facility_id, staff_id, phone_normalized, intended_worker_id, created_by, expires_at
  ) VALUES (
    v_staff.facility_id, p_staff_id,
    NULLIF(regexp_replace(COALESCE(v_staff.phone, ''), '\D', '', 'g'), ''),
    v_intended_worker_id, p_actor, now() + interval '7 days'
  ) RETURNING token INTO v_token;

  INSERT INTO public.facility_workroom_messages(
    facility_id,staff_id,sender_type,sender_name,message_type,body,event_key,metadata
  ) VALUES (
    v_staff.facility_id,CASE WHEN v_staff.worker_kind='gig' THEN p_staff_id ELSE NULL END,
    'system','잇닿','membership',v_staff.name || '님의 계정 연결을 초기화했어요. 새 초대를 보내 주세요.',
    'membership:unlink:' || p_staff_id::text || ':' || v_stamp,
    jsonb_build_object('staffId',p_staff_id)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  IF v_worker.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
    VALUES (
      v_worker.auth_user_id,'workroom.member_unlinked','workroom:unlinked:' || p_staff_id::text || ':' || v_stamp,
      COALESCE(v_facility_name,'사업장') || ' 연결 해제',
      '관리자가 근무 연결을 해제했어요. 본인 근무가 맞다면 관리자에게 새 초대를 요청해 주세요.',
      jsonb_build_object('kind','workroom.member_unlinked','facilityId',v_staff.facility_id,'staffId',p_staff_id)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlink_facility_staff_worker(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_facility_staff_worker(uuid, uuid) TO service_role;

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facility_staff_invites' AND column_name='intended_worker_id') AS intended_worker_t,
  position('다른 워커 계정에 지정' IN pg_get_functiondef('public.claim_facility_staff_invite(uuid)'::regprocedure)) > 0 AS targeted_claim_t,
  position('근태·정산·1:1 대화 이력' IN pg_get_functiondef('public.admin_unlink_facility_staff_worker(uuid,uuid)'::regprocedure)) > 0 AS safe_relink_t;
