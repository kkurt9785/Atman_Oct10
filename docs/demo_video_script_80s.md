# 잇닿 데모 영상 제작 가이드

> **정본은 `scripts/render_demo_videos.mjs`의 `stories` 배열이다.** 이 문서는 그 내용을 사람이 읽기 좋게 옮긴 것이며, 장면·나레이션을 바꿀 때는 mjs를 먼저 고치고 여기를 맞춘다.
> 최종 산출물은 `apps/worker-web/public/demo/itdot-{admin,worker}-demo.mp4` (intro·worker-intro 페이지가 참조).

## 파이프라인

```bash
# 0) 시연 데이터 보장 (QA가 demo-1을 리셋했을 수 있음)
#    SQL/REST: ensure_demo1_wf_application(), ensure_demo1_chat_showcase()
# 1) 프로덕션 화면 캡처 → /private/tmp/atman-video-{worker,admin}-live/*.png
node scripts/capture_demo_screens.mjs worker-live   # 워커 먼저 — 채팅을 보내 관리자 화면에 새 메시지가 잡히게
node scripts/capture_demo_screens.mjs admin-live
# 2) 나레이션(say Yuna) + ffmpeg 합성 → ~/Downloads/itdot_{admin,worker}_demo_<date>_latest.mp4
node scripts/render_demo_videos.mjs admin
node scripts/render_demo_videos.mjs worker
# 3) 배포 위치로 복사 + 포스터(첫 프레임) 갱신
cp ~/Downloads/itdot_admin_demo_<date>_latest.mp4  apps/worker-web/public/demo/itdot-admin-demo.mp4
cp ~/Downloads/itdot_worker_demo_<date>_latest.mp4 apps/worker-web/public/demo/itdot-worker-demo.mp4
ffmpeg -y -ss 0.5 -i apps/worker-web/public/demo/itdot-admin-demo.mp4  -frames:v 1 -q:v 3 apps/worker-web/public/demo/itdot-admin-demo-poster.jpg
ffmpeg -y -ss 0.5 -i apps/worker-web/public/demo/itdot-worker-demo.mp4 -frames:v 1 -q:v 3 apps/worker-web/public/demo/itdot-worker-demo-poster.jpg
```

- 캡처: 헤드리스 Chrome(CDP) 390×844 @2x. `*-live`는 실제 도메인, 인자 없으면 localhost:3002/3003.
- 렌더: 장면 길이 = 나레이션 길이(최소 4초). 장면 전환은 0.16초 slideleft 크로스페이드. 1080×1920 30fps h264 + aac.
- 계정: 관리자 `sales-demo-1`(W여성병원) / 워커 `worker-demo-1`. 캡처 전 `python3 scripts/server_qa_demo1.py`가 30/30인지 확인.
- **UI 문구·흐름을 바꾼 배포 뒤에는 반드시 재캡처** — 영상이 구화면을 보여주면 시연 신뢰가 깨진다. (2026-08-26 렌더본이 9/4·9/7 변경분을 못 담은 사례)

## 관리자 영상 (9장면 · 약 90초)

| # | 프레임 | 화면 | 나레이션 |
|---|---|---|---|
| 1 | `01-service-intro` | `/intro` 상단 | 잇닿은 병원, 약국, 요양병원이 빈 근무를 빠르게 채우는 인력 운영 서비스입니다. 공고를 올리고 지원한 워커를 수락한 뒤, 채팅과 출퇴근 기록, 지급 확인까지 한곳에서 이어집니다. |
| 2 | `00-facility-search` | `/setup/claim-facility` 검색 "수원 온누리약국" | 처음 한 번, 사업장 이름을 검색합니다. 이미 잇닿에 있는 사업장은 초대 코드로 연결하고, 없으면 지도 검색 결과에서 바로 등록할 수 있습니다. |
| 3 | `00-facility-register` | 결과 카드 탭 → 등록 시트(카카오맵 핀·30m 원) | 주소와 전화를 확인하고, 지도에서 출입구 위치에 핀을 맞춥니다. 등록하면 같은 자리의 심평원 요양기관 정보와 자동으로 대조하고, 이 위치가 직원 출퇴근 인증의 기준이 됩니다. |
| 4 | `02-shift-create` | `/shifts/new` | 먼저 빈 시간대의 시프트를 만듭니다. 최근 공고 조건을 불러온 뒤, 직무와 날짜, 시작·종료 시간, 시급만 정하면 됩니다. |
| 5 | `03-applications` | `/applications` | 워커가 지원하면 이 화면에서 경력과 자격 확인 상태를 보고 수락합니다. 수락과 동시에 워커에게 확정 알림이 갑니다. |
| 6 | `04-chats` | `/chats` | 수락 뒤에는 바로 채팅이 열립니다. 근무 전 필요한 안내만 빠르게 주고받으면 됩니다. |
| 7 | `06-attendance-methods` | `/attendance-qr` (스크롤) | 워커가 출근 버튼을 누르면, 먼저 확정된 시프트와 출근 가능한 시간인지 확인합니다. 그다음 기본 방식인 30미터 위치 원터치를 서버가 검증합니다. 실내처럼 위치가 불안정하면 60초마다 바뀌는 동적 큐알로 보완하고, 등록한 사업장 와이파이도 보완 수단으로 쓸 수 있습니다. |
| 8 | `05-timesheet` | `/timesheet` | 인증을 통과하면 출근 시각과 인증 방식이 관리자 근태에 바로 기록됩니다. 퇴근도 정해 둔 종료시간을 기준으로 처리하고, 조기 퇴근처럼 확인이 필요한 경우만 승인 대상으로 올립니다. |
| 9 | `02-home` | `/` (마무리) | 공고 하나로 필요한 워커를 구하고, 실제 출퇴근 기록과 입금 확인까지. 잇닿은 인력 운영의 빈틈을 하나의 흐름으로 줄입니다. |

## 워커 영상 (10장면 · 약 76초)

| # | 프레임 | 화면 | 나레이션 |
|---|---|---|---|
| 1 | `01-worker-intro` | `/worker-intro` | 잇닿은 기본 정보만 등록하면, 원하는 지역과 시간에 맞는 병원, 약국, 요양병원 일자리를 바로 찾아 지원할 수 있는 워커 앱입니다. |
| 2 | `02-worker-register` | `/onboarding?step=splash` | 처음에는 카카오로 가입한 뒤, 내가 가능한 직군과 기본 정보만 등록합니다. |
| 3 | `03-activity-area` | `/settings/location` | 활동 지역을 정하면 내 직군과 반경에 맞는 새 시프트 알림을 받을 수 있습니다. |
| 4 | `05-shifts` | `/shifts` | 시간과 거리, 업무, 시급과 예상 지급액을 확인한 뒤 원하는 공고에만 직접 지원합니다. |
| 5 | `06-applications` | `/applications` | 사업장이 수락하면 알림이 오고, 지원 현황에서는 채용 확정과 출근 예정 상태를 한 카드에서 확인합니다. |
| 6 | `07-chat` | `/chat/{id}` (빠른답장 전송) | 근무 전 안내나 준비물은 사업장 채팅에서 바로 확인합니다. 연락처를 따로 주고받을 필요가 없습니다. |
| 7 | `08-workplace` | `/workplace` | 근무 당일에는 출근하기를 누릅니다. 정해진 시프트 시간과 현장 위치를 확인하고, 실내에서는 동적 큐알로 보완합니다. 퇴근도 같은 방식으로 기록됩니다. |
| 8 | `09-payments` | `/store/credits` | 퇴근이 완료되면 근무시간을 바탕으로 지급 요청이 생성됩니다. 지급 상태와 입금 확인은 여기에서 확인하고, 지급 일정이나 금액 문의는 근무한 사업장에 직접 확인합니다. |
| 9 | `10-notifications` | `/notifications` | 새 시프트와 채용 확정, 사업장 메시지와 지급 상태는 알림으로 이어집니다. 다음 근무를 놓치지 않고 자연스럽게 다시 시작할 수 있습니다. |
| 10 | `11-next-shifts` | `/home` (마무리) | 잇닿에서는 등록 후 앱을 열면 내 지역과 가능한 시간에 맞는 일을 바로 확인할 수 있습니다. 원하는 근무를 고르고, 일한 시간과 지급 상태도 내가 직접 확인합니다. |

## 나레이션 원칙

- TTS(`say -v Yuna -r 205`) 발음을 위해 QR은 **"큐알"**, 단위는 **"30미터"·"60초"**로 표기한다.
- 한 장면 한 문장~세 문장. 화면에서 실제로 보이는 것만 말한다.
- 개인정보·정확한 좌표·실명은 노출하지 않는다 (데모 계정만 사용).

## 변경 이력

- 2026-09-07 (2차): 관리자 편 앞에 **0. 사업장 등록** 2장면 추가(검색 결과·등록 시트 핀 지도). 캡처는 `수원 온누리약국` 검색 → 첫 '바로 등록 가능' 카드 탭, 등록 버튼은 누르지 않음. 카카오맵 활성화·심평원 키 이후 가능해짐.
- 2026-08-20 v1 초안(7장면×80초)
- 2026-08-23 렌더 파이프라인 확정(admin 7·worker 10 장면, 나레이션 길이 기준)
- 2026-09-07 프로덕션 재캡처(9/4·9/7 UI 반영), 워커 1장면 나레이션 축약, 이 문서를 mjs 기준으로 동기화
