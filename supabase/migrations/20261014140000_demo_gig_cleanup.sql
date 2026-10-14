-- 2026-10-14 시연 정리 (docs/QA_2026-10-14_단기근로.md 공존 점검)
-- 긱 시연 사업장(DEMO-GIGWORKER-2026)엔 방문자·QA가 만든 근무·초대·공지가 쌓였다.
-- reset_gigworker_invite_demo 는 고정 근무자의 지급·근태만, revive 는 의료 공고만 치웠기 때문.
-- → 고정 시드(근무자 1 · 초대 1)만 남기고 나머지를 지우는 함수를 두고, reset(시연 시작마다)과 revive(매일 08:30) 양쪽에서 부른다.

CREATE OR REPLACE FUNCTION public.cleanup_gig_demo_facility(p_keep_staff uuid, p_keep_invite uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility uuid;
BEGIN
  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number = 'DEMO-GIGWORKER-2026' AND is_demo = true;
  IF v_facility IS NULL THEN RETURN; END IF;

  -- 워크룸: 공지·대화·확인 요청 전부 (9/22부터 쌓인 자동 근태 알림 포함)
  DELETE FROM public.facility_workroom_messages WHERE facility_id = v_facility;
  DELETE FROM public.facility_workroom_checks WHERE facility_id = v_facility;
  -- 방문자가 만든 초대·근무자 (고정 시드 제외). 지급·배정·근태·계좌 전달은 CASCADE
  DELETE FROM public.facility_staff_invites WHERE facility_id = v_facility AND id <> p_keep_invite;
  DELETE FROM public.facility_staff WHERE facility_id = v_facility AND id <> p_keep_staff;
  -- 참여자가 아무도 없는 근무 건 (방문자가 만든 QA-… 등). 고정 근무자가 배정된 건은 남는다
  DELETE FROM public.gig_projects p
  WHERE p.facility_id = v_facility
    AND NOT EXISTS (SELECT 1 FROM public.gig_assignments a WHERE a.project_id = p.id);
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) TO service_role;

-- reset_gigworker_invite_demo: 기존 삭제 목록 뒤에 정리 함수 호출을 끼운다 (런타임 패치)
DO $patch$
DECLARE r record; v_def text; v_new text; v_hit boolean := false;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'reset_gigworker_invite_demo' LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%cleanup_gig_demo_facility%' THEN v_hit := true; CONTINUE; END IF;
    v_new := replace(v_def,
      E'DELETE FROM public.notification_outbox WHERE worker_auth_user_id=auth.uid();',
      E'DELETE FROM public.notification_outbox WHERE worker_auth_user_id=auth.uid();\n  PERFORM public.cleanup_gig_demo_facility(v_staff, v_invite);');
    IF v_new <> v_def THEN EXECUTE v_new; v_hit := true; END IF;
  END LOOP;
  IF NOT v_hit THEN RAISE EXCEPTION 'demo_gig_cleanup: reset_gigworker_invite_demo source drifted'; END IF;
END
$patch$;
