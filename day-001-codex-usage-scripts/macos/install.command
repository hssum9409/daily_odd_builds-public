#!/bin/sh
# 사용자별 설치. 관리자 권한이나 별도 런타임을 요구하지 않는다.
set -eu
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
install_base=${CODEX_USAGE_SCRIPTS_INSTALL_BASE:-"$HOME/Library/Application Support/DailyOddBuilds"}
mkdir -p "$install_base"
install_base=$(CDPATH= cd -- "$install_base" && pwd)
target="$install_base/CodexUsageMonitorScripts"
profile=${CODEX_USAGE_SCRIPTS_HOME:-"$HOME/Library/Application Support/DailyOddBuilds/CodexUsageMonitorScripts-profile"}
# 프로필은 기존 0.1 버전 경로와 호환하되, 앱 파일은 app 하위 폴더에 둔다.
if [ -z "${CODEX_USAGE_SCRIPTS_INSTALL_BASE:-}" ]; then
    target="$install_base/CodexUsageMonitorScripts/app"
    profile=${CODEX_USAGE_SCRIPTS_HOME:-"$install_base/CodexUsageMonitorScripts"}
    mkdir -p "$(dirname -- "$target")"
fi
[ ! -L "$target" ] || { echo 'Linked installation folders are unsupported.' >&2; exit 1; }
lock="${target}.install-lock"
if ! mkdir "$lock" 2>/dev/null; then echo 'Another installation is running.' >&2; exit 1; fi
stage="${target}.stage-$$"
backup="${target}.backup-$$"
committed=0
running=0
startup=0
launch=0
language=''
for option in "$@"; do
    case "$option" in --startup) startup=1 ;; --launch) launch=1 ;; --language=ko|--language=en|--language=zh|--language=ja) language=${option#--language=} ;; esac
done
safe_remove() {
    case "$1" in "$target"|"$stage"|"$backup") ;; *) echo 'Unsafe removal path' >&2; exit 1 ;; esac
    [ ! -L "$1" ] || { echo 'Linked installation folders are unsupported.' >&2; exit 1; }
    [ ! -e "$1" ] || rm -rf -- "$1"
}
cleanup() {
    code=$?
    if [ "$committed" -eq 0 ] && [ -d "$backup" ]; then
        safe_remove "$target"; mv -- "$backup" "$target"
        if [ "$running" -eq 1 ]; then "$target/macos/run.command"; fi
    fi
    safe_remove "$stage"
    rmdir "$lock"
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
owned_install() { [ -f "$1/installed.txt" ] && [ "$(head -n 1 "$1/installed.txt")" = 'CodexUsageMonitorScripts' ]; }
stop_monitor() {
    [ -d "$target" ] || return 0
    # 런타임이 직접 단일 인스턴스 IPC를 처리한다. 테스트에서는 GUI 호출만 대체한다.
    if [ -f "$profile/instance.json" ]; then
        running=1
        CODEX_USAGE_SCRIPTS_ROOT="$target" "$target/macos/stop.command"
        count=0
        while [ -f "$profile/instance.json" ] && [ "$count" -lt 15 ]; do sleep 1; count=$((count+1)); done
        [ ! -f "$profile/instance.json" ] || { echo 'Monitor did not stop; files were not changed.' >&2; exit 1; }
    fi
}
agent="$HOME/Library/LaunchAgents/com.dailyoddbuilds.codex-usage-scripts.plist"
if [ "${1:-}" = '--uninstall' ]; then
    [ -d "$target" ] || { echo 'Already removed.'; exit 0; }
    owned_install "$target" || { echo 'Not a Scripts installation.' >&2; exit 1; }
    stop_monitor
    if [ -f "$agent" ] && grep -F "$target/macos/Monitor.js" "$agent" >/dev/null; then
        /bin/launchctl bootout "gui/$(id -u)/com.dailyoddbuilds.codex-usage-scripts" 2>/dev/null || true
        rm -f -- "$agent"
    fi
    safe_remove "$target"
    committed=1
    echo 'Removed. User settings were preserved.'
    exit 0
fi
[ -f "$source_root/payload.sha256" ] || { echo 'Use the complete packaged release.' >&2; exit 1; }
while IFS= read -r line; do
    hash=${line%%  *}; file=${line#*  }
    [ "${#hash}" -eq 64 ] || exit 1
    case "$hash" in *[!0-9a-f]*) exit 1 ;; esac
    case "$file" in /*|*..*|windows/*|*[!a-zA-Z0-9_./-]*) echo 'Unsafe manifest' >&2; exit 1 ;; esac
    actual=$(shasum -a 256 "$source_root/$file"); actual=${actual%% *}
    [ "$hash" = "$actual" ] || { echo "Checksum mismatch: $file" >&2; exit 1; }
done < "$source_root/payload.sha256"
for required in macos/Monitor.js macos/install.command assets/gp-chan-face.png assets/gp-chan-monitor.png defaults.json; do
    grep -E "  $required\$" "$source_root/payload.sha256" >/dev/null || { echo 'Incomplete payload' >&2; exit 1; }
done
if [ -e "$target" ]; then owned_install "$target" || { echo 'Existing folder is not owned by Scripts edition.' >&2; exit 1; }; fi
mkdir "$stage"
while IFS= read -r line; do
    file=${line#*  }; mkdir -p "$stage/$(dirname -- "$file")"; cp -- "$source_root/$file" "$stage/$file"
done < "$source_root/payload.sha256"
cp -- "$source_root/payload.sha256" "$stage/payload.sha256"
chmod +x "$stage"/macos/*.command
printf 'CodexUsageMonitorScripts\n%s\n' "$target" > "$stage/installed.txt"
stop_monitor
[ ! -d "$target" ] || mv -- "$target" "$backup"
mv -- "$stage" "$target"
if [ "$startup" -eq 1 ] || { [ -f "$agent" ] && grep -F "$target/macos/Monitor.js" "$agent" >/dev/null; }; then
    "$target/macos/run.command" --register-startup
fi
if [ -n "$language" ] || [ "$startup" -eq 1 ]; then
    mkdir -p "$profile"
    /usr/bin/osascript -l JavaScript "$target/macos/Preferences.js" "$profile" "$target" "$language" "$startup"
fi
committed=1
safe_remove "$backup"
if [ "$running" -eq 1 ] || [ "$launch" -eq 1 ]; then "$target/macos/run.command"; fi
echo "Installed at $target. Download files can now be removed."
