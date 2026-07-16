-- Hospital workforce pool + repeat-shift operations.
-- Existing public shift, attendance and direct-wage flows remain compatible.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS invited_worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS generation_batch_id uuid;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_audience_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_audience_check CHECK (audience IN ('public','invited'));
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_invited_audience_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_invited_audience_check CHECK (
    (audience = 'public' AND invited_worker_id IS NULL)
    OR (audience = 'invited' AND invited_worker_id IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS idx_shifts_invited_worker
  ON public.shifts(invited_worker_id, shift_date)
  WHERE audience = 'invited';

ALTER TABLE public.shift_applications DROP CONSTRAINT IF EXISTS shift_applications_status_check;
ALTER TABLE public.shift_applications ADD CONSTRAINT shift_applications_status_check
  CHECK (status IN ('invited','applied','accepted','rejected','cancelled','expired','completed'));

CREATE TABLE IF NOT EXISTS public.facility_worker_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','do_not_invite')),
  source text NOT NULL DEFAULT 'accepted_shift' CHECK (source IN ('accepted_shift','completed_shift','manual')),
  first_worked_at date,
  last_worked_at date,
  completed_shift_count integer NOT NULL DEFAULT 0 CHECK (completed_shift_count >= 0),
  total_worked_minutes integer NOT NULL DEFAULT 0 CHECK (total_worked_minutes >= 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_facility_worker_pool_active
  ON public.facility_worker_pool(facility_id, last_worked_at DESC NULLS LAST)
  WHERE status = 'active';
ALTER TABLE public.facility_worker_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_worker_pool_read ON public.facility_worker_pool;
CREATE POLICY facility_worker_pool_read ON public.facility_worker_pool FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.facility_worker_pool FROM anon, authenticated;
GRANT SELECT ON public.facility_worker_pool TO authenticated;

CREATE TABLE IF NOT EXISTS public.shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  required_role text NOT NULL CHECK (required_role IN ('rn','na','any')),
  weekdays smallint[] NOT NULL DEFAULT '{}' CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_time time NOT NULL,
  end_time time NOT NULL,
  hourly_wage integer NOT NULL CHECK (hourly_wage >= 10320),
  description text NOT NULL,
  department text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shift_templates_facility
  ON public.shift_templates(facility_id, is_active, created_at DESC);
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_templates_read ON public.shift_templates;
CREATE POLICY shift_templates_read ON public.shift_templates FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.shift_templates FROM anon, authenticated;
GRANT SELECT ON public.shift_templates TO authenticated;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_template_id_fkey;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_template_id_fkey FOREIGN KEY (template_id)
  REFERENCES public.shift_templates(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_shift_date
  ON public.shifts(template_id, shift_date)
  WHERE template_id IS NOT NULL AND status <> 'cancelled';

-- Build a useful initial pool from prior accepted work.
INSERT INTO public.facility_worker_pool (
  facility_id, worker_id, source, first_worked_at, last_worked_at,
  completed_shift_count, total_worked_minutes
)
SELECT
  s.facility_id,
  a.worker_id,
  CASE WHEN bool_or(s.status = 'completed') THEN 'completed_shift' ELSE 'accepted_shift' END,
  min(s.shift_date),
  max(s.shift_date),
  count(*) FILTER (WHERE s.status = 'completed')::integer,
  COALESCE(sum(att.actual_minutes) FILTER (WHERE s.status = 'completed'), 0)::integer
FROM public.shift_applications a
JOIN public.shifts s ON s.id = a.shift_id
LEFT JOIN public.shift_attendances att ON att.application_id = a.id
WHERE a.status IN ('accepted','completed')
GROUP BY s.facility_id, a.worker_id
ON CONFLICT (facility_id, worker_id) DO UPDATE SET
  first_worked_at = LEAST(public.facility_worker_pool.first_worked_at, EXCLUDED.first_worked_at),
  last_worked_at = GREATEST(public.facility_worker_pool.last_worked_at, EXCLUDED.last_worked_at),
  completed_shift_count = GREATEST(public.facility_worker_pool.completed_shift_count, EXCLUDED.completed_shift_count),
  total_worked_minutes = GREATEST(public.facility_worker_pool.total_worked_minutes, EXCLUDED.total_worked_minutes),
  updated_at = now();

-- Pool stats are recomputed from source-of-truth rows (not incremented) so
-- late corrections — e.g. a manual check-out override that regenerates
-- attendance.actual_minutes — can never drift the pool.
CREATE OR REPLACE FUNCTION public.recompute_facility_worker_pool(p_facility_id uuid, p_worker_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.facility_worker_pool (
    facility_id, worker_id, source, first_worked_at, last_worked_at,
    completed_shift_count, total_worked_minutes
  )
  SELECT
    p_facility_id, p_worker_id,
    CASE WHEN bool_or(a.status = 'completed') THEN 'completed_shift' ELSE 'accepted_shift' END,
    min(s.shift_date), max(s.shift_date),
    count(*) FILTER (WHERE a.status = 'completed')::integer,
    COALESCE(sum(att.actual_minutes) FILTER (WHERE a.status = 'completed'), 0)::integer
  FROM public.shift_applications a
  JOIN public.shifts s ON s.id = a.shift_id
  LEFT JOIN public.shift_attendances att ON att.application_id = a.id
  WHERE s.facility_id = p_facility_id
    AND a.worker_id = p_worker_id
    AND a.status IN ('accepted','completed')
  HAVING count(*) > 0
  ON CONFLICT (facility_id, worker_id) DO UPDATE SET
    source = CASE WHEN public.facility_worker_pool.source = 'manual' THEN 'manual' ELSE EXCLUDED.source END,
    first_worked_at = EXCLUDED.first_worked_at,
    last_worked_at = EXCLUDED.last_worked_at,
    completed_shift_count = EXCLUDED.completed_shift_count,
    total_worked_minutes = EXCLUDED.total_worked_minutes,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.sync_facility_worker_pool()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_facility_id uuid;
BEGIN
  IF NEW.status NOT IN ('accepted','completed') THEN RETURN NEW; END IF;
  SELECT facility_id INTO v_facility_id FROM public.shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM public.recompute_facility_worker_pool(v_facility_id, NEW.worker_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_facility_worker_pool ON public.shift_applications;
CREATE TRIGGER trg_sync_facility_worker_pool
  AFTER INSERT OR UPDATE OF status ON public.shift_applications
  FOR EACH ROW EXECUTE FUNCTION public.sync_facility_worker_pool();

-- Late attendance corrections resync the pool for the affected worker.
CREATE OR REPLACE FUNCTION public.resync_pool_on_attendance_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_app public.shift_applications%ROWTYPE; v_facility_id uuid;
BEGIN
  SELECT * INTO v_app FROM public.shift_applications WHERE id = NEW.application_id;
  IF NOT FOUND OR v_app.status NOT IN ('accepted','completed') THEN RETURN NEW; END IF;
  SELECT facility_id INTO v_facility_id FROM public.shifts WHERE id = v_app.shift_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM public.recompute_facility_worker_pool(v_facility_id, v_app.worker_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_resync_pool_on_attendance_change ON public.shift_attendances;
CREATE TRIGGER trg_resync_pool_on_attendance_change
  AFTER UPDATE OF check_in_at, check_out_at ON public.shift_attendances
  FOR EACH ROW EXECUTE FUNCTION public.resync_pool_on_attendance_change();

-- Invited shifts must never leak into public discovery.
-- The patch FAILS LOUDLY if the target function is missing or its source
-- drifted — a silent no-op here would ship an audience leak.
DO $patch$
DECLARE v_sql text; v_patched text; v_proc regprocedure;
BEGIN
  v_proc := to_regprocedure('public.get_nearby_open_shifts_secure(double precision,double precision,text[])');
  IF v_proc IS NULL THEN
    RAISE EXCEPTION 'workforce_operations: get_nearby_open_shifts_secure not found — audience filter cannot be applied';
  END IF;
  SELECT pg_get_functiondef(v_proc) INTO v_sql;
  IF v_sql NOT LIKE '%COALESCE(s.audience, ''public'') = ''public''%' THEN
    v_patched := replace(
      v_sql,
      'WHERE s.status = ''open''',
      'WHERE s.status = ''open'' AND COALESCE(s.audience, ''public'') = ''public'''
    );
    IF v_patched = v_sql THEN
      RAISE EXCEPTION 'workforce_operations: get_nearby_open_shifts_secure source drifted — apply the audience = public filter manually';
    END IF;
    EXECUTE v_patched;
  END IF;

  v_proc := to_regprocedure('public.apply_to_shift(uuid)');
  IF v_proc IS NULL THEN
    RAISE EXCEPTION 'workforce_operations: apply_to_shift not found — invited-worker guard cannot be applied';
  END IF;
  SELECT pg_get_functiondef(v_proc) INTO v_sql;
  IF v_sql NOT LIKE '%v_shift.invited_worker_id <> v_worker.id%' THEN
    v_patched := replace(
      v_sql,
      'IF v_shift.shift_date <',
      'IF v_shift.audience = ''invited'' AND v_shift.invited_worker_id <> v_worker.id THEN RAISE EXCEPTION ''초대받은 워커만 지원할 수 있어요''; END IF; IF v_shift.shift_date <'
    );
    IF v_patched = v_sql THEN
      RAISE EXCEPTION 'workforce_operations: apply_to_shift source drifted — apply the invited-worker guard manually';
    END IF;
    EXECUTE v_patched;
  END IF;
END $patch$;

CREATE OR REPLACE FUNCTION public.respond_to_shift_invitation(p_application_id uuid, p_accept boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_worker_id uuid := public.current_worker_id();
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  UPDATE public.shift_applications AS a
  SET status = CASE WHEN p_accept THEN 'applied' ELSE 'cancelled' END,
      applied_at = CASE WHEN p_accept THEN now() ELSE applied_at END,
      cancelled_at = CASE WHEN p_accept THEN NULL ELSE now() END
  FROM public.shifts AS s
  WHERE a.id = p_application_id
    AND a.shift_id = s.id
    AND a.worker_id = v_worker_id
    AND a.status = 'invited'
    AND s.status = 'open'
    AND s.audience = 'invited'
    AND s.invited_worker_id = v_worker_id
    AND s.shift_date >= (timezone('Asia/Seoul', now()))::date;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.respond_to_shift_invitation(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_shift_invitation(uuid,boolean) TO authenticated;

-- An invited shift targets exactly one worker: once that worker cancels
-- (before or after acceptance) or the facility rejects, nobody else can fill
-- it — close both 'open' and 'matched' shifts so no dead shift lingers.
CREATE OR REPLACE FUNCTION public.close_cancelled_invited_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('cancelled','rejected') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.shifts SET status='cancelled', cancelled_at=now(),
      cancellation_reason=CASE WHEN NEW.status='rejected'
        THEN '병원이 반복근무 요청을 종료함'
        ELSE '워커가 반복근무 요청을 거절 또는 취소함' END,
      updated_at=now()
    WHERE id=NEW.shift_id AND audience='invited' AND status IN ('open','matched');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_close_cancelled_invited_shift ON public.shift_applications;
CREATE TRIGGER trg_close_cancelled_invited_shift
  AFTER UPDATE OF status ON public.shift_applications
  FOR EACH ROW EXECUTE FUNCTION public.close_cancelled_invited_shift();

COMMENT ON TABLE public.facility_worker_pool IS '병원이 실제 수락·근무 이력으로 구축한 자체 인력풀';
COMMENT ON TABLE public.shift_templates IS '병원 반복 시프트 일괄 생성 템플릿';
