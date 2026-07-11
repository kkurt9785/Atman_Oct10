# P0 Production Hardening 변경 내역

## 관리자 웹

- 관리자 access token을 HttpOnly cookie로 저장하고 Supabase `getUser()`로 요청마다 검증
- facility context를 user ID와 묶은 HMAC cookie로 변경, 4시간 TTL 적용
- 시설 소유자/위임 역할을 DB에서 재검증
- 면허 전체 심사를 `super` 역할 전용으로 제한
- 시설 프로필 수정 권한·입력 범위·감사 로그 추가
- Toss 결제 전에 서버 order ledger 생성
- 승인 Idempotency-Key, provider 재조회, webhook, reconciliation cron 추가
- private 면허 path를 단기 signed URL로 변환
- push 직접 호출 대신 durable outbox 처리
- Next.js 15.5.20, PostCSS 8.5.10으로 갱신

## 워커 웹

- 시프트 검색·지원·취소를 `auth.uid()` 기반 RPC로 변경
- QR을 60초 1회용 서버 토큰으로 변경
- 온보딩을 단일 RPC로 원자화하고 실패 시 업로드 object 정리
- 계좌 암호화 저장 RPC, private 면허 bucket, 버전 약관 동의 적용
- 활동지역·프로필 변경을 RPC-only로 전환
- 가짜 카카오 알림 토글·하드코딩 승인 카드 제거
- Next.js 15.5.20, PostCSS 8.5.10으로 갱신

## Supabase

- P0 migration 4개 추가
- RLS/GRANT 최소 권한화, critical table direct write 차단
- facility claim bcrypt hash·만료·잠금·1회 사용
- 지원·수락·거절·QR·출퇴근·임금·정산·크레딧을 transaction RPC로 구현
- payment order/credit idempotency/reconciliation 원장 추가
- worker payout reserve/release와 push outbox 추가
- legacy membership mutator의 browser EXECUTE 제거
- production demo cleanup 수동 스크립트와 schema assertion 추가

## 급여 엔진

- 기존 규칙 테스트와 payroll 테스트를 한 명령으로 실행
- 총 19개 테스트 케이스를 검증 대상으로 유지
