#!/usr/bin/env bash
# 밤 점검 3단계의 마지막: AI 가 코드를 바꿨으면 브랜치+PR, 안 바꿨으면 이슈를 만든다.
# 깃허브 토큰은 여기서만 쓴다(Claude 단계에는 주지 않는다). 머지·배포는 하지 않는다.
# 필요한 환경: GH_TOKEN, GH_REPO 와 깃허브 액션 기본 변수(GITHUB_*).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ci-logs

RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
DAY=$(TZ=Asia/Seoul date +%Y-%m-%d)
BODY=ci-logs/body.md
ISSUE_TITLE="밤 점검 실패"

{
  if [ -s ci-report.md ]; then
    cat ci-report.md
  else
    echo "AI 진단 보고서가 없어요(토큰이 없거나 실행이 중간에 끝남). 아래 결과와 실행 로그를 봐 주세요."
  fi
  echo
  echo "## 점검 결과"
  cat ci-logs/summary.md 2>/dev/null || echo "(요약 없음)"
  if [ -f ci-logs/server-qa.log ]; then
    echo
    echo "## 서버 QA (실패·요약 줄만)"
    echo '```'
    grep -E 'FAIL|SUMMARY' ci-logs/server-qa.log | tail -40 || true
    echo '```'
  fi
  echo
  echo "실행 로그: $RUN_URL"
} > "$BODY"
rm -f ci-report.md # 보고서는 PR·이슈 본문으로만 남긴다

# 열려 있는 '밤 점검 실패' 이슈가 있으면 새로 만들지 않고 댓글로 잇는다(매일 새 이슈가 쌓이지 않게).
issue() { # issue <본문 파일>
  local open
  open=$(gh issue list --state open --search "\"$ISSUE_TITLE\" in:title" --json number --jq '.[0].number // empty' 2>/dev/null || true)
  if [ -n "$open" ]; then
    gh issue comment "$open" --body-file "$1"
  else
    gh issue create --title "$ISSUE_TITLE ($DAY~)" --body-file "$1"
  fi
}

# 앱·스크립트 수정만 올린다. 마이그레이션·워크플로·점검 실행기(scripts/ci)는 AI 가 바꿔도 올리지 않는다.
git add -A -- apps scripts ':!scripts/ci'
if git diff --cached --quiet; then
  issue "$BODY"
  exit 0
fi

BRANCH="ai-fix/$DAY-$GITHUB_RUN_ID"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git checkout -q -b "$BRANCH"
git commit -q -m "fix: 밤 점검 실패 자동 수정안 ($DAY)"
git push -q "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

if ! gh pr create --base "$GITHUB_REF_NAME" --head "$BRANCH" \
  --title "밤 점검 실패 자동 수정안 ($DAY)" --body-file "$BODY"; then
  {
    echo "수정안 브랜치는 올렸는데 PR 을 못 만들었어요."
    echo "Settings → Actions → General → 'Allow GitHub Actions to create and approve pull requests' 를 켜 주세요."
    echo "브랜치 비교: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/compare/${BRANCH}?expand=1"
    echo
    cat "$BODY"
  } > ci-logs/body-fallback.md
  issue ci-logs/body-fallback.md
fi
