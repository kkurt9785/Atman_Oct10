-- Let the guarded sales-demo admin accounts switch to the anchor demo pharmacy.
-- Scope is limited to three known demo auth emails and the is_demo facility.
INSERT INTO public.facility_admin_access (user_id, facility_id, access_role)
SELECT u.id, f.id, 'sales'
FROM auth.users u
CROSS JOIN public.facilities f
WHERE u.email IN (
  'sales-demo-1@demo.atman.co.kr',
  'sales-demo-2@demo.atman.co.kr',
  'sales-demo-3@demo.atman.co.kr'
)
  AND f.business_registration_number = 'DEMO-TARGET-PHARMACY'
  AND f.is_demo = true
  AND f.is_active = true
  AND f.deleted_at IS NULL
ON CONFLICT (user_id, facility_id) DO UPDATE SET
  access_role = 'sales';

DO $$
DECLARE
  access_count integer;
BEGIN
  SELECT count(*) INTO access_count
  FROM public.facility_admin_access a
  JOIN auth.users u ON u.id = a.user_id
  JOIN public.facilities f ON f.id = a.facility_id
  WHERE u.email IN (
    'sales-demo-1@demo.atman.co.kr',
    'sales-demo-2@demo.atman.co.kr',
    'sales-demo-3@demo.atman.co.kr'
  )
    AND f.business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND f.is_demo = true;

  IF access_count <> 3 THEN
    RAISE EXCEPTION 'expected pharmacy access for 3 sales demo admins, got %', access_count;
  END IF;
END $$;
