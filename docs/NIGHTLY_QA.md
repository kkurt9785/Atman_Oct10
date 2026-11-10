# 밤 점검 (nightly-qa)

매일 새벽 4시(한국 시간)에 깃허브가 잇닿을 점검하고, 실패한 날만 AI 가 원인을 찾아 수정안을 올려요.
머지와 배포는 사람이 해요. AI 는 운영에 손대지 않아요.

## 무엇을 하나

| 단계 | 작업 이름 | 하는 일 | 운영에 쓰기 | 비용 |
|---|---|---|---|---|
| 1 | `checks` | 두 앱 타입 검사·단위 테스트·빌드, 순수 점검 3개, 운영 읽기 전용 점검 1개 | 없음 | 무료(깃허브 액션 분) |
| 2 | `server-qa` | 서버 QA 31개를 운영 시연 병원(demo1)으로 실행 | 시연 병원에만 썼다가 되돌림 | 무료 |
| 3 | `ai-fix` | 1·2 중 하나라도 실패하면 Claude Code 가 로그를 읽고 진단, 코드 문제면 수정 PR | 없음 | Claude 구독 사용량 |

- 전부 통과한 날은 3단계가 돌지 않아요. 알림도 없어요.
- 실패한 날: 코드를 고쳤으면 `ai-fix/날짜-번호` 브랜치와 PR, 안 고쳤으면(데이터·환경 문제) `밤 점검 실패` 이슈가 생겨요. 이슈가 이미 열려 있으면 댓글로 이어져요.
- 수동 실행: 깃허브 Actions → nightly-qa → Run workflow. `ai_fix` 를 끄면 점검만 해요.

## 처음 한 번 설정 (깃허브 저장소 Settings)

1. **Secrets and variables → Actions → New repository secret** 4개

   | 이름 | 값이 있는 곳 | 없으면 |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `apps/worker-web/.env.local` | 빌드·읽기 점검 실패 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/worker-web/.env.local` | 빌드·읽기 점검 실패 |
   | `SUPABASE_SERVICE_ROLE_KEY` | `apps/worker-web/.env.local` | 2단계를 건너뜀 |
   | `CLAUDE_CODE_OAUTH_TOKEN` | 터미널에서 `claude setup-token` 실행 후 나오는 값 | 3단계가 진단 없이 이슈만 만듦 |

2. **Actions → General → Workflow permissions** 에서 `Allow GitHub Actions to create and approve pull requests` 켜기. 안 켜면 PR 대신 브랜치 링크가 담긴 이슈가 생겨요.
3. Actions 탭에서 nightly-qa 를 한 번 수동 실행해 초록인지 확인.

## 지켜야 할 것 (보안)

- 운영 서비스 키는 `server-qa` 작업의 한 단계에만 들어가요. AI 가 도는 `ai-fix` 작업에는 공개 값(URL·anon 키)만 줘요. 이 구분을 바꾸지 마세요.
- AI 단계에는 깃허브 토큰도 주지 않아요. 브랜치·PR 은 `scripts/ci/report-result.sh` 가 만들어요.
- AI 가 바꿔도 올라가지 않는 곳: `supabase/`(마이그레이션), `.github/`, `scripts/ci/`.
- 깃허브 시크릿은 저장소에 쓰기 권한이 있는 사람이면 워크플로를 고쳐 꺼낼 수 있어요. 협업자를 추가하기 전에 서비스 키를 여기 두는 게 맞는지 다시 보세요.
- 예약 실행은 기본 브랜치(main)의 워크플로 파일만 써요. 60일 동안 저장소 활동이 없으면 깃허브가 예약을 꺼요(다시 켜기는 Actions 탭).

## 서버 QA 가 시연 데이터에 하는 일

`scripts/server_qa_demo1.py` 는 demo1 병원에 QA 용 공고·지원·출근 기록을 만들고, 끝나면 설정을 되돌리고 QA 행을 지워요(중간에 죽어도 `finally` 에서 정리).
새벽 4시에 1~2분 동안 시연 병원 설정이 잠깐 바뀌어요. 그 시간에 시연할 일이 있으면 그날은 수동으로 `Disable workflow` 해 두세요.

## 로컬에서 같은 점검 돌리기

```bash
bash scripts/ci/run-checks.sh                 # 전부 (5분 안팎)
SKIP_BUILD=1 bash scripts/ci/run-checks.sh    # 빌드 빼고 (1분 안팎)
```

결과는 `ci-logs/summary.md`, 점검별 로그는 `ci-logs/<이름>.log` (둘 다 깃에 안 올라가요).

## 점검을 추가하려면

`scripts/ci/run-checks.sh` 에 `run <이름> <명령>` 한 줄을 넣어요. 운영 DB 에 쓰는 점검은 여기 넣지 말고 `server-qa` 작업에 넣어요.
