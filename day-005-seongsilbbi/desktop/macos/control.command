#!/bin/sh
set -eu
profile=${WORKLOG_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/WorklogScripts"}
action=${1:-status}
case "$action" in show|stop|refresh|status) ;; *) echo 'Unknown command' >&2; exit 1 ;; esac
# A terminated osascript may leave heartbeat files. Never signal a PID from this file.
if [ -f "$profile/instance.json" ]; then
 process_id=$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$profile/instance.json")
 case "$process_id" in ''|*[!0-9]*) ;; *) if ! kill -0 "$process_id" 2>/dev/null; then rm -f "$profile/instance.json" "$profile/status.json"; fi ;; esac
fi
if [ "$action" = status ]; then
 if [ -f "$profile/status.json" ]; then cat "$profile/status.json"; else printf '{"ready":false,"running":false}\n'; fi
 exit
fi
if [ ! -f "$profile/instance.json" ]; then
 if [ "$action" = show ]; then exec /bin/sh "$(dirname -- "$0")/run.command"; fi
 exit
fi
umask 077
mkdir -p "$profile/commands"
id=$(/usr/bin/uuidgen)
timestamp=$(date +%s)000
printf '{"action":"%s","createdAt":%s}\n' "$action" "$timestamp" > "$profile/commands/$id.tmp"
mv "$profile/commands/$id.tmp" "$profile/commands/$id.json"
if [ "$action" = stop ]; then
 count=0
 while { [ -f "$profile/instance.json" ] || { [ -n "${process_id:-}" ] && kill -0 "$process_id" 2>/dev/null; }; } && [ "$count" -lt 15 ]; do sleep 1; count=$((count+1)); done
 [ ! -f "$profile/instance.json" ] || { echo 'Worklog did not stop. Files were preserved.' >&2; exit 1; }
 if [ -n "${process_id:-}" ] && kill -0 "$process_id" 2>/dev/null; then echo 'Worklog process is still exiting. Files were preserved.' >&2; exit 1; fi
fi
