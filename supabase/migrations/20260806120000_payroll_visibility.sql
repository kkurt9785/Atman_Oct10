-- ============================================================================
-- 급여 열람 권한 분리 (2026-08-06)
-- 사업장 소유자(원장)는 항상 급여를 본다. 위임 관리자(수간호사 등)는
-- can_view_payroll이 켜진 경우에만 급여 화면·CSV·홈 인건비를 볼 수 있다.
-- 기존 super(전권 위임·데모 계정)는 하위호환으로 켜서 시작한다.
-- ============================================================================

ALTER TABLE public.facility_admin_access
  ADD COLUMN IF NOT EXISTS can_view_payroll boolean NOT NULL DEFAULT false;

UPDATE public.facility_admin_access SET can_view_payroll = true
WHERE access_role = 'super' AND can_view_payroll = false;

-- 검증: 컬럼 존재 + super 전부 true (둘 다 true면 성공)
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='facility_admin_access' AND column_name='can_view_payroll')
    AS column_added,
  NOT EXISTS(SELECT 1 FROM public.facility_admin_access
    WHERE access_role='super' AND can_view_payroll=false)
    AS supers_enabled;
