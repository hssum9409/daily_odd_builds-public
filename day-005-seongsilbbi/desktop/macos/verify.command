#!/bin/sh
# Executes on the target Mac. A Windows syntax/mock check is not a pass here.
set -eu
[ "$(uname -s)" = Darwin ] || { echo 'UNVERIFIED: run this verifier on macOS.' >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
umask 077
output=${WORKLOG_VERIFY_OUTPUT:-$(mktemp -d "${TMPDIR:-/tmp}/worklog-verify.XXXXXX")}
mkdir -p "$output"
export WORKLOG_SCRIPTS_INSTALL_BASE="$output/install space 한글"
export WORKLOG_SCRIPTS_HOME="$output/profile"
target="$WORKLOG_SCRIPTS_INSTALL_BASE/app"
cleanup() { if [ -f "$target/desktop/macos/control.command" ]; then /bin/sh "$target/desktop/macos/control.command" stop || true; fi; }
trap cleanup EXIT
for file in "$root"/*.command "$root"/desktop/macos/*.command; do /bin/sh -n "$file"; done
/bin/sh "$root/desktop/macos/install.command" --isolated
/bin/sh "$target/desktop/macos/run.command" --diagnose >"$output/native-diagnostic.log" 2>&1
[ -f "$WORKLOG_SCRIPTS_HOME/verification.json" ] || { echo "FAIL: see $output/native-diagnostic.log" >&2; exit 1; }
grep '"passed":true' "$WORKLOG_SCRIPTS_HOME/verification.json" >/dev/null || { echo 'FAIL: native diagnostic' >&2; exit 1; }
cp "$WORKLOG_SCRIPTS_HOME/verification.json" "$output/native-result.json"
if [ "${1:-}" = --live ]; then
 [ -n "${WORKLOG_QA_EMAIL:-}" ] && [ -n "${WORKLOG_QA_PASSWORD:-}" ] || { echo 'Set disposable WORKLOG_QA_EMAIL and WORKLOG_QA_PASSWORD.' >&2; exit 1; }
 /bin/sh "$target/desktop/macos/run.command" --verify >"$output/live-diagnostic.log" 2>&1
 grep '"passed":true' "$WORKLOG_SCRIPTS_HOME/verification.json" >/dev/null || { echo 'FAIL: live verification' >&2; exit 1; }
 cp "$WORKLOG_SCRIPTS_HOME/verification.json" "$output/live-result.json"
fi
/bin/sh "$target/desktop/macos/run.command"
count=0;while ! WORKLOG_READY_ROOT="$target" /usr/bin/osascript -l JavaScript "$target/desktop/macos/ready.js" >/dev/null 2>&1 && [ "$count" -lt 20 ]; do sleep 1;count=$((count+1));done
WORKLOG_READY_ROOT="$target" /usr/bin/osascript -l JavaScript "$target/desktop/macos/ready.js" >/dev/null
/bin/sh "$root/desktop/macos/install.command" --update --isolated
/bin/sh "$target/desktop/macos/control.command" stop
/bin/sh "$target/desktop/macos/install.command" --uninstall --isolated
[ ! -e "$target" ] || { echo 'FAIL: uninstall' >&2; exit 1; }
printf '{"passed":true,"platform":"macOS","os":"%s","architecture":"%s","liveRequested":%s,"checks":["native panel","Keychain","detached launch","update restart","uninstall"],"manualChecksRemaining":["Terminal app quit","Spaces/full screen","login startup","keyboard and drag"]}\n' "$(sw_vers -productVersion)" "$(uname -m)" "$(if [ "${1:-}" = --live ]; then echo true;else echo false;fi)" > "$output/verification.json"
echo "PASS: $output/verification.json"
