-- 긱 운영의 1급 객체를 "사람"에서 "근무 건(프로젝트)"으로 올린다.
-- 사장님은 근무 건(단기 행사·반복 근무)을 먼저 만들고 거기에 여러 명을 넣는다. 급여는 근무 건의 시급이 기준.
--   gig_projects   : 근무 건 (기간·반복요일·시간·휴게·시급·필요 인원)
--   gig_assignments: 사람 × 근무 건 (project_id). 워커 앱·근태·지급이 읽는 일정 필드는 근무 건에서 복사해 둔다.
-- 기존 사람별 호환 건(source='staff_compat')은 그대로 둔다. 근무 건 참여가 하나라도 있으면 앱은 그것만 일정으로 본다.

CREATE TABLE IF NOT EXISTS public.gig_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  work_weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[]
    CHECK (cardinality(work_weekdays) BETWEEN 1 AND 7 AND work_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  pay_basis text NOT NULL DEFAULT 'hourly' CHECK (pay_basis IN ('hourly','daily')),
  pay_rate integer CHECK (pay_rate IS NULL OR pay_rate > 0),
  headcount integer NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gig_projects_facility_dates ON public.gig_projects(facility_id, starts_on, ends_on, status);

ALTER TABLE public.gig_assignments
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.gig_projects(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gig_assignments_project_staff
  ON public.gig_assignments(project_id, staff_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gig_assignments_project ON public.gig_assignments(project_id);

-- RLS: 관리자는 사업장 것, 워커는 자기가 참여한 근무 건만
ALTER TABLE public.gig_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gig_projects_admin_read ON public.gig_projects;
CREATE POLICY gig_projects_admin_read ON public.gig_projects FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS gig_projects_worker_read ON public.gig_projects;
CREATE POLICY gig_projects_worker_read ON public.gig_projects FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.gig_assignments ga JOIN public.facility_staff fs ON fs.id=ga.staff_id
    WHERE ga.project_id=gig_projects.id AND fs.worker_id=public.current_worker_id()
  ));
REVOKE ALL ON public.gig_projects FROM anon, authenticated;
GRANT SELECT ON public.gig_projects TO authenticated;

-- 근무 건을 고치면 참여 건의 일정·급여가 따라간다 (관리자 앱은 서비스 키로 쓰므로 트리거가 정합성을 맡는다)
CREATE OR REPLACE FUNCTION public.sync_gig_project_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  UPDATE public.gig_assignments SET
    title=NEW.title, starts_on=NEW.starts_on, ends_on=NEW.ends_on, work_weekdays=NEW.work_weekdays,
    start_time=NEW.start_time, end_time=NEW.end_time, break_minutes=NEW.break_minutes,
    pay_basis=NEW.pay_basis, pay_rate=NEW.pay_rate,
    status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' WHEN NEW.status='completed' THEN 'completed' ELSE 'active' END,
    updated_at=now()
  WHERE project_id=NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_gig_project_assignments ON public.gig_projects;
CREATE TRIGGER trg_sync_gig_project_assignments
AFTER UPDATE OF title,starts_on,ends_on,work_weekdays,start_time,end_time,break_minutes,pay_basis,pay_rate,status
ON public.gig_projects FOR EACH ROW EXECUTE FUNCTION public.sync_gig_project_assignments();
REVOKE ALL ON FUNCTION public.sync_gig_project_assignments() FROM PUBLIC,anon,authenticated;

-- 참여 건이 근무 건의 일정을 늘 따르도록, 삽입·수정 시에도 근무 건 값을 우선한다
CREATE OR REPLACE FUNCTION public.fill_gig_assignment_from_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_p public.gig_projects%ROWTYPE;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_p FROM public.gig_projects WHERE id=NEW.project_id;
  IF v_p.id IS NULL THEN RAISE EXCEPTION '근무 건을 찾을 수 없어요'; END IF;
  IF v_p.facility_id<>NEW.facility_id THEN RAISE EXCEPTION '근무 건과 근무지가 일치하지 않아요'; END IF;
  NEW.title:=v_p.title; NEW.starts_on:=v_p.starts_on; NEW.ends_on:=v_p.ends_on; NEW.work_weekdays:=v_p.work_weekdays;
  NEW.start_time:=v_p.start_time; NEW.end_time:=v_p.end_time; NEW.break_minutes:=v_p.break_minutes;
  NEW.pay_basis:=v_p.pay_basis; NEW.pay_rate:=v_p.pay_rate; NEW.source:='admin';
  IF NEW.status IS NULL OR NEW.status='planned' THEN NEW.status:='active'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fill_gig_assignment_from_project ON public.gig_assignments;
CREATE TRIGGER trg_fill_gig_assignment_from_project
BEFORE INSERT OR UPDATE OF project_id ON public.gig_assignments
FOR EACH ROW EXECUTE FUNCTION public.fill_gig_assignment_from_project();
REVOKE ALL ON FUNCTION public.fill_gig_assignment_from_project() FROM PUBLIC,anon,authenticated;

-- 근태에 근무 건 연결: 사람별 호환 건보다 근무 건 참여를 먼저 잡는다
CREATE OR REPLACE FUNCTION public.attach_gig_assignment_to_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NEW.gig_assignment_id IS NULL THEN
    SELECT ga.id INTO NEW.gig_assignment_id FROM public.gig_assignments ga
    WHERE ga.staff_id=NEW.staff_id AND NEW.work_date BETWEEN ga.starts_on AND ga.ends_on
      AND extract(isodow FROM NEW.work_date)::smallint=ANY(ga.work_weekdays)
      AND ga.status<>'cancelled'
    ORDER BY (ga.source='staff_compat'), ga.created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_gig_assignment_to_attendance() FROM PUBLIC,anon,authenticated;

SELECT
  to_regclass('public.gig_projects') IS NOT NULL AS gig_projects_t,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gig_assignments' AND column_name='project_id') AS assignment_project_col_t,
  to_regprocedure('public.sync_gig_project_assignments()') IS NOT NULL AS sync_fn_t;
