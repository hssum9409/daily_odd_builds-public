#!/bin/sh
# 경로에 공백/한글이 있어도 인수를 그대로 전달한다. 시스템 설정은 변경하지 않는다.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
export CODEX_USAGE_SCRIPTS_ROOT=$(dirname -- "$SCRIPT_DIR")
cd -- "$CODEX_USAGE_SCRIPTS_ROOT" || exit 1
case "${1-}" in
    --once|--stop|--register-startup|--remove-startup)
        exec /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" ;;
    --foreground)
        shift
        exec /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" ;;
    *)
        /usr/bin/nohup /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" </dev/null >/dev/null 2>&1 &
        ;;
esac
