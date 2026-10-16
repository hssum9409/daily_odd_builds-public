#!/bin/sh
set -eu
umask 077
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
base=${WORKLOG_SCRIPTS_INSTALL_BASE:-"$HOME/Library/Application Support/DailyOddBuilds/WorklogScripts"}
mkdir -p "$base"
base=$(CDPATH= cd -- "$base" && pwd)
target="$base/app"; stage="$base/stage-$$"; backup="$base/backup-$$"; lock="$base/install-lock"
profile=${WORKLOG_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/WorklogScripts"}
export WORKLOG_SCRIPTS_HOME="$profile"
agent="$HOME/Library/LaunchAgents/com.dailyoddbuilds.worklog-scripts.plist"
action=install; startup=0; launch=0; isolated=0; committed=0; running=0; swapped=0
for option in "$@"; do case "$option" in --uninstall) action=uninstall ;; --update) action=update ;; --startup) startup=1 ;; --launch) launch=1 ;; --isolated) isolated=1 ;; *) echo 'Unknown installation option' >&2; exit 1 ;; esac; done
plain() { check="$1"; while [ "$check" != / ] && [ -n "$check" ]; do [ ! -L "$check" ] || { echo 'Linked installation path' >&2; exit 1; }; check=$(dirname -- "$check"); done; }
owned() { [ -f "$target/installed.txt" ] && [ "$(head -n 1 "$target/installed.txt")" = WorklogScripts ] && [ "$(sed -n '2p' "$target/installed.txt")" = "$target" ]; }
safe_remove() { case "$1" in "$target"|"$stage"|"$backup") ;; *) echo 'Unsafe path' >&2; exit 1 ;; esac; plain "$1"; [ ! -e "$1" ] || rm -rf -- "$1"; }
stop_owned() { if [ -d "$target" ]; then owned || { echo 'Wrong installation owner' >&2; exit 1; }; /bin/sh "$target/desktop/macos/control.command" stop; fi; }
cleanup() { code=$?; if [ "$committed" -eq 0 ] && [ "$swapped" -eq 1 ]; then stop_owned || true; safe_remove "$target"; fi; if [ "$committed" -eq 0 ] && [ -d "$backup" ]; then mv "$backup" "$target"; if [ "$running" -eq 1 ]; then /bin/sh "$target/desktop/macos/run.command"; fi; fi; safe_remove "$stage"; rmdir "$lock"; exit "$code"; }
plain "$base"
mkdir "$lock" 2>/dev/null || { echo 'Another installation is running' >&2; exit 1; }
trap cleanup EXIT
trap 'exit 130' INT TERM
if [ -e "$target" ]; then plain "$target"; owned || { echo 'Existing folder is not owned by Worklog Scripts' >&2; exit 1; }; fi
if [ "$action" = uninstall ]; then
 if [ ! -d "$target" ]; then committed=1; echo 'Already removed'; exit; fi
 stop_owned
 if [ "$isolated" -eq 0 ] && [ -f "$agent" ] && grep -F "$target/desktop/macos/Runtime.js" "$agent" >/dev/null; then /bin/launchctl bootout "gui/$(id -u)/com.dailyoddbuilds.worklog-scripts" 2>/dev/null || true; rm -f "$agent"; fi
 safe_remove "$target"; committed=1; echo 'Removed. Account and local settings preserved.'; exit
fi
[ -f "$source_root/payload.sha256" ] || { echo 'Extract the complete packaged release' >&2; exit 1; }
while IFS= read -r line; do
 hash=${line%%  *}; file=${line#*  }
 [ "${#hash}" -eq 64 ] || exit 1
 case "$hash" in *[!0-9a-f]*) exit 1 ;; esac
 case "$file" in /*|*..*|desktop/windows/*|*[!a-zA-Z0-9_./-]*) echo 'Unsafe payload' >&2; exit 1 ;; esac
 plain "$source_root/$file"
 actual=$(/usr/bin/shasum -a 256 "$source_root/$file"); actual=${actual%% *}
 [ "$actual" = "$hash" ] || { echo 'Checksum mismatch' >&2; exit 1; }
done < "$source_root/payload.sha256"
for required in desktop/macos/Runtime.js desktop/macos/Core.js desktop/macos/Widget.js desktop/macos/ready.js desktop/macos/install.command desktop/macos/run.command desktop/macos/control.command config/firebase.json desktop/themes.json desktop/macos/Settings.js desktop/assets/Nunito-Bold.ttf desktop/assets/Nunito-ExtraBold.ttf desktop/assets/NanumSquareRoundR.ttf desktop/assets/NanumSquareRoundB.ttf desktop/assets/NanumSquareRoundEB.ttf desktop/assets/robot.png desktop/assets/LICENSE-Fluent-Emoji.txt desktop/assets/OFL-Nunito.txt desktop/assets/OFL-NanumSquareRound.txt release.json; do grep -F "  $required" "$source_root/payload.sha256" >/dev/null || { echo 'Incomplete payload' >&2; exit 1; }; done
mkdir "$stage"
while IFS= read -r line; do file=${line#*  }; mkdir -p "$stage/$(dirname -- "$file")"; cp "$source_root/$file" "$stage/$file"; done < "$source_root/payload.sha256"
cp "$source_root/payload.sha256" "$stage/payload.sha256"
chmod +x "$stage"/*.command "$stage"/desktop/macos/*.command
printf 'WorklogScripts\n%s\n' "$target" > "$stage/installed.txt"
[ ! -f "$profile/instance.json" ] || running=1
stop_owned
[ ! -d "$target" ] || mv "$target" "$backup"
mv "$stage" "$target"; swapped=1
if [ "$startup" -eq 1 ] && [ "$isolated" -eq 0 ]; then
 mkdir -p "$(dirname -- "$agent")"
 # Foundation writes XML safely, including paths with spaces, &, and Unicode.
 WORKLOG_AGENT_PATH="$agent" WORKLOG_AGENT_ROOT="$target" WORKLOG_AGENT_HOME="$profile" /usr/bin/osascript -l JavaScript "$target/desktop/macos/startup.js"
fi
if [ "$launch" -eq 1 ] || [ "$running" -eq 1 ]; then
 /bin/sh "$target/desktop/macos/run.command"
 count=0
 while ! WORKLOG_READY_ROOT="$target" /usr/bin/osascript -l JavaScript "$target/desktop/macos/ready.js" >/dev/null 2>&1 && [ "$count" -lt 20 ]; do sleep 1; count=$((count+1)); done
 WORKLOG_READY_ROOT="$target" /usr/bin/osascript -l JavaScript "$target/desktop/macos/ready.js" >/dev/null 2>&1 || { echo 'New version failed to start. Restoring previous version.' >&2; exit 1; }
fi
committed=1; safe_remove "$backup"; echo "Installed Worklog Scripts: $target"
