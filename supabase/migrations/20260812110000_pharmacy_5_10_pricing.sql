-- Pharmacy pricing for the initial small-pharmacy target.
-- Starter: up to 5 staff / Plus: up to 10 staff. Existing staff rows are never removed;
-- capacity is enforced only when another staff member is added.
UPDATE public.service_plans
SET name='Pharmacy', monthly_fee=59000,
    included_admin_seats=1, included_active_workers=5,
    included_attendance_slots=5, included_job_posting_slots=3,
    sort_order=12,
    features=COALESCE(features,'{}'::jsonb) || jsonb_build_object(
      'popular',true,
      'tagline','5명 이하 약국의 근태·휴가·대체약사 운영',
      'staff_limit',5,
      'admin_seat_addon',jsonb_build_object('price',20000,'unit',1),
      'cycle_discounts',true
    ),
    is_active=true
WHERE code='pharmacy';

UPDATE public.service_plans
SET name='Pharmacy Plus', monthly_fee=99000,
    included_admin_seats=3, included_active_workers=10,
    included_attendance_slots=10, included_job_posting_slots=10,
    sort_order=16,
    features=COALESCE(features,'{}'::jsonb) || jsonb_build_object(
      'popular',false,
      'tagline','6~10명 약국의 모집·근태·반복 일정 자동화',
      'staff_limit',10,
      'attendance',true,'leave_lite',true,'payroll_review',true,
      'repeat_invite',true,'operations',true,'credential_status',true,
      'cycle_discounts',true
    ),
    is_active=true
WHERE code='pharmacy_plus';

SELECT code,monthly_fee,included_attendance_slots,included_active_workers,
       included_job_posting_slots,included_admin_seats
FROM public.service_plans
WHERE code IN ('pharmacy','pharmacy_plus')
ORDER BY sort_order;
