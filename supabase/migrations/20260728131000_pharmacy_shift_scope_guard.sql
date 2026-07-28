CREATE OR REPLACE FUNCTION public.enforce_pharmacy_shift_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $$
DECLARE
  v_type text;
  v_copy text := concat_ws(' ',NEW.description,NEW.department,NEW.notes);
BEGIN
  SELECT facility_type INTO v_type FROM public.facilities WHERE id=NEW.facility_id;

  IF NEW.required_role='pharmacy_staff' THEN
    IF v_type IS DISTINCT FROM 'pharmacy' THEN
      RAISE EXCEPTION '약국 전산·사무직 공고는 약국 사업장에서만 등록할 수 있어요.';
    END IF;
    IF v_copy ~ '(조제|복약[[:space:]]*지도|의약품[[:space:]]*(판매|조제)|처방[[:space:]]*(검토|감사)|최종[[:space:]]*(검수|확인))' THEN
      RAISE EXCEPTION '약국 전산·사무직 공고에는 약사 면허 업무를 포함할 수 없어요.';
    END IF;
  END IF;

  IF v_type='pharmacy' AND NEW.required_role='any' THEN
    RAISE EXCEPTION '약국 공고는 약사 또는 약국 전산·사무직을 선택해 주세요.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_pharmacy_shift_scope ON public.shifts;
CREATE TRIGGER trg_enforce_pharmacy_shift_scope
BEFORE INSERT OR UPDATE OF required_role,description,department,notes,facility_id
ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.enforce_pharmacy_shift_scope();
