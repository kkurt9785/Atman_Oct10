-- Keep the populated W women's hospital showcase and hide the obsolete duplicate.
-- Historical shifts/subscription rows remain intact for auditability.
UPDATE public.facilities obsolete
SET is_active = false,
    updated_at = now()
WHERE obsolete.id = 'e264a657-0535-448f-931f-6eb1137de56f'
  AND obsolete.name = 'W여성병원'
  AND obsolete.is_demo = false
  AND NOT EXISTS (
    SELECT 1 FROM public.facility_staff staff
    WHERE staff.facility_id = obsolete.id AND staff.status <> 'ended'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.shifts shift
    WHERE shift.facility_id = obsolete.id
      AND shift.shift_date >= (timezone('Asia/Seoul', now()))::date
  )
  AND EXISTS (
    SELECT 1 FROM public.facilities showcase
    WHERE showcase.id = '534e0316-cd5e-4d87-8df2-bb7053eab7a7'
      AND showcase.name = obsolete.name
      AND showcase.is_demo = true
      AND showcase.is_active = true
  );

SELECT id, name, is_demo, is_active
FROM public.facilities
WHERE name = 'W여성병원'
ORDER BY is_demo;
