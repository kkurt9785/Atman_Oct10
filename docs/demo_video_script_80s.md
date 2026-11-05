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
cp ~/Downloads/itdot_gig_demo_<date>_latest.mp4    apps/worker-web/public/demo/itdot-gig-demo.mp4
ffmpeg -y -ss 0.5 -i apps/worker-web/public/demo/itdot-admin-demo.mp4  -frames:v 1 -q:v 3 apps/worker-web/public/demo/itdot-admin-demo-poster.jpg
ffmpeg -y -ss 0.5 -i apps/worker-web/public/demo/itdot-worker-demo.mp4 -frames:v 1 -q:v 3 apps/worker-web/public/demo/itdot-worker-demo-poster.jpg
```

- 캡처: 헤드리스 Chrome(CDP) 390×844 @2x. `*-live`는 실제 도메인, 인자 없으면 localhost:3002/3003.
- 렌더: 장면 길이 = 나레이션 길이(최소 4초). 장면 전환은 0.16초 slideleft 크로스페이드. 1080×1920 30fps h264 + aac.
- 계정: 관리자 `sales-demo-1`(W여성병원) / 워커 `worker-demo-1`. 캡처 전 `python3 scripts/server_qa_demo1.py`가 30/30인지 확인.
- **UI 문구·흐름을 바꾼 배포 뒤에는 반드시 재캡처** — 영상이 구화면을 보여주면 시연 신뢰가 깨진다. (2026-08-26 렌더본이 9/4·9/7 변경분을 못 담은 사례)

## 관리자 영상 (8장면 · 약 90초)

| # | 프레임 | 화면 | 나레이션 |
|---|---|---|---|
| 1 | `01-service-intro` | `/intro` 상단 | 잇닿은 병원, 약국, 요양병원이 빈 근무를 빠르게 채우는 인력 운영 서비스입니다. 공고를 올리고 지원한 워커를 수락한 뒤, 채팅과 출퇴근 기록, 지급 확인까지 한곳에서 이어집니다. |
| 2 | `01-login` | `/login` | 시작은 카카오 로그인 한 번이면 됩니다. 처음 한 번 사업장 이름을 검색해 등록하면, 그 위치가 직원 출퇴근 인증의 기준이 됩니다. 로그인 없이 시연 계정으로 먼저 둘러볼 수도 있습니다. |
| 3 | `02-shift-create` | `/shifts/new` | 먼저 빈 시간대의 시프트를 만듭니다. 최근 공고 조건을 불러온 뒤, 직무와 날짜, 시작·종료 시간, 시급만 정하면 됩니다. |
| 4 | `03-applications` | `/applications` | 워커가 지원하면 이 화면에서 경력과 자격 확인 상태를 보고 수락합니다. 수락과 동시에 워커에게 확정 알림이 갑니다. |
| 5 | `04-chats` | `/chats` | 수락 뒤에는 바로 채팅이 열립니다. 근무 전 필요한 안내만 빠르게 주고받으면 됩니다. |
| 6 | `06-attendance-methods` | `/attendance-qr` (스크롤) | 워커가 출근 버튼을 누르면, 먼저 확정된 시프트와 출근 가능한 시간인지 확인합니다. 그다음 기본 방식인 30미터 위치 원터치를 서버가 검증합니다. 실내처럼 위치가 불안정하면 60초마다 바뀌는 동적 큐알로 보완하고, 등록한 사업장 와이파이도 보완 수단으로 쓸 수 있습니다. |
| 7 | `05-timesheet` | `/timesheet` | 인증을 통과하면 출근 시각과 인증 방식이 관리자 근태에 바로 기록됩니다. 퇴근도 정해 둔 종료시간을 기준으로 처리하고, 조기 퇴근처럼 확인이 필요한 경우만 승인 대상으로 올립니다. |
| 8 | `02-home` | `/` (마무리) | 홈에서는 인력 운영 기준과 오늘 근무 인원, 확인이 필요한 업무를 한눈에 봅니다. 공고 하나로 필요한 워커를 구하고, 실제 출퇴근 기록과 지급 확인까지. 잇닿은 인력 운영의 빈틈을 하나의 흐름으로 줄입니다. |

## 워커 영상 (10장면 · 약 76초)

| # | 프레임 | 화면 | 나레이션 |
|---|---|---|---|
| 1 | `01-worker-intro` | `/worker-intro` | 잇닿은 기본 정보만 등록하면, 원하는 지역과 시간에 맞는 병원, 약국, 요양병원 일자리를 바로 찾아 지원할 수 있는 워커 앱입니다. |
| 2 | `02-worker-register` | `/onboarding?step=splash` | 처음에는 카카오로 가입한 뒤, 내가 가능한 직군과 기본 정보만 등록합니다. |
| 3 | `03-activity-area` | `/settings/location` | 활동 지역을 정하면 내 직군과 반경에 맞는 새 시프트 알림을 받을 수 있습니다. |
| 4 | `05-shifts` | `/shifts` | 시간과 거리, 업무, 시급과 예상 지급액을 확인한 뒤 원하는 공고에만 직접 지원합니다. |
| 5 | `06-applications` | `/applications` (내 근무) | 사업장이 수락하면 알림이 오고, 내 근무에서는 지원함, 채용 확정, 출근 예정 상태를 한 카드에서 확인합니다. |
| 6 | `07-chat` | `/chat/{id}` (말풍선이 가장 많은 방 자동 선택, 전송 없음) | 근무 전 안내나 준비물은 사업장 채팅에서 바로 확인합니다. 연락처를 따로 주고받을 필요가 없습니다. |
| 7 | `08-workplace` | `/workplace` (닿기 버튼) | 근무 당일에는 닿기 버튼을 길게 눌러 출근합니다. 정해진 시프트 시간과 현장 위치를 자동으로 확인하고, 실내에서는 동적 큐알로 보완합니다. 퇴근도 같은 방식으로 기록됩니다. |
| 8 | `09-payments` | `/store/credits` (= `/earnings`) | 퇴근이 완료되면 근무시간을 바탕으로 지급 요청이 생성됩니다. 지급 상태와 입금 확인은 여기에서 확인하고, 지급 일정이나 금액 문의는 근무한 사업장에 직접 확인합니다. |
| 9 | `10-notifications` | `/notifications` | 새 시프트와 채용 확정, 사업장 메시지와 지급 상태는 알림으로 이어집니다. 다음 근무를 놓치지 않고 자연스럽게 다시 시작할 수 있습니다. |
| 10 | `11-next-shifts` | `/home` (마무리, 주간 근무표) | 잇닿에서는 앱을 열면 이번 주 근무표와 내 지역에서 갈 수 있는 근무가 바로 보입니다. 원하는 근무를 고르고, 일한 시간과 지급 상태도 내가 직접 확인합니다. |

## 단기·행사(초대 근무) 영상 (6장면 · 약 65초) — 2026-10-01 신설, `/gig/demo`·`/intro?kind=gigworker`에 임베드

> **2026-11-05 나레이션 개정안 — 아직 렌더 안 함.** 지금 배포된 `itdot-gig-demo.mp4`는 10/01 렌더본이라 '간편모드'·'잇기·닿기 버튼'·'관리자'를 말하고 포스터에도 '긱워커 간편모드 시연'이 찍혀 있다. 아래 표가 새 문안이며, **`scripts/render_demo_videos.mjs`의 `stories.gig`는 아직 옛 문안**이다(의료 영상 재녹화 작업과 같은 파일이라 손대지 않음). 재제작 때 아래 문안을 `stories.gig` 4번째 칸에 옮긴 뒤 렌더한다. 화면 위 제목·부제(2·3번째 칸)는 렌더에 쓰이지 않는다.

캡처: `node scripts/capture_demo_screens.mjs worker-gig-live` (GIG2026 시연 계정 → 초대 수락까지 자동) + 인트로는 `public-live`의 `03-gig-demo.png`를 `00-gig-intro.png`로 복사. 렌더: `node scripts/render_demo_videos.mjs gig`.

> ⚠️ `worker-gig`·`worker-gig-live` 캡처는 **운영 DB에 쓴다**(타깃 이름과 상관없이 `https://itdot.co.kr/api/demo-login`을 부른다). `reset_gigworker_invite_demo` → 긱 시연 사업장의 지급·계좌 전달·근태·인증 로그·알림, 워크룸 공지·대화·출석 확인 전부, 방문자가 만든 초대·근무자·빈 근무 건을 지우고 고정 초대를 새로 만든다. 이어서 `prepare_my_demo_worker`(시연 근무 시간 갱신)와 브라우저의 '초대 수락' 클릭(`claim_facility_staff_invite`·계좌 전달·조건 스냅샷)까지 쓴다. 출근은 누르지 않는다. 시연 계정·시연 사업장(`DEMO-GIGWORKER-2026`) 데이터만 건드리지만, 그 시각 다른 사람의 단기 시연(사장님 `login?demo=gigworker` 포함)은 지워진다. 최근 1시간 안에 시연이 진행됐으면 초기화를 건너뛰고 고정 토큰을 돌려줘 `00-gig-invite`가 '이미 수락' 화면으로 찍히니, 그때는 1시간 뒤 다시 한다. `public-live`는 공개 페이지만 열어 쓰기 없음.

| # | 프레임 | 화면 | 나레이션 (11/05 개정안) |
|---|---|---|---|
| 1 | `00-gig-intro` | `/gig/demo` | 잇닿 근무자 앱의 초대 근무 화면이에요. 팝업스토어나 행사처럼 사장님이 초대한 근무의 출퇴근 기록과 지급 확인을 한곳에서 해요. 따로 앱을 설치하지 않아도 써 볼 수 있어요. |
| 2 | `00-gig-invite` | `/gig/join?token=` (수락 전) | 사장님이 보낸 초대 링크를 열면 근무 기간과 일정, 업무, 급여 조건이 먼저 보여요. 전화번호나 카카오톡 친구 추가 없이, 초대 수락을 누르면 이 근무와 바로 연결돼요. |
| 3 | `01-gig-home` | `/gig` (오늘 근무 · 출근하기) | 근무 당일에는 오늘 근무 화면에서 출근하기를 1초간 길게 누르면 출근이 기록돼요. 위치는 누른 순간에만 확인하고, 실내처럼 위치가 불안정하면 사장님 화면의 동적 큐알로 인증해요. 퇴근도 같은 방식이에요. |
| 4 | `02-gig-workroom` | `/gig/workroom` (사장님과 근무 대화) | 사장님과 근무 대화에서는 공지와 출석 확인, 근무 메시지를 한곳에서 주고받아요. 개인 전화번호는 보이지 않고, 내 대화는 다른 근무자에게 보이지 않아요. |
| 5 | `03-gig-settlement` | `/gig/settlement` (근태·지급) | 근태·지급 화면에서는 지급 계좌를 사장님께 전달하고, 내 근태와 지급 현황을 직접 확인해요. 계좌는 이 근무지에서 지급 권한이 있는 사람만 볼 수 있고, 임금은 사장님이 직접 지급해요. |
| 6 | `05-gig-settings` | `/gig/settings` (마무리) | 앱 설정에서 이 기기의 출근 알림을 켜 두면 근무 30분 전에 안내를 받아요. 초대 링크 하나로 시작하는 단기 근무, 잇닿 근무자 앱 하나면 충분해요. |

### 단기 영상 재제작 순서 (대표 승인 후, 기계 시간 약 3분 + 확인 10분)

```bash
# 전제: 오늘 단기 문구 수정(worker-web)이 itdot.co.kr 에 배포돼 있을 것 — -live 캡처는 운영 화면을 찍는다.
#       최근 1시간 안에 단기 시연이 없었고, 지금 시연 중인 사람이 없을 것. 9333 포트를 다른 Chrome 이 쓰지 않을 것.
cd ~/atman
# 0) scripts/render_demo_videos.mjs 의 stories.gig 나레이션(4번째 칸)을 위 표로 바꾸고, date 를 '20261105' 로
# 1) 공개 페이지 캡처 — 읽기만 (약 30초)
node scripts/capture_demo_screens.mjs public-live
# 2) 단기 근무자 화면 캡처 — ⚠️ 운영 DB 쓰기(시연 초기화 + 초대 수락) (약 40초)
node scripts/capture_demo_screens.mjs worker-gig-live
# 3) 인트로 프레임: /gig/demo 아래쪽에 옛 영상 포스터('긱워커 간편모드 시연')가 찍히므로 '영상으로 보기' 위에서 자른다 (2x 기준 780×1090)
ffmpeg -y -i /private/tmp/atman-video-public-live/03-gig-demo.png -vf crop=780:1090:0:0 /private/tmp/atman-video-worker-gig-live/00-gig-intro.png
# 4) 프레임 6장 눈으로 확인: 00-gig-invite 가 '수락 전' 화면인지, 01-gig-home 에 '출근하기'가 보이는지
open /private/tmp/atman-video-worker-gig-live
# 5) 렌더 — say -v Yuna + ffmpeg (약 1~2분) → ~/Downloads/itdot_gig_demo_<date>_latest.mp4
node scripts/render_demo_videos.mjs gig
# 6) 배포 위치로 복사 + 포스터 갱신
cp ~/Downloads/itdot_gig_demo_20261105_latest.mp4 apps/worker-web/public/demo/itdot-gig-demo.mp4
ffmpeg -y -ss 0.5 -i apps/worker-web/public/demo/itdot-gig-demo.mp4 -frames:v 1 -q:v 3 apps/worker-web/public/demo/itdot-gig-demo-poster.jpg
# 7) 캡처용 Chrome 프로필에 시연 근무자 세션이 남으니 지운다
rm -rf /private/tmp/atman-video-worker-gig-live/profile /private/tmp/atman-video-public-live/profile
# 8) 커밋 → worker-web vercel --prod (대표)
```

`04-gig-notifications`는 시연 계정에 알림이 없어(빈 화면) 쓰지 않는다. 옛 6번 문안의 "병원이나 약국 근무도 같은 계정에서"는 뺐다 — 근무 찾기는 의료 직군 전용이라 단기 근무자에게는 맞지 않는다.

<details><summary>10/01 렌더본 문안 (지금 배포된 영상)</summary>

1 잇닿 워커 안의 긱워커 간편모드입니다… / 2 관리자가 보낸 초대 링크를 열면… 잇기 버튼으로 수락하면… / 3 닿기 버튼을 1초간 길게… 관리자의 동적 큐알로… / 4 출퇴근 기록은 관리자 대화에… / 5 지급 계좌는 근무 시작 전에… 관리자만 볼 수 있고… / 6 출근 알림을 켜 두면… 병원이나 약국 근무도 같은 계정에서… 긱워커도 잇닿 하나로 충분합니다.
</details>

## 나레이션 원칙

- TTS(`say -v Yuna -r 205`) 발음을 위해 QR은 **"큐알"**, 단위는 **"30미터"·"60초"**로 표기한다.
- 한 장면 한 문장~세 문장. 화면에서 실제로 보이는 것만 말한다.
- 개인정보·정확한 좌표·실명은 노출하지 않는다 (데모 계정만 사용).

## 변경 이력

- 2026-09-07 (2차): 관리자 편 앞에 **0. 사업장 등록** 2장면 추가(검색 결과·등록 시트 핀 지도). 캡처는 `수원 온누리약국` 검색 → 첫 '바로 등록 가능' 카드 탭, 등록 버튼은 누르지 않음. 카카오맵 활성화·심평원 키 이후 가능해짐.
- 2026-08-20 v1 초안(7장면×80초)
- 2026-08-23 렌더 파이프라인 확정(admin 7·worker 10 장면, 나레이션 길이 기준)
- 2026-09-07 프로덕션 재캡처(9/4·9/7 UI 반영), 워커 1장면 나레이션 축약, 이 문서를 mjs 기준으로 동기화
- 2026-10-01 (3차): 9/7 이후 UI 변경(닿기 버튼·내 근무 탭·주간 근무표·홈 운영 카드·로그인 화면) 반영해 양쪽 재제작. **관리자 편 '0. 사업장 등록' 2장면 제거** — `app/setup/layout.tsx`가 사업장을 소유한 관리자를 홈으로 돌려보내는데 시연 관리자 3계정 모두 사업장을 가져 `/setup/claim-facility`를 찍을 수 없음. 대신 `/login` 1장면으로 "카카오 로그인 한 번 + 처음 한 번 사업장 등록"을 말로 전달. 워커 채팅 장면은 확정 근무가 여러 건이라 빈 방이 먼저 잡히던 문제를 '말풍선 가장 많은 방 선택'으로 해결.
- 2026-10-01 (3차 추가): **긱워커 편 신설**(6장면) → `/gig/demo`에 임베드. 캡처 타깃 `worker-gig-live` 추가(초대 확인·근무 알림 프레임 포함).
- 2026-11-05: 단기 편 나레이션 개정안(초대 수락·출근하기·사장님, '간편모드'·'잇기·닿기'·'관리자' 삭제, 해요체)과 재제작 순서·운영 DB 쓰기 범위 기록. **렌더·mjs 반영은 안 함**(대표 승인 대기). `/intro?kind=gigworker`도 이 영상을 쓰기 시작.
