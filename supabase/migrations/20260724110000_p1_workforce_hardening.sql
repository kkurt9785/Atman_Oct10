-- ============================================================================
-- P1 워크포스 하드닝 (2026-07-24 리뷰 후속)
--   ① staff_leave_requests.status 기본값 approved → pending
--      (status 생략 INSERT가 결재·잔여차감 없이 자동 승인되던 footgun 차단)
--   ② 레거시 v1 submit_staff_leave_request를 authenticated에서 REVOKE
--      (다중 병원 워커 휴가가 최근생성 staff로 오귀속되던 문제 — v2가 대체)
-- ※ 관리자 쓰기 경로는 grant가 anon/authenticated에서 이미 REVOKE되어 있어
--   service_role 백엔드(서버 액션, requireAdminContext+facility 스코프) 전용.
--   이는 표준 패턴이며 RLS write 정책 추가는 오히려 grant를 열어야 해 미적용.
-- ============================================================================

-- ① 기본값 교정 (기존 행 값은 건드리지 않음)
ALTER TABLE public.staff_leave_requests
  ALTER COLUMN status SET DEFAULT 'pending';

-- ② 레거시 v1 휴가 신청 함수 회수 (authenticated 호출 차단). v2만 사용.
DO $$
BEGIN
  IF to_regprocedure('public.submit_staff_leave_request(text,date,date,integer,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.submit_staff_leave_request(text,date,date,integer,text) FROM authenticated;
  END IF;
END $$;

-- 검증
SELECT
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='staff_leave_requests' AND column_name='status') AS status_default,
  has_function_privilege('authenticated',
    'public.submit_staff_leave_request(text,date,date,integer,text)', 'EXECUTE') AS v1_authenticated_can_exec;
