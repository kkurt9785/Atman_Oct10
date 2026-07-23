-- Give showcase employees realistic payroll profiles so the same rows flow
-- from staff management into monthly payroll without UI-only fixtures.
UPDATE public.facility_staff
SET pay_basis = CASE
      WHEN phone LIKE '%-1' OR phone LIKE '%-2' OR phone LIKE '%-5' THEN 'monthly'
      WHEN phone LIKE '%-3' THEN 'hourly'
      ELSE 'daily'
    END,
    pay_rate = CASE
      WHEN phone LIKE '%-1' THEN 3200000
      WHEN phone LIKE '%-2' THEN 2800000
      WHEN phone LIKE '%-3' THEN 18000
      WHEN phone LIKE '%-4' THEN 150000
      ELSE 3000000
    END,
    bank_name = CASE
      WHEN phone LIKE '%-1' OR phone LIKE '%-4' THEN '국민은행'
      WHEN phone LIKE '%-2' OR phone LIKE '%-5' THEN '신한은행'
      ELSE '우리은행'
    END,
    account_last4 = CASE
      WHEN phone LIKE '%-1' THEN '1024'
      WHEN phone LIKE '%-2' THEN '2048'
      WHEN phone LIKE '%-3' THEN '3072'
      WHEN phone LIKE '%-4' THEN '4096'
      ELSE '5120'
    END
WHERE phone LIKE 'DEMO-WF-%';

