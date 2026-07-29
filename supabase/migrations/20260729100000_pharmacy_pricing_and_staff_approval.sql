-- Pharmacy-specific starter price without changing the hospital Clinic plan.
INSERT INTO public.service_plans (
  code,name,monthly_fee,included_facilities,included_admin_seats,
  included_active_workers,included_attendance_slots,included_job_posting_slots,
  features,is_active,sort_order
)
SELECT
  'pharmacy','Pharmacy',69000,included_facilities,included_admin_seats,
  10,included_attendance_slots,included_job_posting_slots,
  COALESCE(features,'{}'::jsonb) || jsonb_build_object(
    'attendance',true,'leave_lite',true,'payroll_review',true,
    'pharmacy_workforce',true,'repeat_invite',true,
    'tagline','약사·전산직 채용과 근태, 반복근무 요청을 한 곳에서'
  ),
  true,15
FROM public.service_plans
WHERE code='clinic'
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,monthly_fee=69000,
  included_facilities=EXCLUDED.included_facilities,
  included_admin_seats=EXCLUDED.included_admin_seats,
  included_active_workers=EXCLUDED.included_active_workers,
  included_attendance_slots=EXCLUDED.included_attendance_slots,
  included_job_posting_slots=EXCLUDED.included_job_posting_slots,
  features=EXCLUDED.features,is_active=true,sort_order=15;

-- Convert only paid/non-trial pharmacy Clinic subscriptions. Pro trials remain
-- untouched until they expire or the owner chooses a paid plan.
UPDATE public.facility_subscriptions fs
SET plan_code='pharmacy',updated_at=now()
FROM public.facilities f
WHERE f.id=fs.facility_id
  AND f.facility_type='pharmacy'
  AND fs.plan_code='clinic'
  AND fs.trial_started_at IS NULL;

CREATE OR REPLACE FUNCTION public.auto_approve_pharmacy_staff_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
BEGIN
  IF NEW.role='pharmacy_staff'
    AND regexp_replace(COALESCE(NEW.phone,''),'[^0-9]','','g') ~ '^010[0-9]{8}$'
    AND NEW.birth_date IS NOT NULL
    AND length(trim(COALESCE(NEW.experience_years,''))) > 0
    AND length(trim(COALESCE(NEW.last_workplace,''))) >= 2
    AND COALESCE(array_length(NEW.department_tags,1),0) > 0
  THEN
    NEW.verification_status:='approved';
    NEW.verified_at:=COALESCE(NEW.verified_at,now());
    NEW.rejection_reason:=NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_approve_pharmacy_staff_profile ON public.workers;
CREATE TRIGGER trg_auto_approve_pharmacy_staff_profile
BEFORE INSERT OR UPDATE OF phone,birth_date,role,experience_years,last_workplace,department_tags
ON public.workers
FOR EACH ROW EXECUTE FUNCTION public.auto_approve_pharmacy_staff_profile();

-- Bring already-complete pharmacy office profiles into the same policy.
UPDATE public.workers
SET updated_at=now()
WHERE role='pharmacy_staff'
  AND verification_status IN ('pending','reviewing')
  AND deleted_at IS NULL
  AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') ~ '^010[0-9]{8}$'
  AND birth_date IS NOT NULL
  AND length(trim(COALESCE(experience_years,''))) > 0
  AND length(trim(COALESCE(last_workplace,''))) >= 2
  AND COALESCE(array_length(department_tags,1),0) > 0;
