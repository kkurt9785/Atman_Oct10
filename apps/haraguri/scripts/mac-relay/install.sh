#!/usr/bin/env bash
# Installs the HARAGURI Mac relay:
#   1) saves the collect address to ~/.haraguri-relay/config.json
#   2) builds ~/Applications/HaraguriRelay.app (AppleScript app that runs relay.mjs every 30 s)
#   3) adds it to Login Items and opens the Full Disk Access pane (grant it to HaraguriRelay, then relaunch the app)
# Usage:  bash scripts/mac-relay/install.sh "https://….supabase.co/functions/v1/ingest?token=…"
set -euo pipefail
URL="${1:-}"
[ -n "$URL" ] || { echo "사용법: bash install.sh \"<앱 설정에서 복사한 수집 주소>\""; exit 1; }
case "$URL" in https://*supabase.co/functions/v1/ingest?token=*) ;; *) echo "수집 주소 형식이 아니에요: $URL"; exit 1;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"; [ -n "$NODE" ] || { echo "node를 찾을 수 없어요"; exit 1; }
NODE="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$NODE")"
mkdir -p "$HOME/.haraguri-relay" "$HOME/Applications"
python3 - "$URL" <<'EOF'
import json,os,sys
p=os.path.expanduser('~/.haraguri-relay/config.json')
cfg=json.load(open(p)) if os.path.exists(p) else {}
cfg['ingestUrl']=sys.argv[1]; cfg.setdefault('lookbackDays',2)
json.dump(cfg,open(p,'w'),indent=1); os.chmod(p,0o600); print('  config saved')
EOF
"$NODE" "$HERE/relay.mjs" --selftest

APP="$HOME/Applications/HaraguriRelay.app"
SCRIPT="$(mktemp -t haraguri-relay).applescript"
cat > "$SCRIPT" <<EOF
-- HARAGURI relay: keeps running in the background; quit it from the Dock/menu to stop.
repeat
	try
		do shell script quoted form of "$NODE" & " " & quoted form of "$HERE/relay.mjs" & " >> " & quoted form of "$HOME/.haraguri-relay/relay.log" & " 2>&1"
	end try
	delay 30
end repeat
EOF
rm -rf "$APP"
osacompile -o "$APP" "$SCRIPT" >/dev/null
rm -f "$SCRIPT"
# Keep it out of the Dock while it loops.
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$APP/Contents/Info.plist"
echo "  app built: $APP"
osascript -e "tell application \"System Events\" to if not (exists login item \"HaraguriRelay\") then make login item at end with properties {path:\"$APP\", hidden:true}" >/dev/null && echo "  login item added"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
cat <<'EOF'

다음 두 가지만 해 주세요.
 1) 방금 열린 '전체 디스크 접근' 목록에서 ＋ → ~/Applications/HaraguriRelay.app 추가 후 켜기
 2) 아이폰 설정 → 메시지 → 문자 메시지 전달 → 이 Mac 켜기 (Mac 메시지 앱이 같은 Apple ID로 로그인돼 있어야 해요)
그다음 HaraguriRelay.app을 한 번 실행하세요(이후엔 로그인할 때 자동 시작).
 확인: tail -f ~/.haraguri-relay/relay.log   · 미리보기: node scripts/mac-relay/relay.mjs --dry-run --verbose
 중지: Activity Monitor에서 HaraguriRelay 종료, 로그인 항목에서 제거
EOF
