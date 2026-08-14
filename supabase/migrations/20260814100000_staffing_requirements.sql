-- Facility-defined minimum staffing levels. These are operating requirements,
-- not job postings: the recommendation engine compares them with fixed staff,
-- approved leave, absences and accepted marketplace shifts.

CREATE TABLE IF NOT EXISTS public.staffing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  department text,
  required_role text NOT NULL,
  weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  start_time time NOT NULL,
  end_time time NOT NULL,
  required_headcount integer NOT NULL CHECK (required_headcount BETWEEN 1 AND 100),
  replacement_hourly_wage integer NOT NULL CHECK (replacement_hourly_wage BETWEEN 10000 AND 1000000),
  replacement_description text NOT NULL CHECK (char_length(replacement_description) BETWEEN 1 AND 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  )
);

CREATE INDEX IF NOT EXISTS idx_staffing_requirements_active
  ON public.staffing_requirements(facility_id, is_active, department, required_role);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staffing_requirement_scope
  ON public.staffing_requirements(
    facility_id,
    COALESCE(department, ''),
    required_role,
    start_time,
    end_time,
    weekdays
  ) WHERE is_active;

ALTER TABLE public.staffing_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staffing_requirements_read ON public.staffing_requirements;
CREATE POLICY staffing_requirements_read ON public.staffing_requirements FOR SELECT TO authenticated
  USING (public.facility_access_role(facility_id) IS NOT NULL);

REVOKE INSERT, UPDATE, DELETE ON public.staffing_requirements FROM anon, authenticated;
GRANT SELECT ON public.staffing_requirements TO authenticated;

DROP TRIGGER IF EXISTS staffing_requirements_updated_at ON public.staffing_requirements;
CREATE TRIGGER staffing_requirements_updated_at
  BEFORE UPDATE ON public.staffing_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.staffing_requirements IS
  '병동·직군·시간대별 최소 운영 인원과 부족 시 대체 공고 기본 조건';
