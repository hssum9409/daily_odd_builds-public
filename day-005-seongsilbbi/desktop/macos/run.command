#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export WORKLOG_SCRIPTS_ROOT="$root"
profile=${WORKLOG_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/WorklogScripts"}
export WORKLOG_SCRIPTS_HOME="$profile"
umask 077
mkdir -p "$profile"
case "${1:-}" in
 --foreground|--verify|--diagnose)
  if [ "${1:-}" = '--foreground' ]; then shift; fi
  exec /usr/bin/osascript -l JavaScript "$root/desktop/macos/Runtime.js" "$@" ;;
 *)
  if [ -f "$profile/startup.log" ]; then mv -f "$profile/startup.log" "$profile/startup.previous.log"; fi
  /usr/bin/nohup /usr/bin/osascript -l JavaScript "$root/desktop/macos/Runtime.js" "$@" </dev/null >"$profile/startup.log" 2>&1 &
  ;;
esac
