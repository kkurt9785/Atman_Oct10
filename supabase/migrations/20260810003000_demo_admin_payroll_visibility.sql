-- Headline demo administrators must be able to show the complete
-- attendance-to-payroll flow. This is an admin visibility permission, not a
-- paid-plan entitlement gate.
UPDATE public.facility_admin_access a
SET can_view_payroll=true
FROM auth.users u, public.facilities f
WHERE a.user_id=u.id AND a.facility_id=f.id
  AND (
    (u.email='sales-demo-1@demo.atman.co.kr' AND f.business_registration_number='DEMO-TARGET-0001')
    OR (u.email='sales-demo-2@demo.atman.co.kr' AND f.business_registration_number='DEMO-TARGET-PHARMACY')
    OR (u.email='sales-demo-3@demo.atman.co.kr' AND f.business_registration_number='DEMO-TARGET-0026')
  );
