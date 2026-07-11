# P0 출시 게이트 체크리스트

## 코드/빌드

- [ ] Admin `npm ci && npm audit && npm run typecheck && npm run build`
- [ ] Worker `npm ci && npm audit && npm run typecheck && npm run build`
- [ ] Wage engine `npm test` 19/19
- [ ] production bundle에 secret, `.env`, demo key, service-role key 없음

## Supabase

- [ ] 스테이징 `supabase db push --dry-run`
- [ ] 스테이징 migration 전체 적용
- [ ] `supabase/tests/p0_schema_assertions.sql` 통과
- [ ] critical table에 browser write grant/`FOR ALL` 없음
- [ ] SECURITY DEFINER 함수 search_path/EXECUTE privilege 검토
- [ ] `license-photos` private, 타인/익명 접근 차단
- [ ] bank encryption key 설정 및 fail-closed 확인

## 업무 흐름

- [ ] 지원 중복·시간 겹침·동시 수락 테스트
- [ ] QR 60초 만료·재사용·동시 소비·다른 시설 스캔 차단
- [ ] GPS 필수 시설에서 권한 거부/좌표 누락/반경 초과 차단
- [ ] 체크아웃 중간 실패 시 근태·임금·크레딧 전체 rollback
- [ ] 원장 합계와 화면 잔액 일치

## 결제/푸시

- [ ] Toss sandbox 성공/실패/timeout/중복 callback
- [ ] webhook 중복과 callback 유실 후 cron 복구
- [ ] 취소·부분취소 reconciliation 운영 절차
- [ ] push outbox 성공/일시 실패/404·410 subscription 제거

## 운영

- [ ] dev/staging/prod 프로젝트 분리
- [ ] `scripts/prepare-production.sql` 검토·실행
- [ ] production `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0`
- [ ] 백업·복구 리허설
- [ ] 로그 마스킹과 장애 알림
- [ ] 개인정보·위치·직업소개·결제/환불 약관 승인

모든 P0 항목이 체크되기 전에는 실결제·실계좌·실면허 운영을 활성화하지 않는다.
