-- 관리자 시연 진입을 병원/약국/요양병원 세 계정으로 고정한다.
DELETE FROM public.facility_admin_access a
USING auth.users u
WHERE a.user_id=u.id AND u.email IN (
  'sales-demo-1@demo.atman.co.kr','sales-demo-2@demo.atman.co.kr','sales-demo-3@demo.atman.co.kr'
);

INSERT INTO public.facility_admin_access(user_id,facility_id,access_role)
SELECT u.id,f.id,'super'
FROM auth.users u
JOIN public.facilities f ON (
  (u.email='sales-demo-1@demo.atman.co.kr' AND f.name='W여성병원' AND f.is_demo=true)
  OR (u.email='sales-demo-2@demo.atman.co.kr' AND f.business_registration_number='DEMO-TARGET-PHARMACY' AND f.is_demo=true)
  OR (u.email='sales-demo-3@demo.atman.co.kr' AND f.name='수원요양병원' AND f.facility_type='care_hospital' AND f.is_demo=true)
)
WHERE u.email IN ('sales-demo-1@demo.atman.co.kr','sales-demo-2@demo.atman.co.kr','sales-demo-3@demo.atman.co.kr')
  AND f.is_active=true AND f.deleted_at IS NULL
ON CONFLICT(user_id,facility_id) DO UPDATE SET access_role='super';
