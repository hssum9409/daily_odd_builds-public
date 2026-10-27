#!/bin/sh
# 경로에 공백/한글이 있어도 인수를 그대로 전달한다. 시스템 설정은 변경하지 않는다.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
export CODEX_USAGE_SCRIPTS_ROOT=$(dirname -- "$SCRIPT_DIR")
cd -- "$CODEX_USAGE_SCRIPTS_ROOT" || exit 1
if [ "$#" -eq 0 ]; then set -- --reopen; fi
case "${1-}" in
    --once|--stop|--register-startup|--remove-startup)
        exec /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" ;;
    --foreground)
        shift
        exec /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" ;;
    *)
        # 시작 오류를 버리지 않는다. 최근 두 실행의 로그만 사용자 프로필에 보관한다.
        profile=${CODEX_USAGE_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts"}
        umask 077
        mkdir -p "$profile" || exit 1
        if [ -f "$profile/startup.log" ]; then
            mv -f "$profile/startup.log" "$profile/startup.previous.log" || exit 1
        fi
        /usr/bin/nohup /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/Monitor.js" "$@" </dev/null >"$profile/startup.log" 2>&1 &
        ;;
esac
