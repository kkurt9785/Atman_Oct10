-- Keep W여성병원 end-to-end demos payable without using real bank data.
-- These rows are visibly demo-only and cannot be used as actual transfer data.
WITH targets AS (
  SELECT w.id, w.name, row_number() OVER (ORDER BY w.kakao_id) AS seq
  FROM public.workers w
  WHERE w.is_demo = true
    AND w.kakao_id LIKE 'kakao_demo_gwangju_gwangsan_%'
    AND w.deleted_at IS NULL
)
INSERT INTO public.worker_bank_accounts (
  worker_id,bank_code,bank_name,account_number_encrypted,account_number_last4,
  account_holder_name,verification_status,verified_at,is_primary
)
SELECT
  t.id,'090','카카오뱅크',decode(md5('DEMO-ONLY-'||t.id::text),'hex'),
  lpad((6000+t.seq)::text,4,'0'),t.name,'verified',now(),true
FROM targets t
WHERE NOT EXISTS (
  SELECT 1 FROM public.worker_bank_accounts b
  WHERE b.worker_id=t.id AND b.is_primary=true AND b.deleted_at IS NULL
);

-- Existing converted demo workers inherit the shift wage and safe bank summary.
UPDATE public.facility_staff fs
SET pay_basis=COALESCE(fs.pay_basis,'hourly'),
    pay_rate=COALESCE(fs.pay_rate,matched.hourly_wage,18000),
    bank_name=COALESCE(fs.bank_name,bank.bank_name),
    account_last4=COALESCE(fs.account_last4,bank.account_number_last4),
    updated_at=now()
FROM public.workers w
LEFT JOIN LATERAL (
  SELECT s.hourly_wage
  FROM public.shift_applications a JOIN public.shifts s ON s.id=a.shift_id
  WHERE a.worker_id=w.id AND a.status IN ('accepted','completed')
  ORDER BY s.shift_date DESC,a.responded_at DESC NULLS LAST LIMIT 1
) matched ON true
LEFT JOIN LATERAL (
  SELECT b.bank_name,b.account_number_last4
  FROM public.worker_bank_accounts b
  WHERE b.worker_id=w.id AND b.is_primary=true AND b.deleted_at IS NULL
  ORDER BY b.created_at DESC LIMIT 1
) bank ON true
WHERE fs.worker_id=w.id AND w.is_demo=true
  AND (fs.pay_basis IS NULL OR fs.pay_rate IS NULL OR fs.bank_name IS NULL OR fs.account_last4 IS NULL);
