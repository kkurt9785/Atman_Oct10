# 잇닿 알림 QA 체크리스트

> 2026-08-12 작성. 매칭·근태·정산 전 구간의 알림 이벤트를 한 표로 관리한다.
> 아키텍처: 이벤트 발생 → `notification_outbox` 인큐(RPC/트리거/액션) → 디스패처(`/api/cron/dispatch-notifications`, 크론 00:10 KST + 각 액션의 nudge) → 웹푸시(VAPID) → 기기.

## 1. 이벤트 매트릭스

| # | 플로우 | 이벤트 | 인큐 위치 | 수신자 | 즉시성(nudge) | 자동검증 | 실기기 |
|---|---|---|---|---|---|---|---|
| 1 | 공고 등록 | `shift.created` | admin 액션 (lib/actions/shifts.ts) | 지역 매칭 워커 | ✅ 액션 후 | ✅ | 폰 수신 |
| 2 | 근무표 일괄 모집 | `shift.batch_created` | operations 액션 | 지역 매칭 워커 | ✅ | ✅ | 폰 수신 |
| 3 | **워커 지원** | `shift.applied` 🆕 | DB 트리거 (20260812100000) | 시설 관리자 (owner+operator·super) | ✅ 워커앱 apply 후 | ✅ | 폰 수신 |
| 4 | 관리자 수락(매칭) | `shift.accepted` | RPC `accept_shift_application` | 워커 | ✅ 수락 액션 후 | ✅ | 폰 수신 |
| 5 | 채팅 | `chat.message` | RPC (match_chat) | 상대방 | ✅ /api/chat/nudge | ✅ | 폰 수신 |
| 6 | 지각 | `attendance_late` | DB 트리거 (0809230000) | 시설 관리자 전원(팬아웃) | ✅ 워커앱 출근 후 | ✅ | 폰 수신 |
| 7 | 조기퇴근 확인 | `attendance_early_checkout` | DB 트리거 | 시설 관리자 | ✅ | ✅ | 폰 수신 |
| 8 | 인증 실패 | `attendance_auth_failed` | DB 트리거 | 시설 관리자 | ✅ | ✅ | 폰 수신 |
| 9 | 퇴근·정산 생성 | `shift.checkout` | RPC (settlement) | 워커 | ✅ | ✅ | 폰 수신 |
| 10 | 지급 대사(확인 필요 시) | `payment.reconciliation` | RPC record_payment_reconciliation (reconcile_required 시, 20260818130000) | 시설 관리자 팬아웃 | ✅ 크론 내 즉시 dispatch | ✅ | 폰 수신 |
| 11 | 워커→관리자 채팅 | `chat.message` | DB 트리거 (20260814103000, 시드 무음) | 시설 관리자 팬아웃 | ✅ 워커 채팅 후 | ✅ | 폰 수신 |
| 12 | 지정 초대 공고 | `shift.invited` | admin 액션 (lib/actions/shifts.ts) | 초대 워커 | ✅ | ✅ | 폰 수신 |
| 13 | 긴급 대체 모집 | `shift.urgent` | operations 액션 | 조건 매칭 워커 | ✅ | ✅ | 폰 수신 |
| 14 | 인력 공백 공고 생성 | `shift.staffing_recommendation` | operations 액션 | 조건 매칭 워커 | ✅ | ✅ | — |
| 15 | 휴가·결근 공백 감지 | `staffing.gap_review` | clinic-workforce 액션 | 시설 관리자 | ✅ | ✅ | — |
| 16 | 확정 근무 취소 | `shift.cancelled` | cancelShiftAction (20260818) | 매칭 워커 | ✅ | ✅ | 폰 수신 |
| 17 | 데모 리셋 완료 | `shift.demo_ready` | 데모 리셋 액션 (데모 전용) | 데모 관리자 | ✅ | — | — |

**규약**: dedupe_key는 반드시 `이벤트:엔티티id:수신자id` (전역 UNIQUE라 수신자 미포함 시 팬아웃 유실 — 20260811 사고). 예외: 단일 수신자 이벤트(accepted·checkout·병원→워커 chat)는 수신자 미포함이 현존 상태. 시스템 시드(auth.uid() 없음)는 워커→관리자 알림 발생 금지 — shift.applied·워커→관리자 chat 트리거 모두 가드 보유(후자는 20260818130000에서 추가).
**데모 격리**: 데모 시설 공고 알림은 데모 워커에게만 (get_shift_notification_recipients is_demo 필터, 20260818130000).
**구독 제약**: push_subscriptions PK=worker_id — 계정당 1기기, 마지막 로그인 기기가 이김. 실기기 QA 후 PC 로그인하면 폰 구독이 조용히 덮이므로 QA 마지막에 폰에서 재활성화. 구독 전 인큐분은 discard되어 재발송 없음(설계상 허용).

## 2. 배포 후 자동 점검 (Kurt 실행 가능)

```sql
-- (a) 적체 확인: pending이 10분 이상 쌓여 있으면 nudge/크론 이상
SELECT status, count(*), min(created_at) FROM notification_outbox
GROUP BY status ORDER BY status;

-- (b) 이벤트별 최근 흐름
SELECT event_type, status, count(*) FROM notification_outbox
WHERE created_at > now() - interval '1 day' GROUP BY 1,2 ORDER BY 1,2;

-- (c) 팬아웃 확인: 같은 엔티티가 관리자 수만큼 있어야
SELECT split_part(dedupe_key,':',2) AS entity, count(*) FROM notification_outbox
WHERE event_type LIKE 'attendance%' GROUP BY 1 HAVING count(*)>1 LIMIT 5;

-- (d) 구독 현황 (0이면 아무도 못 받음)
SELECT count(*) FROM push_subscriptions;
```

- 디스패처 헬스: `GET /api/cron/dispatch-notifications` (Bearer CRON_SECRET) → `{ok:true,...}`
- 워커 번들 VAPID 공개키: 87~88자·'B' 시작 (43자면 개인키 오등록 — 2026-08-12 사고 재발 방지)

## 3. 실기기 QA 절차 (파일럿 전 1회 + 주요 배포 후)

**준비**: 폰 2대(또는 폰+PC). 아이폰은 **홈 화면에 추가된 PWA에서만** 푸시 가능(iOS 16.4+).

1. **[워커 폰]** itdot.co.kr PWA 설치 → demo 로그인 → 설정 → 알림 켜기 → `push_subscriptions`에 행 생김 확인
2. **[관리자 폰/PC]** admin.itdot.co.kr → 근태 화면에서 알림 허용 → 구독 행 확인
3. **지원 흐름**: 워커가 공고 지원 → 관리자 기기에 "새 지원자 도착" 푸시 (≤10초)
4. **수락 흐름**: 관리자가 수락 → 워커 기기에 "매칭 확정" 푸시
5. **채팅**: 양방향 1건씩 → 상대 기기 푸시
6. **근태**: 워커 지각 출근(시간 조작 또는 데모) → 관리자 푸시 / 워커 퇴근 → 정산 푸시
7. **알림 탭** → 올바른 화면 딥링크(`data.url`) 이동 확인

## 4. 사고 이력 (재발 방지)

- **2026-08-11**: dedupe_key 수신자 미포함 → 관리자 2명 중 1명 유실 → 규약 명문화
- **2026-08-18**: ① nudge 게이트가 approved 전용이라 단계적 자격검증 직군(rn/na/pharmacist)의 실시간 알림이 전부 403 → 크론까지 최대 24h 지연 (완화 배포) ② 알림 수신자 RPC에 is_demo 필터 부재 → 데모 리셋마다 반경 내 실워커에게 데모 공고 푸시 ③ 워커→관리자 채팅 트리거 시드 무음 가드 누락. 교훈: **자격·격리 정책이 바뀌면 알림 경로(nudge 게이트·수신자 RPC·트리거)를 반드시 함께 패치**
- **2026-08-12**: ① `CRON_SECRET` 빈 값 → 크론 4종(알림·지급대사·체험만료·공고만료) 전멸, pending 47건 적체 ② worker `NEXT_PUBLIC_VAPID_PUBLIC_KEY`에 **개인키 오등록** → 전 기기 구독 불가 + 개인키 번들 노출 → 키 로테이션. 교훈: **시크릿 등록 후 반드시 런타임 검증**(엔드포인트 호출·번들 확인), env 이름·값 쌍 점검을 배포 체크리스트에 포함
