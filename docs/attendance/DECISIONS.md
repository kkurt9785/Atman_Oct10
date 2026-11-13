# 출퇴근 결정 기록

출퇴근 규칙을 바꿀 때 **무엇을 왜 그렇게 정했는지**를 번호로 남긴다. 코드·마이그레이션 주석에서 `D번호`로 가리킨다.
새 결정은 맨 아래에 이어서 번호를 붙이고, 뒤집을 때는 지우지 말고 "D번호를 대체" 로 새 항목을 쓴다.

| 번호 | 날짜 | 결정 | 이유 | 바뀐 곳 |
|---|---|---|---|---|
| D1 | 2026-11-13 | 퇴근 가능 시간(예정 종료 + `check_out_after_minutes`, 기본 120분)이 지나도록 퇴근이 없으면 **매시간** `missing_checkout_at` 을 찍는다. 상태(`status`)는 바꾸지 않는다 | 그 시간이 지나면 근무자는 `TIME_NOT_ALLOWED` 로 퇴근을 못 찍는데, 기록은 관리자가 손대기 전까지 '근무 중'으로 남았다. 새 상태값을 만들면 급여·화면·월 마감이 모두 status 를 읽어 영향이 크므로 표시 칸만 둔다. 매시간·'지금 기준' 조건이라 크론이 멈췄다가 돌아와도 밀린 것을 한 번에 따라잡는다 | `supabase/migrations/20261113100000_…`, `mark_missing_checkouts_at(timestamptz)`, 크론 `attendance-missing-checkout-hourly` |
| D1-1 | 2026-11-13 | 야간 근무는 예정 종료가 시작보다 이르거나 같으면 다음 날 종료로 본다(직원), 시프트는 `is_overnight`. 예정 시간이 없는 기록은 출근 후 18시간 | `record_unified_attendance` 의 근무일·종료 계산과 같은 규칙이어야 같은 시각에 '퇴근 가능'과 '미퇴근'이 겹치지 않는다 | 같은 함수 |
| D1-2 | 2026-11-13 | 조기 퇴근 승인 대기(`checkout_requested_at` 있음)는 미퇴근으로 찍지 않는다 | 이미 '조기 퇴근 승인'으로 따로 보이고, 퇴근 요청 시각이 있다 | 같은 함수 |
| D2 | 2026-11-13 | 관리자에게는 **날짜와 상관없이 오래된 순**으로 '퇴근 기록이 없는 근무'를 보여 준다. 화면에는 50건, 숫자는 전체. 정리는 그 달 근태 기록의 '퇴근시간 입력·확정'(사유 필수·이력 남음)에서 한다 | 오늘 근태 화면은 어제~오늘만 읽어서 지난 미퇴근이 사라졌고, 월 마감 때에야 "N건 먼저 정리" 로 드러났다. 관리자 간편 퇴근 버튼은 퇴근 시각을 **지금**으로 찍으므로 지난 기록 정리에 쓰면 안 된다 | `apps/admin-web/components/MissingCheckoutCard.tsx`, `lib/db/missing-checkouts.ts`, 홈·운영 '출퇴근 확인' 숫자, 긱 보드 '퇴근 누락' |
| D3 | 2026-11-13 | GPS 판정을 `거리 − min(정확도, 반경, 100m) ≤ 반경` 으로 바꾼다. 정확도 상한(`max_gps_accuracy_meters`) 검사는 그대로 | 실내에서 정확도가 40~80m 로 나오는 휴대폰이 건물 안인데도 '범위 밖'으로 떨어졌다. 정확도 값은 휴대폰이 보내는 값이라 빼는 양을 반경 이하로 묶는다 — 어떤 경우에도 통과 거리는 **반경의 2배**를 넘지 않는다(30m 사업장 60m, 병원 100m 200m). 처음 안은 `min(정확도, 100m)` 였으나 점검에서 '휴대폰이 오차를 크게 보내면 반경 30m 가 110m 가 된다'는 지적으로 바꿨다. 더 엄격해야 하는 사업장은 인증 방식을 '위치 + 동적 QR' 로 둔다 | `record_unified_attendance` 런타임 패치 |
| D4 | 2026-11-13 | 출퇴근 요청 제한은 **계정당 1분 10회**. 막힌 시도는 인증 기록에 남기지 않는다. IP 기준 제한은 두지 않는다 | 병원 Wi-Fi·통신사 NAT 로 여러 직원이 IP 하나를 쓴다. 근무자 앱은 기기당 계정 하나라 계정 = 기기다. 실패 기록마다 관리자 푸시가 가므로, 버튼을 연타하면 원장님 휴대폰이 울리던 것도 막힌다 | `record_unified_attendance` 런타임 패치, 인덱스 `idx_attendance_auth_logs_user_created` |
| D5 | 2026-11-13 | 근무자 앱은 미퇴근으로 표시된 기록을 '지금 근무 중'으로 잡지 않는다(`isOpenAttendance`) | 어제 퇴근을 안 찍으면 오늘 출근 버튼 대신 퇴근 버튼이 떠서 TIME_NOT_ALLOWED 만 나고 출근을 못 했다. 서버의 미퇴근 표시와 같은 기준이라 화면과 서버 판정이 어긋나지 않는다(표시는 매시간이라 최대 1시간 늦을 수 있음) | `apps/worker-web/lib/workplace-selection.ts`, `lib/attendance-feedback.ts`, `/workplace`·`/gig` 조회에 `missing_checkout_at` |

## 시험

- DB 규칙: `node scripts/qa-attendance-rules-pglite.mjs` — Docker 없이 메모리 Postgres(PGlite)에 최소 스키마를 만들고, 0916 본문 + 20261113 패치로 GPS·요청 제한·미퇴근 표시를 32가지 경우로 확인한다. 처음 한 번 `npm i --no-save @electric-sql/pglite@0.2.17` 이 필요하다.
- 화면 계산: `cd apps/worker-web && npx vitest run lib/__tests__/admin-missing-checkouts.test.ts`
- 정적 검사: `node scripts/qa-attendance-operational.mjs`

참고한 외부 설계: 건설 현장 QR 출퇴근 1단계 설계(사내 문서)의 '미퇴근 자동 마감·조치 필요 목록·GPS 오차 반영·기기 기준 요청 제한' 아이디어. 코드는 가져오지 않았다.
