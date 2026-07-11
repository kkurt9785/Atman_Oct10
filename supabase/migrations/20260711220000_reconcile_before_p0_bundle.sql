-- ============================================================================
-- P0 번들(20260710230000~233000) 적용 전 정합 처리
--
-- 오늘 오전에 적용한 자체 보안 마이그레이션(20260711090000/150000)의 객체 중
-- P0 번들이 다른 형태로 다시 만드는 것들을 제거한다.
-- ⚠️ 반드시 P0 번들 4개 마이그레이션보다 먼저 실행할 것.
-- ============================================================================

-- 안전장치: 결제 데이터가 이미 있으면 중단 (실결제 전이므로 비어 있어야 정상)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_orders LIMIT 1) THEN
    RAISE EXCEPTION 'payment_orders에 데이터가 있습니다. 수동 확인 필요 — 마이그레이션 중단';
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL; -- 테이블 자체가 없으면 통과
END $$;

-- ① 우리 버전 payment_orders → 번들 버전(uuid PK·idempotency_key·provider 필드)으로 교체
DROP FUNCTION IF EXISTS apply_payment_credit(TEXT, TEXT, INTEGER);
DROP TABLE IF EXISTS payment_orders;

-- ② 우리 정산 RPC → 번들 consume_attendance_qr 트랜잭션으로 대체
DROP FUNCTION IF EXISTS checkout_and_settle(uuid, uuid, double precision, double precision);

-- ③ 우리 QR nonce 테이블 → 번들 attendance_qr_tokens(SHA-256 해시 저장)로 대체
DROP TABLE IF EXISTS qr_scan_nonces;

-- ④ credit_ledger 이중차감 방지 인덱스는 번들 uq_credit_ledger_idempotency와 공존 가능 — 유지
-- ⑤ RLS 정책·workers INSERT 정책·Storage 정책·Vault 키는 번들과 호환 — 유지
