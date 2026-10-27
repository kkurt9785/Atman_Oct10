#!/usr/bin/env bash
# Turns on "AI 정밀 인식" for screenshot import. Run once by a person (secret stores are not written by automation):
#   ANTHROPIC_API_KEY=sk-ant-... scripts/setup-vision-secret.sh
# The key lives only in Supabase function secrets; images are never stored. Remove with: supabase secrets unset ANTHROPIC_API_KEY --project-ref rwyvqxkweqsoositvlht
set -euo pipefail
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY 환경변수로 키를 넘겨 주세요}"
supabase secrets set "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" --project-ref rwyvqxkweqsoositvlht
echo "done — 가계부 → 캡처 가져오기 → ✨ AI 정밀 인식 버튼이 동작합니다."
