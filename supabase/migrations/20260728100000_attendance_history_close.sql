-- 월별 근태 마감과 관리자 수정 이력. 임금 원장과 분리된 운영 감사 데이터.
CREATE TABLE IF NOT EXISTS public.attendance_period_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (period_month=date_trunc('month',period_month)::date),
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(facility_id,period_month)
);
CREATE TABLE IF NOT EXISTS public.staff_attendance_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  attendance_id uuid NOT NULL REFERENCES public.staff_attendances(id) ON DELETE RESTRICT,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('correct','close_period','reopen_period')),
  reason text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_changes ON public.staff_attendance_change_logs(attendance_id,created_at DESC);
ALTER TABLE public.attendance_period_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance_change_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_closures_read ON public.attendance_period_closures;
CREATE POLICY attendance_closures_read ON public.attendance_period_closures FOR SELECT
  USING(public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS staff_attendance_changes_read ON public.staff_attendance_change_logs;
CREATE POLICY staff_attendance_changes_read ON public.staff_attendance_change_logs FOR SELECT
  USING(public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT,UPDATE,DELETE ON public.attendance_period_closures,public.staff_attendance_change_logs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.attendance_period_closures,public.staff_attendance_change_logs TO authenticated;
