#!/usr/bin/env bash
# 잇닿 밤 점검 1단계: 두 앱 타입·단위 테스트·빌드 + 순수 점검 + 운영 읽기 전용 점검.
# 하나가 실패해도 끝까지 돌리고, 결과는 ci-logs/<이름>.log · 요약은 ci-logs/summary.md. 하나라도 실패하면 exit 1.
# 운영 DB에 쓰는 점검(서버 QA 31개)은 여기 없다 — .github/workflows/nightly-qa.yml 의 server-qa 작업.
# 로컬: bash scripts/ci/run-checks.sh   (빌드 빼기: SKIP_BUILD=1, 운영 읽기 점검 빼기: SKIP_LIVE=1)
set -u
cd "$(dirname "$0")/../.."
LOG=ci-logs
mkdir -p "$LOG"
printf '| 결과 | 점검 | 시간 |\n|---|---|---|\n' > "$LOG/summary.md"
fail=0

run() { # run <이름> <명령...>
  local name=$1 start=$SECONDS
  shift
  if "$@" > "$LOG/$name.log" 2>&1; then
    echo "| ✅ | $name | $((SECONDS - start))s |" >> "$LOG/summary.md"
  else
    echo "| ❌ | $name | $((SECONDS - start))s |" >> "$LOG/summary.md"
    fail=1
  fi
}

run worker-typecheck npm --prefix apps/worker-web run typecheck
run worker-test npm --prefix apps/worker-web test
run admin-typecheck npm --prefix apps/admin-web run typecheck
# 순수 점검(네트워크·DB 없음). .ts 를 바로 읽으므로 Node 22.18+ 필요.
run qa-gig-time-sync node scripts/qa-gig-time-sync.mjs
run qa-gig-pay-period node scripts/qa-gig-pay-period.mjs
run qa-attendance-operational node scripts/qa-attendance-operational.mjs
if [ -z "${SKIP_BUILD:-}" ]; then
  run worker-build npm --prefix apps/worker-web run build
  run admin-build npm --prefix apps/admin-web run build
fi
# 운영 읽기 전용: 공개 데모 로그인 + 정책·메타데이터 확인(출근 기록·현장 생성 없음).
[ -z "${SKIP_LIVE:-}" ] && run live-sites-readonly node scripts/qa-sites-release.mjs

cat "$LOG/summary.md"
exit $fail
