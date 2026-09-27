-- 긱워커 지급에 원천징수(사업소득 3.3% = 소득세 3% + 지방소득세 0.3%) 기록을 더한다.
-- amount 는 세전 그대로 두고, 공제율·공제액·실지급액을 함께 저장해 근무자 앱과 관리자 앱이 같은 숫자를 본다.
ALTER TABLE public.gig_payouts
  ADD COLUMN IF NOT EXISTS withholding_rate numeric(6,4) NOT NULL DEFAULT 0 CHECK (withholding_rate >= 0 AND withholding_rate < 1),
  ADD COLUMN IF NOT EXISTS withholding_amount integer NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  ADD COLUMN IF NOT EXISTS net_amount integer;
UPDATE public.gig_payouts SET net_amount = amount - withholding_amount WHERE net_amount IS NULL;
ALTER TABLE public.gig_payouts ALTER COLUMN net_amount SET NOT NULL;
