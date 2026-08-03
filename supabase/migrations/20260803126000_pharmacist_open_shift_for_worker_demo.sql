-- Keep one un-applied pharmacist shift visible in the worker sales demo.
INSERT INTO public.shifts (
  facility_id, required_role, shift_date, start_time, end_time,
  hourly_wage, estimated_total_pay, description, department, notes, status
)
SELECT
  facility.id, 'pharmacist', current_date + 3, '13:00', '17:00',
  38000, 152000,
  '오후 대체약사 근무 · 처방 조제와 복약지도', '대체약사',
  'DEMO-WORKER-SALES-PHARMACY-OPEN', 'open'
FROM public.facilities facility
WHERE facility.business_registration_number = 'DEMO-TARGET-PHARMACY'
  AND facility.is_demo = true AND facility.is_active = true AND facility.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.shifts existing
    WHERE existing.notes = 'DEMO-WORKER-SALES-PHARMACY-OPEN'
      AND existing.status = 'open'
  )
LIMIT 1;
