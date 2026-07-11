# P0 패치 검증 결과

> 검증일: 2026-07-11
> 기준 입력: `atman-review.zip`
> 검증 환경: Linux container, Node.js 22.16.0, npm 10.9.2

## 결과 요약

| 검증 | 결과 | 비고 |
|---|---:|---|
| Admin TypeScript | PASS | `npm run typecheck` |
| Worker TypeScript | PASS | `npm run typecheck` |
| Admin Next.js compile build | PASS | Next.js 15.5.20 `--experimental-build-mode compile` |
| Worker Next.js compile build | PASS | Next.js 15.5.20 `--experimental-build-mode compile` |
| Admin 일반 production build | PARTIAL | compile·typecheck·12개 static page 생성까지 성공, container에서 `Collecting build traces`가 종료되지 않아 180초 timeout |
| Wage engine | PASS | 14 + 5 = 19개 케이스, 실패 0 |
| Admin npm audit | PASS | moderate/high/critical 포함 총 0건 |
| Worker npm audit | PASS | moderate/high/critical 포함 총 0건 |
| SQL parser | PASS | migration 23개 + 운영 준비 script + schema assertion 구문 분석 |
| Git whitespace check | PASS | `git diff --cached --check` |
| secret 정적 검색 | PASS | 실제 `.env`, private key, JWT, live 결제키 미발견; example 파일만 포함 |
| 금지 패턴 검색 | PASS | 앱 코드에 `getPublicUrl`, 구형 shift discovery RPC, client 생성 orderId, zoom 제한 미발견 |
| Supabase 실제 적용 | 미실행 | Supabase CLI/PostgreSQL/Docker가 없는 환경이라 DB 실행·RLS 동작은 미검증 |
| Toss 통합 테스트 | 미실행 | 테스트 상점 키와 callback/webhook endpoint가 없어 provider E2E 미검증 |

## 실행 명령

```bash
cd apps/admin-web
npm run typecheck
npm audit --audit-level=moderate
npx next build --experimental-build-mode compile

cd ../worker-web
npm run typecheck
npm audit --audit-level=moderate
npx next build --experimental-build-mode compile

cd ../../packages/wage-engine
npm test
```

SQL은 Python `pglast` parser로 23개 migration과 운영 보조 SQL을 파싱했다. 이는 PostgreSQL 문법 구조를 확인한 것이며, 실제 Supabase extension, 기존 데이터, constraint, role privilege와의 통합 실행을 증명하지 않는다.

## 변경 규모

- 기준 ZIP의 생성물 제외 파일: 175개
- 전달 ZIP의 소스·문서 파일: 197개
- Git patch 대상: 85개 파일
- diff: 약 6,497 insertions / 1,965 deletions
- P0 migration: 4개

## 통과한 핵심 정적 조건

- 관리자 시설 context가 현재 Supabase 사용자 ID와 묶여 있음
- 일반 시설 관리자는 전체 면허 심사 목록을 읽을 수 없음
- 워커 지원·취소와 관리자 수락·거절이 RPC 경로를 사용함
- QR은 application ID가 아니라 256-bit 무작위 token만 표시하고 DB에는 SHA-256 hash 저장
- 체크아웃의 근태·임금·수수료·크레딧·원장·상태 전이가 한 DB 함수에 있음
- 결제 주문은 UI 호출 전에 서버에 생성됨
- 결제 승인에 provider amount/order/payment key 검증과 Idempotency-Key가 있음
- webhook과 cron reconciliation 경로가 있음
- 면허는 private bucket path와 단기 signed URL을 사용함
- 계좌 암호화 키가 없을 때 저장을 거부하는 후속 함수가 있음
- push는 durable outbox를 사용함
- demo cleanup은 자동 migration이 아니라 명시적 guard가 있는 수동 script임

## 잔여 출시 차단 항목

1. 스테이징 Supabase에 migration 전체 적용 및 `p0_schema_assertions.sql` 실행
2. 기존 운영 데이터와 constraint 충돌 여부 확인
3. 사용자·시설 역할별 RLS 공격 테스트
4. 지원 수락, QR 소비, 체크아웃, 결제 callback 동시성 테스트
5. Toss sandbox 성공·timeout·중복 callback·webhook·취소/부분취소 테스트
6. private Storage 익명·타인 접근 테스트
7. bank encryption key/Vault 설정과 키 교체 절차 검증
8. production demo 계정/cron 제거와 환경변수 확인
9. 실제 배포 환경에서 일반 `npm run build` 정상 종료 확인
10. 개인정보·위치·직업소개·결제·환불 정책의 최종 법률 검토

## 판정

- 폐쇄형 스테이징 QA: **조건부 진행 가능**
- 실사용자 공개 및 실결제: **아직 No-Go**

코드 수준의 P0 보강은 반영됐지만, 실제 DB migration과 외부 결제 통합을 실행하지 않은 상태이므로 이 보고서를 운영 출시 승인서로 사용하면 안 된다.
