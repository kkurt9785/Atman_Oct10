-- 동명 수원요양병원 중 대표 데모 시설(DEMO-TARGET-0026) 하나만 유지한다.
DELETE FROM public.facility_admin_access a
USING auth.users u
WHERE a.user_id=u.id AND u.email='sales-demo-3@demo.atman.co.kr';

INSERT INTO public.facility_admin_access(user_id,facility_id,access_role)
SELECT u.id,f.id,'super'
FROM auth.users u
JOIN public.facilities f ON f.business_registration_number='DEMO-TARGET-0026'
WHERE u.email='sales-demo-3@demo.atman.co.kr'
  AND f.facility_type='care_hospital' AND f.is_demo=true
  AND f.is_active=true AND f.deleted_at IS NULL
ON CONFLICT(user_id,facility_id) DO UPDATE SET access_role='super';
