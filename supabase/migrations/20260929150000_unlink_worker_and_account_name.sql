-- 초대 링크는 소지자 인증이라 다른 사람이 열어 수락할 수 있다. 관리자가 그 연결을 되돌리고
-- 새 일회용 초대를 바로 받을 수 있어야 하고, 누가 수락했는지(계정 이름) 관리자에게 보여야 한다.

-- 1) 연결 해제 + 재초대 (서비스 롤 전용 — 앱 서버 액션이 관리자 권한을 확인한 뒤 호출한다)
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
  v_open integer;
  v_token uuid;
  v_stamp text := extract(epoch from now())::bigint::text;
BEGIN
  SELECT * INTO v_staff FROM public.facility_staff WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND OR v_staff.status = 'ended' THEN RAISE EXCEPTION '종료됐거나 찾을 수 없는 근무자예요.'; END IF;
  IF v_staff.worker_id IS NULL THEN RAISE EXCEPTION '아직 연결된 계정이 없어요.'; END IF;

  SELECT count(*) INTO v_open FROM public.staff_attendances
  WHERE staff_id = p_staff_id AND status IN ('working', 'late', 'checkout_pending');
  IF v_open > 0 THEN RAISE EXCEPTION '출근 중이거나 승인 대기인 근태를 먼저 확정해 주세요.'; END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_staff.worker_id;
  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_staff.facility_id;

  -- 수락 시점에 전달된 계좌는 연결과 함께 회수한다.
  DELETE FROM public.gig_bank_account_shares WHERE staff_id = p_staff_id;
  UPDATE public.facility_staff_invites SET status = 'cancelled'
  WHERE staff_id = p_staff_id AND status = 'pending';
  UPDATE public.facility_staff SET worker_id = NULL, updated_at = now() WHERE id = p_staff_id;

  INSERT INTO public.facility_staff_invites(facility_id, staff_id, phone_normalized, created_by, expires_at)
  VALUES (
    v_staff.facility_id, p_staff_id,
    NULLIF(regexp_replace(COALESCE(v_staff.phone, ''), '\D', '', 'g'), ''),
    p_actor, now() + interval '7 days'
  ) RETURNING token INTO v_token;

  INSERT INTO public.facility_workroom_messages(
    facility_id, sender_type, sender_name, message_type, body, event_key, metadata
  ) VALUES (
    v_staff.facility_id, 'system', '잇닿', 'membership',
    v_staff.name || '님의 계정 연결을 해제했어요. 새 초대를 보내 주세요.',
    'membership:unlink:' || p_staff_id::text || ':' || v_stamp,
    jsonb_build_object('staffId', p_staff_id, 'workerId', v_staff.worker_id, 'accountName', v_worker.name)
  ) ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;

  IF v_worker.auth_user_id IS NOT NULL THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id, event_type, dedupe_key, title, body, data)
    VALUES (
      v_worker.auth_user_id, 'workroom.member_unlinked',
      'workroom:unlinked:' || p_staff_id::text || ':' || v_stamp,
      COALESCE(v_facility_name, '사업장') || ' 연결 해제',
      '관리자가 근무 연결을 해제했어요. 본인 근무가 맞다면 관리자에게 새 초대를 요청해 주세요.',
      jsonb_build_object('kind', 'workroom.member_unlinked', 'facilityId', v_staff.facility_id, 'staffId', p_staff_id)
    ) ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_unlink_facility_staff_worker(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlink_facility_staff_worker(uuid, uuid) TO service_role;

-- 2) 수락 알림·워크룸 메시지에 계정 이름을 붙인다 (관리자 입력 이름과 다를 때만).
--    claim 함수 본문은 20260929140000 그대로 두고 문자열만 바꾼다.
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.claim_facility_staff_invite(uuid)'::regprocedure);
  v_tag text := $tag$v_staff.name || CASE WHEN NULLIF(v_worker.name, '') IS NOT NULL AND v_worker.name <> v_staff.name THEN ' (계정 ' || v_worker.name || ')' ELSE '' END$tag$;
BEGIN
  IF position($x$v_staff.name || '님이 워크룸에 참여했어요.'$x$ IN v_def) = 0
     OR position($x$v_staff.name || '님이 초대를 직접 수락하고 사업장에 연결됐어요.'$x$ IN v_def) = 0
     OR position($x$jsonb_build_object('staffId', v_staff.id, 'workerId', v_worker.id)$x$ IN v_def) = 0 THEN
    RAISE EXCEPTION 'claim_facility_staff_invite 본문이 예상과 달라요. 20260929140000 이후 변경을 확인하세요.';
  END IF;
  v_def := replace(v_def, $x$v_staff.name || '님이 워크룸에 참여했어요.'$x$, v_tag || $x$ || '님이 워크룸에 참여했어요.'$x$);
  v_def := replace(v_def, $x$v_staff.name || '님이 초대를 직접 수락하고 사업장에 연결됐어요.'$x$, v_tag || $x$ || '님이 초대를 직접 수락하고 사업장에 연결됐어요.'$x$);
  v_def := replace(v_def, $x$jsonb_build_object('staffId', v_staff.id, 'workerId', v_worker.id)$x$, $x$jsonb_build_object('staffId', v_staff.id, 'workerId', v_worker.id, 'accountName', v_worker.name)$x$);
  EXECUTE v_def;
END $$;

SELECT
  has_function_privilege('authenticated', 'public.admin_unlink_facility_staff_worker(uuid, uuid)', 'EXECUTE') = false AS unlink_service_only_t,
  position('accountName' IN pg_get_functiondef('public.claim_facility_staff_invite(uuid)'::regprocedure)) > 0 AS claim_records_account_name_t;
