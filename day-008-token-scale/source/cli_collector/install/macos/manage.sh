#!/bin/bash
set -euo pipefail
umask 077
action="${1:-}"; root="${2:-}"
root="$(cd -- "$root" && pwd -P)"
[ "$root" = "$HOME/Library/Application Support/Token Scale" ] || { echo 'Unexpected installation root' >&2; exit 1; }
[ "$(cat "$root/product-id")" = 'DailyOddBuilds.TokenScale' ] || exit 1
label='org.dailyoddbuilds.token-scale'
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
case "$action" in
  startup-enable)
    mkdir -p "$HOME/Library/LaunchAgents"
    # plist XML escaping is handled by the installed CLI (no Python dependency).
    version="$(cat "$root/current.txt")"
    "$root/versions/$version/token-scale" launchagent --install-root "$root" --home "$(cat "$root/data-home.txt")"
    /usr/bin/plutil -lint "$plist"
    /bin/launchctl enable "$domain/$label"
    if ! /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
      /bin/launchctl bootstrap "$domain" "$plist"
    fi
    ;;
  startup-disable)
    /bin/launchctl disable "$domain/$label"
    # Disabling next-login startup must leave the current tray daemon usable.
    rm -f "$plist"
    ;;
  uninstall)
    printf 'stop' > "$root/stop"
    for ((i=0;i<90;i++)); do [ ! -f "$root/host-active" ] && break; sleep 1; done
    [ ! -f "$root/host-active" ] || { echo 'Collector did not stop. Nothing removed.' >&2; exit 1; }
    /bin/launchctl disable "$domain/$label" 2>/dev/null || true
    /bin/launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    app="$HOME/Applications/Token Scale.app"
    # Remove only our owned product bundle, never an unrelated application.
    if [ -f "$app/Contents/Resources/product-id" ] && [ "$(cat "$app/Contents/Resources/product-id")" = 'DailyOddBuilds.TokenScale' ]; then
      [ "$(cd "$app" && pwd -P)" = "$HOME/Applications/Token Scale.app" ] || exit 1
      rm -rf -- "$app"
    fi
    # Exact resolved target checked above. Credentials/data are elsewhere.
    rm -rf -- "$root"
    echo 'Removed. Login and statistics cache were retained; server data is managed on the website.'
    ;;
  *) echo 'Unknown maintenance action' >&2; exit 2 ;;
esac
