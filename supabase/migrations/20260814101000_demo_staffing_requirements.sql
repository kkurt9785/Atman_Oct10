-- Representative minimum staffing rules for the three administrator demos.
-- They make the new flow visible without changing real facilities.

INSERT INTO public.staffing_requirements (
  facility_id,name,department,required_role,weekdays,start_time,end_time,
  required_headcount,replacement_hourly_wage,replacement_description
)
SELECT f.id,v.name,v.department,v.role,v.weekdays,v.start_time,v.end_time,
       v.headcount,v.wage,v.description
FROM public.facilities f
CROSS JOIN (VALUES
  ('병동 주간 간호 인력','병동','rn',ARRAY[1,2,3,4,5]::smallint[],'08:00'::time,'17:00'::time,2,18000,'병동 주간 간호 및 환자 상태 확인'),
  ('야간병동 필수 인력','야간병동','rn',ARRAY[1,2,3,4,5,6,7]::smallint[],'22:00'::time,'06:00'::time,1,22000,'야간병동 간호 및 인계 업무')
) AS v(name,department,role,weekdays,start_time,end_time,headcount,wage,description)
WHERE f.name='W여성병원' AND f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staffing_requirements r
    WHERE r.facility_id=f.id AND r.name=v.name AND r.is_active=true
  );

INSERT INTO public.staffing_requirements (
  facility_id,name,department,required_role,weekdays,start_time,end_time,
  required_headcount,replacement_hourly_wage,replacement_description
)
SELECT f.id,v.name,v.department,v.role,v.weekdays,v.start_time,v.end_time,
       v.headcount,v.wage,v.description
FROM public.facilities f
CROSS JOIN (VALUES
  ('평일 조제 인력','조제실','pharmacist',ARRAY[1,2,3,4,5]::smallint[],'09:00'::time,'18:00'::time,1,38000,'처방 조제 및 복약지도'),
  ('평일 전산·접수 인력','전산·접수','pharmacy_staff',ARRAY[1,2,3,4,5]::smallint[],'09:00'::time,'18:00'::time,1,15000,'처방전 전산 입력, 접수 및 재고 정리'),
  ('토요일 약사 인력',NULL::text,'pharmacist',ARRAY[6]::smallint[],'10:00'::time,'19:00'::time,2,40000,'토요일 처방 조제 및 복약지도')
) AS v(name,department,role,weekdays,start_time,end_time,headcount,wage,description)
WHERE f.business_registration_number='DEMO-TARGET-PHARMACY'
  AND f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staffing_requirements r
    WHERE r.facility_id=f.id AND r.name=v.name AND r.is_active=true
  );

INSERT INTO public.staffing_requirements (
  facility_id,name,department,required_role,weekdays,start_time,end_time,
  required_headcount,replacement_hourly_wage,replacement_description
)
SELECT f.id,'주간 간호 인력','병동','rn',ARRAY[1,2,3,4,5,6,7]::smallint[],
       '08:00'::time,'17:00'::time,3,19000,'요양병동 주간 간호 및 투약·환자 상태 확인'
FROM public.facilities f
WHERE f.business_registration_number='DEMO-TARGET-0026'
  AND f.facility_type='care_hospital' AND f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.staffing_requirements r
    WHERE r.facility_id=f.id AND r.name='주간 간호 인력' AND r.is_active=true
  );
