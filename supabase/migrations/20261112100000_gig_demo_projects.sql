-- 2026-11-12 단기 시연에 근무 건 3개 (사용자 요청: 근무 탭이 비어 "첫 근무를 만들어 보세요"만 보였다)
-- 시연 정리(cleanup_gig_demo_facility)는 근무자 시연을 시작할 때마다·매일 08:30 고정 근무자 1명만 남기고 다 지운다.
-- → 근무 건 3개와 참여자 5명(앱 미연결·초대 대기)을 다시 만드는 함수를 두고, 정리 함수 끝에서 부른다.
-- 고정 시연 근무자는 근무 건에 넣지 않는다 — 출퇴근 근태가 근무 건 참여로 붙으면 시연 출퇴근 흐름이 바뀐다.
-- 날짜는 오늘 기준(지난 2주 ~ 앞으로 60일): 최저시급 기준이 2026·2027년만 있어 1년짜리는 해가 바뀌면 저장이 막힌다.

CREATE OR REPLACE FUNCTION public.seed_gig_demo_projects()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility uuid;
  v_admin uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  p_weekend constant uuid := '20261112-0000-4000-8000-0000000000a1';
  p_weekday constant uuid := '20261112-0000-4000-8000-0000000000a2';
  p_setup   constant uuid := '20261112-0000-4000-8000-0000000000a3';
BEGIN
  SELECT f.id, f.admin_user_id INTO v_facility, v_admin
  FROM public.facilities f
  WHERE f.business_registration_number = 'DEMO-GIGWORKER-2026' AND f.is_demo AND f.is_active AND f.deleted_at IS NULL;
  IF v_facility IS NULL THEN RETURN; END IF;

  INSERT INTO public.gig_projects (id, facility_id, title, starts_on, ends_on, work_weekdays, start_time, end_time,
    break_minutes, pay_basis, pay_rate, headcount, note, status, created_by)
  VALUES
    (p_weekend, v_facility, '주말 팝업 행사 운영', v_today - 14, v_today + 60, ARRAY[6,7]::smallint[], '11:00', '19:00',
      60, 'hourly', 12000, 4, '입구 안내·줄 정리·굿즈 판매', 'active', v_admin),
    (p_weekday, v_facility, '평일 매장 오픈 준비·진열', v_today - 14, v_today + 60, ARRAY[1,2,3,4,5]::smallint[], '08:00', '12:00',
      0, 'hourly', 11500, 2, '입고 정리·진열·매장 청소', 'active', v_admin),
    (p_setup, v_facility, '행사장 설치·철수 (3일)', v_today + 21, v_today + 23, ARRAY[1,2,3,4,5,6,7]::smallint[], '09:00', '18:00',
      60, 'daily', 130000, 6, '부스 설치·자재 운반·철수', 'active', v_admin)
  ON CONFLICT (id) DO UPDATE SET
    facility_id = EXCLUDED.facility_id, title = EXCLUDED.title, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
    work_weekdays = EXCLUDED.work_weekdays, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
    break_minutes = EXCLUDED.break_minutes, pay_basis = EXCLUDED.pay_basis, pay_rate = EXCLUDED.pay_rate,
    headcount = EXCLUDED.headcount, note = EXCLUDED.note, status = 'active', updated_at = now();

  -- 참여자(앱 미연결). 김하늘은 주말 행사와 설치·철수에 같이 들어간다.
  INSERT INTO public.facility_staff (id, facility_id, worker_id, name, phone, worker_kind, role, department, source,
    engagement_type, contract_start, contract_end, work_weekdays, default_start_time, default_end_time,
    default_break_minutes, pay_basis, pay_rate, status, created_by)
  SELECT s.id, v_facility, NULL, s.name, NULL, 'gig', 'other', p.title, 'direct',
    'temporary', p.starts_on, p.ends_on, p.work_weekdays, p.start_time, p.end_time,
    p.break_minutes, p.pay_basis, p.pay_rate, 'active', v_admin
  FROM (VALUES
    ('20261112-0000-4000-8000-0000000000b1'::uuid, '김하늘', p_weekend),
    ('20261112-0000-4000-8000-0000000000b2'::uuid, '이준호', p_weekend),
    ('20261112-0000-4000-8000-0000000000b3'::uuid, '박서연', p_weekend),
    ('20261112-0000-4000-8000-0000000000b4'::uuid, '최민재', p_weekday),
    ('20261112-0000-4000-8000-0000000000b5'::uuid, '정유진', p_weekday)
  ) AS s(id, name, project_id)
  JOIN public.gig_projects p ON p.id = s.project_id
  ON CONFLICT (id) DO UPDATE SET
    facility_id = EXCLUDED.facility_id, worker_id = NULL, name = EXCLUDED.name, worker_kind = 'gig',
    department = EXCLUDED.department, contract_start = EXCLUDED.contract_start, contract_end = EXCLUDED.contract_end,
    work_weekdays = EXCLUDED.work_weekdays, default_start_time = EXCLUDED.default_start_time,
    default_end_time = EXCLUDED.default_end_time, default_break_minutes = EXCLUDED.default_break_minutes,
    pay_basis = EXCLUDED.pay_basis, pay_rate = EXCLUDED.pay_rate, status = 'active';

  INSERT INTO public.gig_assignments (facility_id, staff_id, project_id, created_by)
  SELECT v_facility, a.staff_id, a.project_id, v_admin
  FROM (VALUES
    ('20261112-0000-4000-8000-0000000000b1'::uuid, p_weekend),
    ('20261112-0000-4000-8000-0000000000b2'::uuid, p_weekend),
    ('20261112-0000-4000-8000-0000000000b3'::uuid, p_weekend),
    ('20261112-0000-4000-8000-0000000000b4'::uuid, p_weekday),
    ('20261112-0000-4000-8000-0000000000b5'::uuid, p_weekday),
    ('20261112-0000-4000-8000-0000000000b1'::uuid, p_setup)
  ) AS a(staff_id, project_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.gig_assignments g
    WHERE g.project_id = a.project_id AND g.staff_id = a.staff_id AND g.status <> 'cancelled'
  );

  -- 초대 대기로 보이게 일회용 초대를 하나씩 둔다(시연 사업장엔 실제 계정이 연결되지 않는다 — guard_facility_worker_demo_scope).
  INSERT INTO public.facility_staff_invites (facility_id, staff_id, created_by)
  SELECT v_facility, s.id, v_admin
  FROM public.facility_staff s
  WHERE s.facility_id = v_facility AND s.id::text LIKE '20261112-0000-4000-8000-0000000000b%'
    AND NOT EXISTS (
      SELECT 1 FROM public.facility_staff_invites i
      WHERE i.staff_id = s.id AND i.status = 'pending' AND i.expires_at > now()
    );
END;
$$;
REVOKE ALL ON FUNCTION public.seed_gig_demo_projects() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_gig_demo_projects() TO service_role;

-- 정리 함수: 기존 내용 그대로 + 끝에서 시연 근무 건을 다시 만든다.
-- 시연 시작(reset)을 막지 않게, 다시 만들기가 실패해도 정리는 끝낸다.
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

  -- 시연용 근무 건 3개를 다시 만든다(2026-11-12)
  BEGIN
    PERFORM public.seed_gig_demo_projects();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'seed_gig_demo_projects skipped: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_gig_demo_facility(uuid, uuid) TO service_role;

-- 지금 바로 한 번 만든다. 여기서 실패하면 마이그레이션 전체가 되돌아간다.
SELECT public.seed_gig_demo_projects();
