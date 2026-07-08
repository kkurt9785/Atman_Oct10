-- 온보딩 락인 크레딧용 kind 값 추가
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_kind_check;

ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check CHECK (kind IN (
  'signup_payback',       -- 기존: 멤버십 가입 즉시 페이백
  'cycle_payback',        -- 기존: 주기 활동 페이백
  'earn',                 -- 기존: 결제 적립
  'spend',                -- 기존: 수수료·구독 사용
  'expire',               -- 기존: 만료
  'adjust',               -- 기존: 수동 조정
  'onboard_signup',       -- 신규: 병원 가입 완료 (₩30,000)
  'onboard_profile',      -- 신규: 프로필 입력 완료 (₩20,000)
  'onboard_first_shift'   -- 신규: 첫 시프트 등록 (₩50,000)
));
