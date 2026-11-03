#!/bin/sh
S=/private/tmp/claude-501/-Users-kihankim-gawcheon-gawcheon-frontend-application/a1efc7af-94c7-44fc-b78d-e753bed0b5aa/scratchpad/mirror
read ID X Y W H < <("$S/tool/mtool" winid) || exit 1
screencapture -x -o -l "$ID" "$S/phone.png" && cp "$S/phone.png" "$S/frame_$(date +%H%M%S).png"
