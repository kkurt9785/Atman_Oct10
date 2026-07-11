# SaaS + 병원 직접 임금지급 전환 운영 가이드

## 목표

- 병원이 워커에게 임금을 직접 지급한다.
- Atman은 근태, 임금 계산 보조, 지급 승인·상태·감사로그만 관리한다.
- Atman 매출은 워커 임금과 독립된 SaaS 구독·사용량 청구서로만 발생한다.
- 기존 결제·크레딧·정산 이력은 삭제하지 않고 읽기 전용으로 보존한다.

## 환경변수

```text
BILLING_MODEL=saas_direct_wage
ENABLE_LEGACY_WAGE_CREDIT=false
```

Toss Payments 키는 기존과 같지만 신규 주문은 `service_invoices`의 `issued` 또는 `overdue` 청구서만 받을 수 있다. 클라이언트 금액은 사용하지 않고 서버 청구서 금액을 주문 원장에 복사한다.

## 배포 순서

1. 운영 DB 백업과 `payment_orders`, `credit_ledger`, `worker_credit_ledger`, `settlements` 건수를 기록한다.
2. `20260712010000_saas_direct_wage_billing.sql`을 staging에 적용한다.
3. QR 체크인/체크아웃, 지급 요청 단건 생성, 관리자 승인, 워커 입금 확인을 검증한다.
4. 동일 체크아웃 재시도 시 `attendance_id` 기준 지급 요청이 하나인지 확인한다.
5. `credit_ledger`와 `worker_credit_ledger`에 신규 임금 관련 행이 없는지 확인한다.
6. SaaS 청구서 결제 중복 웹훅이 한 번만 `paid` 처리되는지 확인한다.
7. 앱을 배포한 뒤 운영 DB에 마이그레이션을 적용한다.

## 검증 SQL

```sql
select attendance_id, count(*) from wage_payment_instructions group by attendance_id having count(*) > 1;
select * from credit_ledger where created_at >= now() - interval '1 day' and kind = 'spend';
select * from worker_credit_ledger where created_at >= now() - interval '1 day' and kind in ('earn','payout');
select order_id, order_type, service_invoice_id, status from payment_orders order by created_at desc limit 20;
```

## 롤백

데이터 테이블은 삭제하지 않는다. 앱 롤백이 필요하면 직전 앱 버전으로 되돌리되 신규 지급 요청을 먼저 중단하고 수동 검토한다. QR 함수까지 레거시로 되돌리면 임금 연동 크레딧 차감이 재개되므로 운영 책임자의 명시적 승인 없이 수행하지 않는다. `service_*` 및 `wage_payment_instructions` 데이터는 감사·복구를 위해 보존한다.

## 수동 출시 조건

- 직업정보제공사업 신고번호 표시 위치 확정
- 위치기반서비스 신고 필요성에 대한 서면 검토
- 병원 직접 지급 및 공제 책임을 반영한 이용약관 확정
- 계좌 이체자료 내보내기는 은행/급여 파트너 계약 및 보안 검토 후 활성화
- 사업자 업종에 응용 소프트웨어 개발 및 공급업 추가
- 워커 스토어의 기존 보상 크레딧은 현금 환급과 분리된 비현금성 마케팅 포인트 원장·약관으로 이전한 뒤 운영
