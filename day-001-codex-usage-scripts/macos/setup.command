#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if choice=$(/usr/bin/osascript -l JavaScript "$root/macos/Setup.js" "$root"); then
    [ -n "$choice" ] || { echo 'Installation cancelled.'; exit 0; }
else
    code=$?
    echo 'Cannot open or complete the installation dialog. See the error above.' >&2
    exit "$code"
fi
# macOS의 BSD sed에서도 같은 결과를 얻도록 POSIX 기본 정규식만 쓴다.
# GNU 확장인 \| 분기는 언어 추출을 실패시켜 동의 직후 설치를 중단시켰다.
language=$(printf '%s' "$choice" | sed -n 's/.*"language"[[:space:]]*:[[:space:]]*"\([a-z][a-z]\)".*/\1/p')
case "$language" in ko|en|zh|ja) ;; *) echo 'Invalid installation dialog response. No files were installed.' >&2; exit 1 ;; esac
set -- --launch "--language=$language"
if printf '%s' "$choice" | grep '"startup"[[:space:]]*:[[:space:]]*true' >/dev/null; then set -- "$@" --startup; fi
echo 'Installing Codex Usage Monitor...'
exec /bin/sh "$root/macos/install.command" "$@"
