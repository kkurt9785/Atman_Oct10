#!/bin/bash
# tap.sh PX PY [press_ms] — PX/PY are pixel coords in the latest phone.png; scale derived from window width
S=/private/tmp/claude-501/-Users-kihankim-gawcheon-gawcheon-frontend-application/a1efc7af-94c7-44fc-b78d-e753bed0b5aa/scratchpad/mirror
read ID X Y W H < <("$S/tool/mtool" winid) || { echo "no window"; exit 1; }
IMGW=$(python3 -c "from PIL import Image; print(Image.open('$S/phone.png').size[0])")
PX=$(python3 -c "print($X + $1 * $W / $IMGW)"); PY=$(python3 -c "print($Y + $2 * $W / $IMGW)")
osascript -e 'tell application "iPhone Mirroring" to activate' >/dev/null 2>&1; sleep 0.25
if [ -n "$3" ]; then "$S/tool/mtool" press "$PX" "$PY" "$3"; else "$S/tool/mtool" click "$PX" "$PY"; fi
