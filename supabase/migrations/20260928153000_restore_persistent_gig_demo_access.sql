-- 일일 데모 재시드가 시연 관리자 권한을 재구성하는 동안 빠진 긱 근무지 접근을 즉시 복구한다.
INSERT INTO public.facility_admin_access(user_id,facility_id,access_role,can_view_payroll)
SELECT u.id,f.id,'super',true
FROM auth.users u
CROSS JOIN public.facilities f
WHERE u.email='sales-demo-1@demo.atman.co.kr'
  AND f.business_registration_number='DEMO-GIGWORKER-2026'
  AND f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
ON CONFLICT(user_id,facility_id) DO UPDATE SET access_role='super',can_view_payroll=true;

SELECT count(*)=1 AS gig_demo_access_t
FROM public.facility_admin_access a
JOIN auth.users u ON u.id=a.user_id
JOIN public.facilities f ON f.id=a.facility_id
WHERE u.email='sales-demo-1@demo.atman.co.kr'
  AND f.business_registration_number='DEMO-GIGWORKER-2026'
  AND a.access_role='super' AND a.can_view_payroll=true;
