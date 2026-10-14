-- Match packages/gig-pay/minimum-wage.ts. No rewrite of existing wages/history.
-- One fixed rate over multiple years must meet each year's published minimum.
CREATE OR REPLACE FUNCTION public.minimum_hourly_wage_for_period(p_start date, p_end date)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE y integer; v_rate integer; v_min integer := 0;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION '근무 기간을 확인해 주세요';
  END IF;
  FOR y IN extract(year FROM p_start)::integer..extract(year FROM p_end)::integer LOOP
    v_rate := CASE y WHEN 2026 THEN 10320 WHEN 2027 THEN 10700 ELSE NULL END;
    IF v_rate IS NULL THEN RAISE EXCEPTION '%년 최저시급 기준이 등록되지 않아 저장할 수 없어요', y; END IF;
    v_min := greatest(v_min, v_rate);
  END LOOP;
  RETURN v_min;
END;
$$;
REVOKE ALL ON FUNCTION public.minimum_hourly_wage_for_period(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minimum_hourly_wage_for_period(date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_year_aware_minimum_wage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_start date; v_end date; v_rate numeric; v_min integer;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'shifts' THEN
      IF NEW.status IN ('cancelled','completed') THEN RETURN NEW; END IF;
      v_start := NEW.shift_date;
      v_end := NEW.shift_date + CASE WHEN NEW.end_time <= NEW.start_time THEN 1 ELSE 0 END;
      v_rate := NEW.hourly_wage;
    WHEN 'gig_projects' THEN
      IF NEW.status IN ('cancelled','completed') OR NEW.pay_basis <> 'hourly' OR NEW.pay_rate IS NULL THEN RETURN NEW; END IF;
      v_start := NEW.starts_on;
      v_end := NEW.ends_on + CASE WHEN NEW.end_time <= NEW.start_time THEN 1 ELSE 0 END;
      v_rate := NEW.pay_rate;
    WHEN 'facility_staff' THEN
      IF NEW.pay_basis IS DISTINCT FROM 'hourly' OR NEW.pay_rate IS NULL OR NEW.status = 'ended' THEN RETURN NEW; END IF;
      v_start := greatest(v_today, NEW.contract_start);
      v_end := greatest(v_start, NEW.contract_end);
      v_rate := NEW.pay_rate;
    WHEN 'shift_templates' THEN
      v_start := v_today; v_end := v_today; v_rate := NEW.hourly_wage;
    WHEN 'staffing_requirements' THEN
      v_start := v_today; v_end := v_today; v_rate := NEW.replacement_hourly_wage;
    ELSE RAISE EXCEPTION 'Unsupported minimum wage guard table';
  END CASE;
  v_min := public.minimum_hourly_wage_for_period(v_start, v_end);
  IF v_rate IS NULL OR v_rate < v_min OR v_rate <> trunc(v_rate) THEN
    RAISE EXCEPTION '선택한 근무 기간의 시급은 %원 이상이어야 해요', v_min;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_year_aware_minimum_wage() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_shift_minimum_wage
BEFORE INSERT OR UPDATE OF hourly_wage, shift_date, start_time, end_time, status ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.guard_year_aware_minimum_wage();
CREATE TRIGGER trg_gig_project_minimum_wage
BEFORE INSERT OR UPDATE OF pay_basis, pay_rate, starts_on, ends_on, start_time, end_time, status ON public.gig_projects
FOR EACH ROW EXECUTE FUNCTION public.guard_year_aware_minimum_wage();
CREATE TRIGGER trg_staff_minimum_wage
BEFORE INSERT OR UPDATE OF pay_basis, pay_rate, contract_start, contract_end, status ON public.facility_staff
FOR EACH ROW EXECUTE FUNCTION public.guard_year_aware_minimum_wage();
CREATE TRIGGER trg_template_minimum_wage
BEFORE INSERT OR UPDATE OF hourly_wage ON public.shift_templates
FOR EACH ROW EXECUTE FUNCTION public.guard_year_aware_minimum_wage();
CREATE TRIGGER trg_requirement_minimum_wage
BEFORE INSERT OR UPDATE OF replacement_hourly_wage ON public.staffing_requirements
FOR EACH ROW EXECUTE FUNCTION public.guard_year_aware_minimum_wage();
